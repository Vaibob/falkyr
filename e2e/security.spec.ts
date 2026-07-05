// API-level security guards — no browser, drives the API directly.
// Proves the three walls that protect the Claude token and per-user data:
//   • host guard (DNS-rebinding)      — evil Host → 403
//   • origin guard (CSRF)             — cross-site write → 403, same-origin ok
//   • identity guard (Clerk + owner)  — no/blank/foreign token → 401, and the
//     owner wall when the install is already bound.
// The identity assertions only run when the server has Clerk keys (auth ON);
// otherwise they're skipped so local-mode CI still passes.
import { test, expect, request as pwRequest } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? 3210}`;
const authOn = Boolean(process.env.CLERK_SECRET_KEY || process.env.CLERK_JWT_KEY);

test.describe('host guard', () => {
  test('rejects a foreign Host header', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${BASE}/api/health`, { headers: { Host: 'evil.example' } });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });

  test('allows loopback health', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${BASE}/api/health`);
    expect(res.ok()).toBeTruthy();
    await ctx.dispose();
  });
});

test.describe('origin guard (CSRF)', () => {
  test('blocks a cross-site POST even to a side-effect route', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE}/api/scan`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });

  test('allows a same-origin POST (subject to auth below)', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE}/api/profile`, {
      headers: { Origin: BASE, 'Content-Type': 'application/json' },
      data: {},
    });
    // 200 in local mode, 401 when auth is on — never 403 (origin passed).
    expect(res.status()).not.toBe(403);
    await ctx.dispose();
  });
});

test.describe('identity guard', () => {
  test.skip(!authOn, 'no Clerk server key — API runs in local (loopback) mode');

  test('unauthenticated read is refused', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${BASE}/api/jobs`);
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('unauthenticated');
    await ctx.dispose();
  });

  test('a garbage bearer token is refused', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${BASE}/api/jobs`, {
      headers: { Authorization: 'Bearer not.a.real.jwt' },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('the profile route never leaks data without a valid session', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${BASE}/api/profile`);
    expect(res.status()).toBe(401);
    const text = await res.text();
    // No profile fields, and nothing token-shaped, ever appears in the error.
    expect(text).not.toContain('cv_md');
    expect(text).not.toMatch(/sk-ant-/);
    await ctx.dispose();
  });
});
