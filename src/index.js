import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './server/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  const dbPath =
    process.env.DB_PATH || path.resolve(__dirname, '../data/ironbound.sqlite');
  const tickIntervalMs = Number(process.env.TICK_INTERVAL_MS ?? 2500);

  const app = await createServer({
    port,
    host: '0.0.0.0',
    dbPath,
    tickIntervalMs,
  });

  console.log(
    `[Ironbound: Permadeath Chronicles] Server listening on http://127.0.0.1:${app.port}`
  );

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Ironbound] Received ${signal}, shutting down gracefully...`);
    try {
      await app.stop();
      process.exit(0);
    } catch (err) {
      console.error('[Ironbound] Error during shutdown:', err);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Ironbound] Fatal startup error:', err);
  process.exit(1);
});
