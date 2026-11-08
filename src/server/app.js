import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from '../db/database.js';
import { WorldManager, tickWorld } from '../game/world.js';
import { handleApiRequest, sendJsonResponse } from './routes.js';
import { attachWebSocketServer } from './ws.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PUBLIC_DIR = path.resolve(__dirname, '../../public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function serveStaticFile(req, res, rawUrl) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    });
    res.end();
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, {
      'Content-Type': 'text/plain; charset=utf-8',
      Allow: 'GET, HEAD, OPTIONS',
    });
    res.end('405 Method Not Allowed');
    return;
  }

  const rawPath = String(rawUrl || '/').split('?')[0];
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request: Malformed URI');
    return;
  }

  // Block path traversal vectors in raw or decoded URI
  if (
    rawPath.includes('..') ||
    decodedPath.includes('..') ||
    decodedPath.includes('\0') ||
    decodedPath.includes('\\')
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  const relPath =
    decodedPath === '/' || decodedPath === ''
      ? 'index.html'
      : decodedPath.replace(/^\/+/, '');

  const safePath = path.resolve(PUBLIC_DIR, relPath);
  if (safePath !== PUBLIC_DIR && !safePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  let stat;
  try {
    stat = fs.statSync(safePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  if (!stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(safePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });

  if (method === 'HEAD') {
    res.end();
    return;
  }

  const content = fs.readFileSync(safePath);
  res.end(content);
}

export async function createServer(options = {}) {
  const {
    port = Number(process.env.PORT || 0),
    host = process.env.HOST || '0.0.0.0',
    dbPath = process.env.DB_PATH || ':memory:',
    tickIntervalMs = Number(process.env.TICK_INTERVAL_MS || 2000),
    autoStart = true,
  } = options;

  const db = initDatabase(dbPath);
  const world = new WorldManager(db);

  const activeSockets = new Set();

  const httpServer = http.createServer(async (req, res) => {
    const rawUrl = req.url || '/';
    const rawPathPart = rawUrl.split('?')[0];

    // Validate URI encoding early
    try {
      decodeURIComponent(rawPathPart);
    } catch {
      sendJsonResponse(res, 400, {
        ok: false,
        status: 400,
        error: 'BAD_REQUEST',
        code: 'ERR_MALFORMED_URI',
        message: 'Malformed URI',
      });
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl, 'http://127.0.0.1');
    } catch {
      sendJsonResponse(res, 400, {
        ok: false,
        status: 400,
        error: 'BAD_REQUEST',
        code: 'ERR_INVALID_URL',
        message: 'Invalid request URL',
      });
      return;
    }

    if (
      rawPathPart === '/api' ||
      rawPathPart.startsWith('/api/') ||
      parsedUrl.pathname === '/api' ||
      parsedUrl.pathname.startsWith('/api/')
    ) {
      await handleApiRequest(req, res, parsedUrl, world);
      return;
    }

    serveStaticFile(req, res, rawUrl);
  });

  httpServer.on('connection', (socket) => {
    activeSockets.add(socket);
    socket.on('close', () => {
      activeSockets.delete(socket);
    });
  });

  const wsServer = attachWebSocketServer(httpServer, world);

  let tickTimer = null;
  let isRunning = false;
  let boundPort = port;

  const app = {
    db,
    world,
    httpServer,
    wsServer,
    get port() {
      return boundPort;
    },
    get url() {
      return `http://127.0.0.1:${boundPort}`;
    },
    async start() {
      if (isRunning) {
        return { port: boundPort, url: `http://127.0.0.1:${boundPort}` };
      }
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          httpServer.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          httpServer.off('error', onError);
          const addr = httpServer.address();
          boundPort = typeof addr === 'object' && addr ? addr.port : port;
          isRunning = true;
          resolve();
        };
        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(port, host);
      });

      if (tickIntervalMs > 0 && !tickTimer) {
        tickTimer = setInterval(() => {
          try {
            tickWorld(world, 1);
          } catch {
            // ignore background tick errors
          }
        }, tickIntervalMs);
        if (typeof tickTimer.unref === 'function') {
          tickTimer.unref();
        }
      }

      return { port: boundPort, url: `http://127.0.0.1:${boundPort}` };
    },
    async stop() {
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      wsServer.closeAll();
      for (const socket of activeSockets) {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
      }
      activeSockets.clear();

      if (isRunning || httpServer.listening) {
        await new Promise((resolve) => {
          httpServer.close(() => resolve());
        });
        isRunning = false;
      }

      try {
        if (db && db.isOpen !== false) {
          db.close();
        }
      } catch {
        // ignore if already closed
      }
    },
  };

  if (autoStart) {
    await app.start();
  }

  return app;
}
