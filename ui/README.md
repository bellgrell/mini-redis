# mini-redis Web UI

Web-based management interface for [mini-redis](https://github.com/bellgrell/mini-redis) — a C++17 Redis-like server with TCP socket programming.

## Features

| Feature | Description |
|---------|-------------|
| 🎮 **Console** | Full Redis command line with autocomplete, history, and RESP response display |
| 🔑 **Key Browser** | Browse and filter keys, view values by type, delete keys |
| 📊 **Server Info** | View `INFO` server stats |
| 👁️ **Monitor** | Real-time command monitoring |
| 🔄 **Auto-reconnect** | Automatic WebSocket reconnection with status indicator |
| 📱 **Responsive** | Works on desktop and mobile |

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────┐     TCP/RESP     ┌──────────────┐
│   Browser (UI)  │ ◄──────────────► │ Proxy Server  │ ◄────────────► │ mini-redis    │
│  index.html     │                   │  (Node.js)    │                 │  (C++ Server) │
│  app.js         │                   │  port 8080    │                 │  port 6379    │
│  style.css      │                   └──────────────┘                 └──────────────┘
└─────────────────┘
```

The proxy server translates between browser WebSocket and Redis RESP protocol over raw TCP.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 16
- Your mini-redis server running (default: `127.0.0.1:6379`)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the proxy server (with mini-redis running)
npm start

# 3. Open in browser
open http://localhost:8080
```

## Options

```bash
# Custom port for the Web UI
node proxy-server.js --port 3000

# Custom Redis host/port
node proxy-server.js --redis-host 192.168.1.100 --redis-port 6380
```

## Connecting

1. Start your mini-redis server (C++ app)
2. Start the proxy server
3. Open `http://localhost:8080` in your browser
4. The UI will automatically connect via WebSocket

## Screens

### Console
Type any Redis command (e.g., `SET key value`, `GET key`, `KEYS *`). Supports RESP protocol, command history (↑/↓), and autocomplete (Tab).

### Keys
Browse all keys with type icons and TTL. Filter by pattern or type. Click a key to view its value.

### Info
View comprehensive server information.

### Monitor
Toggle monitoring to see all commands flowing through the server in real-time.
