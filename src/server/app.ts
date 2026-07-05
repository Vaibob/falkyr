// Fastify app factory. Registers CORS + all /api routes, and — when the built
// UI exists (web/dist, i.e. production / container) — serves the SPA from the
// SAME origin as the API so no cross-origin proxy is needed. In dev, Vite serves
// the UI on :5173 and proxies /api here, so web/dist is absent and static
// serving is skipped.

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWED_HOSTS, REPO_ROOT } from '../config.js';
import { registerRoutes } from './routes.js';
import { allowedOrigins, registerSecurity } from './security.js';

/** Build (but do not listen on) the Fastify app. */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  // DNS-rebinding / LAN guard. This API can spawn a browser and submit real
  // applications, so it answers ONLY to loopback Host headers. A malicious page
  // that rebinds its domain to 127.0.0.1 sends its own Host and is rejected.
  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (host && !ALLOWED_HOSTS.includes(host)) {
      return reply.code(403).send({ error: `host not allowed: ${host}` });
    }
  });

  // CORS for our own origins only (dev server + same-origin serve).
  await app.register(cors, {
    origin: allowedOrigins(),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Origin guard (cross-site write protection) + identity guard (Clerk
  // verification + single-install owner binding, when server keys exist).
  registerSecurity(app);

  await registerRoutes(app);

  // Same-origin UI serving when the build output is present (container/prod).
  const distDir = join(REPO_ROOT, 'web', 'dist');
  if (existsSync(join(distDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: distDir, prefix: '/' });
    // SPA fallback: any non-/api GET that isn't a real static file → index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.type('text/html').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
    app.log.info(`serving built UI from ${distDir}`);
  }

  return app;
}
