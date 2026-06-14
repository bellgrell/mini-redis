/**
 * mini-redis Web UI Proxy Server
 *
 * Bridges WebSocket connections from the browser to the
 * mini-redis TCP server using Redis RESP protocol.
 *
 * Usage:
 *   node proxy-server.js [options]
 *
 * Options:
 *   --port <port>           HTTP/WS server port (default: 8080)
 *   --redis-host <host>     Redis TCP host (default: 127.0.0.1)
 *   --redis-port <port>     Redis TCP port (default: 6379)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { WebSocketServer } = require('ws');

// ---- Config ----
function getArgValue(key, def) {
  const idx = process.argv.indexOf(key);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : def;
}
const config = {
  httpPort: parseInt(getArgValue('--port', '8080'), 10),
  redisHost: getArgValue('--redis-host', '127.0.0.1'),
  redisPort: parseInt(getArgValue('--redis-port', '6379'), 10),
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

// ---- HTTP server (serves static files + WebSocket + API) ----

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
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ---- API Endpoints ----

  // GET /api/status - server and connection status
  if (req.url === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      redisTarget: `${config.redisHost}:${config.redisPort}`,
      uptime: process.uptime(),
    }));
    return;
  }

  // GET /api/commands - full command reference
  if (req.url === '/api/commands' && req.method === 'GET') {
    const cmdPath = path.join(__dirname, 'commands.json');
    fs.readFile(cmdPath, (err, content) => {
      if (err) {
        res.writeHead(500);
        res.end('[]');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(content);
    });
    return;
  }

  // Serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(staticDir, filePath);

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

      sock.on('error', (err) => reject(err));
      sock.on('timeout', () => {
        sock.destroy();
        reject(new Error('Connection timeout'));
      });

      sock.connect(config.redisPort, config.redisHost);
    });
  }

  function sendStatus(type, data) {
    try { ws.send(JSON.stringify({ type, ...data })); } catch (_) {}
  }

  // Initial connection
  (async () => {
    try {
      redisSocket = await connectToRedis();
      sendStatus('connected', { host: config.redisHost, port: config.redisPort });

      redisSocket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        let tempBuf = buffer;
        let results = [];
        let parsePos = 0;

        while (parsePos < tempBuf.length) {
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

        const parts = parseCommandLine(msg.command);
        if (parts.length === 0) return;

        const respCommand = encodeRESP(...parts);
        redisSocket.write(respCommand);
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
            redisSocket.on('data', () => {});
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

// ---- Parse command line into tokens (supports quoted strings) ----
function parseCommandLine(line) {
  const parts = [];
  let i = 0;
  let current = '';
  while (i < line.length) {
    const c = line[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < line.length && line[i] !== quote) {
        if (line[i] === '\\' && i + 1 < line.length) { i++; current += line[i]; }
        else { current += line[i]; }
        i++;
      }
      i++;
      if (current) { parts.push(current); current = ''; }
    } else if (c === ' ') {
      if (current) { parts.push(current); current = ''; }
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
