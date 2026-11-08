import path from 'node:path';
import os from 'node:os';
import { initDatabase } from '../src/db/database.js';
import { WorldManager } from '../src/game/world.js';
import { handleApiRequest, sendJsonResponse } from '../src/server/routes.js';

let cachedWorld = null;

function getWorld() {
  if (!cachedWorld) {
    const dbPath = process.env.DB_PATH || path.join(os.tmpdir(), 'ironbound.sqlite');
    const db = initDatabase(dbPath);
    cachedWorld = new WorldManager(db);
  }
  return cachedWorld;
}

export default async function handler(req, res) {
  try {
    const rawUrl = req.url || '/';
    const parsedUrl = new URL(rawUrl, 'http://127.0.0.1');
    const world = getWorld();
    await handleApiRequest(req, res, parsedUrl, world);
  } catch (err) {
    sendJsonResponse(res, 500, {
      ok: false,
      status: 500,
      error: 'INTERNAL_SERVER_ERROR',
      code: 'ERR_INTERNAL',
      message: err?.message || 'Internal server error',
    });
  }
}
