/**
 * mini-redis Web UI Proxy Server
 *
 * Bridges WebSocket connections from the browser to the
 * mini-redis TCP server using Redis RESP protocol.
 *
 * Usage:
 *   node proxy-server.js [--port 8080] [--redis-host 127.0.0.1] [--redis-port 6379]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { WebSocketServer } = require('ws');

// ---- Config ----
const args = process.argv.slice(2);
const config = {
  httpPort: parseInt(args[args.indexOf('--port') + 1], 10) || 8080,
  redisHost: args[args.indexOf('--redis-host') + 1] || '127.0.0.1',
  redisPort: parseInt(args[args.indexOf('--redis-port') + 1], 10) || 6379,
};

// ---- RESP helpers ----

/** Encode a Redis command into RESP array format */
function encodeRESP(...parts) {
  let buf = `*${parts.length}\r\n`;
  for (const p of parts) {
    const str = String(p);
    buf += `$${Buffer.byteLength(str)}\r\n${str}\r\n`;
  }
  return buf;
}

/** Decode a single RESP response (supports simple string, error, integer, bulk string, array) */
function decodeRESP(data) {
  const results = [];
  let pos = 0;

  function readLine() {
    const idx = data.indexOf('\r\n', pos);
    if (idx === -1) return null;
    const line = data.toString('utf8', pos, idx);
    pos = idx + 2;
    return line;
  }

  function readBulk() {
    const line = readLine();
    if (line === null) return { value: null, ok: false };
    if (line[0] !== '$') return { value: line, ok: true };
    const len = parseInt(line.slice(1), 10);
    if (len === -1) return { value: null, ok: true };
    if (pos + len + 2 > data.length) return { value: null, ok: false };
    const val = data.toString('utf8', pos, pos + len);
    pos += len + 2;
    return { value: val, ok: true };
  }

  function readValue() {
    if (pos >= data.length) return { value: null, ok: false };
    const type = String.fromCharCode(data[pos]);
    switch (type) {
      case '+': { // Simple string
        const line = readLine();
        return line ? { value: line, ok: true } : { value: null, ok: false };
      }
      case '-': { // Error
        const line = readLine();
        return line ? { value: { error: line }, ok: true } : { value: null, ok: false };
      }
      case ':': { // Integer
        const line = readLine();
        return line ? { value: parseInt(line.slice(1), 10), ok: true } : { value: null, ok: false };
      }
      case '$': { // Bulk string
        return readBulk();
      }
      case '*': { // Array
        const line = readLine();
        if (!line) return { value: null, ok: false };
        const count = parseInt(line.slice(1), 10);
        if (count === -1) return { value: null, ok: true };
        const arr = [];
        for (let i = 0; i < count; i++) {
          const r = readValue();
          if (!r.ok) return { value: null, ok: false };
          arr.push(r.value);
        }
        return { value: arr, ok: true };
      }
      default:
        return { value: null, ok: false };
    }
  }

  while (pos < data.length) {
    const r = readValue();
    if (!r.ok) break;
    results.push(r.value);
  }
  return results.length === 1 ? results[0] : results;
}

/** Format RESP response for human-readable display */
function formatResponse(resp) {
  if (resp === null || resp === undefined) return '(nil)';
  if (resp && typeof resp === 'object' && resp.error) return `(error) ${resp.error}`;
  if (Array.isArray(resp)) {
    if (resp.length === 0) return '(empty array)';
    return resp.map((v, i) => `${i + 1}) ${formatResponse(v)}`).join('\n');
  }
  if (typeof resp === 'number') return `(integer) ${resp}`;
  return String(resp);
}

// ---- HTTP server (serves static files + WebSocket) ----

const staticDir = path.join(__dirname, 'public');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  // API endpoint: health check / connection
  if (req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', redisTarget: `${config.redisHost}:${config.redisPort}` }));
    return;
  }

  // Serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(staticDir, filePath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(staticDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

// ---- WebSocket server ----

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log(`[WS] Client connected`);

  // Each WebSocket connection gets its own TCP connection to mini-redis
  let redisSocket = null;
  let buffer = Buffer.alloc(0);
  let pingTimer = null;

  function connectToRedis() {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      sock.setTimeout(5000);

      sock.on('connect', () => {
        console.log(`[TCP] Connected to ${config.redisHost}:${config.redisPort}`);
        resolve(sock);
      });

      sock.on('error', (err) => {
        reject(err);
      });

      sock.on('timeout', () => {
        sock.destroy();
        reject(new Error('Connection timeout'));
      });

      sock.connect(config.redisPort, config.redisHost);
    });
  }

  // Send status update to WS client
  function sendStatus(type, data) {
    try {
      ws.send(JSON.stringify({ type, ...data }));
    } catch (_) {}
  }

  // Attempt initial connection
  (async () => {
    try {
      redisSocket = await connectToRedis();

      sendStatus('connected', { host: config.redisHost, port: config.redisPort });

      // Forward data from mini-redis to WS client
      redisSocket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        // Try to decode all complete RESP responses
        let decoded;
        let consumed = 0;

        // We need to be smarter: decodeRESP reads sequentially, let's use a loop
        let tempBuf = buffer;
        let results = [];
        let parsePos = 0;

        while (parsePos < tempBuf.length) {
          const savedPos = parsePos;
          const view = tempBuf.slice(parsePos);
          let viewPos = 0;

          function readLineFromView() {
            const idx = view.indexOf('\r\n', viewPos);
            if (idx === -1) return null;
            const line = view.toString('utf8', viewPos, idx);
            viewPos = idx + 2;
            return line;
          }

          function readValueFromView() {
            if (viewPos >= view.length) return { value: null, ok: false };
            const type = String.fromCharCode(view[viewPos]);
            switch (type) {
              case '+': {
                const line = readLineFromView();
                return line ? { value: line, ok: true } : { value: null, ok: false };
              }
              case '-': {
                const line = readLineFromView();
                return line ? { value: { error: line }, ok: true } : { value: null, ok: false };
              }
              case ':': {
                const line = readLineFromView();
                return line ? { value: parseInt(line.slice(1), 10), ok: true } : { value: null, ok: false };
              }
              case '$': {
                const line = readLineFromView();
                if (!line) return { value: null, ok: false };
                const len = parseInt(line.slice(1), 10);
                if (len === -1) {
                  results.push(null);
                  parsePos += viewPos;
                  return { value: null, ok: true };
                }
                if (viewPos + len + 2 > view.length) return { value: null, ok: false };
                const val = view.toString('utf8', viewPos, viewPos + len);
                viewPos += len + 2;
                return { value: val, ok: true };
              }
              case '*': {
                const line = readLineFromView();
                if (!line) return { value: null, ok: false };
                const count = parseInt(line.slice(1), 10);
                if (count === -1) return { value: null, ok: true };
                const arr = [];
                for (let i = 0; i < count; i++) {
                  const r = readValueFromView();
                  if (!r.ok) return { value: null, ok: false };
                  arr.push(r.value);
                }
                return { value: arr, ok: true };
              }
              default:
                return { value: null, ok: false };
            }
          }

          const r = readValueFromView();
          if (!r.ok) break;
          results.push(r.value);
          parsePos += viewPos;
        }

        if (results.length > 0) {
          buffer = buffer.slice(parsePos);
          for (const result of results) {
            const formatted = result && typeof result === 'object' && result.error
              ? `(error) ${result.error}`
              : formatResponse(result);
            sendStatus('response', { raw: result, formatted });
          }
        }
      });

      redisSocket.on('close', () => {
        console.log('[TCP] Connection closed');
        sendStatus('disconnected', { reason: 'Connection closed' });
        redisSocket = null;
      });

      redisSocket.on('error', (err) => {
        console.error('[TCP] Error:', err.message);
        sendStatus('error', { message: err.message });
      });

      // Keep alive ping
      pingTimer = setInterval(() => {
        if (redisSocket && !redisSocket.destroyed) {
          redisSocket.write(encodeRESP('PING'));
        }
      }, 30000);

    } catch (err) {
      console.error('[TCP] Connection failed:', err.message);
      sendStatus('error', { message: `Failed to connect to Redis server: ${err.message}` });
    }
  })();

  // Handle incoming commands from WS client
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'command') {
        if (!redisSocket || redisSocket.destroyed) {
          sendStatus('error', { message: 'Not connected to Redis server' });
          return;
        }

        // Parse command string into parts (quoted strings supported)
        const parts = parseCommandLine(msg.command);
        if (parts.length === 0) return;

        const respCommand = encodeRESP(...parts);
        redisSocket.write(respCommand);
        // Echo sent command
        sendStatus('sent', { raw: parts.join(' '), parts });
      }

      if (msg.type === 'reconnect') {
        if (redisSocket && !redisSocket.destroyed) {
          redisSocket.destroy();
        }
        buffer = Buffer.alloc(0);
        (async () => {
          try {
            redisSocket = await connectToRedis();
            sendStatus('connected', { host: config.redisHost, port: config.redisPort });
            // re-attach handlers - simplified, just forward data
            redisSocket.on('data', (chunk) => {
              // Forward raw data for reconnection
            });
          } catch (err) {
            sendStatus('error', { message: `Reconnect failed: ${err.message}` });
          }
        })();
      }
    } catch (err) {
      console.error('[WS] Error:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    if (pingTimer) clearInterval(pingTimer);
    if (redisSocket && !redisSocket.destroyed) {
      redisSocket.destroy();
    }
  });
});

// ---- Parse command line into tokens (supports double-quoted strings) ----
function parseCommandLine(line) {
  const parts = [];
  let i = 0;
  let current = '';

  while (i < line.length) {
    const c = line[i];
    if (c === '"' || c === "'") {
      // Quoted string
      const quote = c;
      i++;
      while (i < line.length && line[i] !== quote) {
        if (line[i] === '\\' && i + 1 < line.length) {
          i++;
          current += line[i];
        } else {
          current += line[i];
        }
        i++;
      }
      i++; // skip closing quote
      if (current) {
        parts.push(current);
        current = '';
      }
    } else if (c === ' ') {
      if (current) {
        parts.push(current);
        current = '';
      }
      i++;
    } else {
      current += c;
      i++;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// ---- Start ----
server.listen(config.httpPort, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║       mini-redis Web UI              ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║  UI:   http://localhost:${config.httpPort}          ║`);
  console.log(`  ║  Redis: ${config.redisHost}:${config.redisPort}                ║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
