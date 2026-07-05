// Request-security layer for the Falkyr API. Three defenses, layered:
//
//  1. HOST GUARD (in app.ts, kept there): rejects DNS-rebinding — a hostile
//     page whose domain resolves to 127.0.0.1 arrives with its own Host
//     header and is refused.
//  2. ORIGIN GUARD (here, always on): rejects cross-site browser writes.
//     CORS stops cross-origin *reads*, but a malicious page can still FIRE
//     side-effectful no-body POSTs at loopback (scan, distill — burns the
//     user's Claude quota — disconnect, approve). Any browser attaches an
//     Origin header to cross-site POSTs; we allow only our own origins.
//     Non-browser clients (curl, the MCP server) send no Origin and pass.
//  3. IDENTITY GUARD (here, on when Clerk server keys are configured):
//     verifies the Clerk session JWT on every /api request and binds this
//     single-profile install to its first user — the fix for "a second
//     signed-in account sees the first user's Glove". Without server keys
//     (pure local mode) behavior is unchanged: loopback is the boundary.
//
// The Claude token (sk-ant-oat…) never travels through any API response; as
// defense-in-depth, redactSecrets() scrubs the pattern from every error
// string this server sends (see profileRoutes).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '@clerk/backend';
import { API_PORT, UI_DEV_ORIGIN } from '../config.js';
import { db } from '../db/index.js';

// ---------------------------------------------------------------------------
// Secret redaction (defense-in-depth for error strings)
// ---------------------------------------------------------------------------

const OAT_RE = /sk-ant-[A-Za-z0-9]{0,10}-?[A-Za-z0-9\-_]{8,}/g;

/** Scrub anything token-shaped out of a string bound for an HTTP response. */
export function redactSecrets(s: string): string {
  return s.replace(OAT_RE, 'sk-ant-…redacted…');
}

// ---------------------------------------------------------------------------
// Origin guard
// ---------------------------------------------------------------------------

/** Origins allowed to make browser-credentialed writes to this API. */
export function allowedOrigins(): string[] {
  const base = [
    UI_DEV_ORIGIN, // vite dev
    UI_DEV_ORIGIN.replace('localhost', '127.0.0.1'),
    `http://localhost:${API_PORT}`, // same-origin (container / prod serve)
    `http://127.0.0.1:${API_PORT}`,
  ];
  const extra = (process.env.FALKYR_EXTRA_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...base, ...extra])];
}

function originGuard(req: FastifyRequest, reply: FastifyReply): FastifyReply | undefined {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  const origin = req.headers.origin;
  if (!origin) return; // curl / server-to-server / same-origin form-less fetches
  if (allowedOrigins().includes(origin)) return;
  return reply.code(403).send({ error: 'cross-origin writes are not allowed' });
}

// ---------------------------------------------------------------------------
// Identity guard (Clerk backend verification + owner binding)
// ---------------------------------------------------------------------------

const CLERK_SECRET = process.env.CLERK_SECRET_KEY?.trim() || null;
const CLERK_JWT_KEY = process.env.CLERK_JWT_KEY?.trim() || null;

/** True when the server can verify Clerk sessions (either key works). */
export function apiAuthEnabled(): boolean {
  return Boolean(CLERK_SECRET || CLERK_JWT_KEY);
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Verified Clerk user id, when the identity guard is enabled. */
    authUserId?: string;
  }
}

const ownerStmt = () => db.prepare(`SELECT owner_id FROM profile WHERE id = 1`);

/** The install's bound owner (first authenticated user to write), or null. */
export function installOwnerId(): string | null {
  try {
    const row = ownerStmt().get() as { owner_id: string | null } | undefined;
    return row?.owner_id ?? null;
  } catch {
    return null;
  }
}

/** Bind the install to its first authenticated user (no-op if already bound). */
export function stampInstallOwner(userId: string): void {
  const existing = installOwnerId();
  if (existing) return;
  // The profile row may not exist yet — create the shell so the wall holds
  // from the very first authenticated request onward.
  db.prepare(
    `INSERT INTO profile (id, owner_id) VALUES (1, @owner)
     ON CONFLICT(id) DO UPDATE SET owner_id = COALESCE(profile.owner_id, excluded.owner_id)`,
  ).run({ owner: userId });
}

async function identityGuard(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  if (!apiAuthEnabled()) return;
  if (!req.url.startsWith('/api')) return; // static/SPA assets
  if (req.url === '/api/health') return; // liveness stays open

  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return reply.code(401).send({ error: 'sign in to use this API', code: 'unauthenticated' });
  }

  try {
    const claims = await verifyToken(token, {
      ...(CLERK_JWT_KEY ? { jwtKey: CLERK_JWT_KEY } : { secretKey: CLERK_SECRET! }),
      authorizedParties: allowedOrigins(),
      clockSkewInMs: 60_000,
    });
    req.authUserId = claims.sub;
  } catch {
    return reply.code(401).send({ error: 'session expired or invalid — sign in again', code: 'unauthenticated' });
  }

  // Owner wall: this is a single-profile personal install. The first
  // authenticated user becomes the owner; anyone else is refused everywhere.
  // stampInstallOwner's COALESCE makes the DB pick a single winner even under a
  // simultaneous first-hit race; we re-read and compare so the loser of that
  // race is walled on the SAME request rather than slipping one through.
  let owner = installOwnerId();
  if (!owner) {
    stampInstallOwner(req.authUserId);
    owner = installOwnerId();
  }
  if (owner && owner !== req.authUserId) {
    return reply.code(403).send({
      error:
        'this Falkyr install belongs to a different account — sign in as its owner, or reset the install (delete data/jobpilot.db) to start over',
      code: 'owner_mismatch',
    });
  }
}

// ---------------------------------------------------------------------------

/** Register both guards. Call BEFORE registerRoutes. */
export function registerSecurity(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    const blocked = originGuard(req, reply);
    if (blocked) return blocked;
    return identityGuard(req, reply);
  });
  app.log.info(
    `security: origin guard on (${allowedOrigins().length} origins); identity guard ${apiAuthEnabled() ? 'ON (Clerk verification + owner binding)' : 'off (no Clerk server key — loopback is the boundary)'}`,
  );
}
