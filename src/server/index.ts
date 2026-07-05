// JobPilot HTTP API entry point. Run via `npm run server` (tsx src/server/index.ts).
// Builds the Fastify app and listens on API_PORT (default 3001).

import { API_PORT, HOST } from '../config.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const app = await buildApp();

  try {
    // Bind loopback by default (config.HOST). The container overrides with
    // JOBPILOT_HOST=0.0.0.0 but publishes only to 127.0.0.1 on the host.
    await app.listen({ port: API_PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown on Ctrl-C / termination.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
