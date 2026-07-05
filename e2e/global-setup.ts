// One-time Clerk setup for the `app` project: validates keys, ensures the two
// test users exist (so flushing the Clerk dev instance never breaks the suite),
// and warms the testing token so browser sign-ins with the +clerk_test users work.
import { clerkSetup } from '@clerk/testing/playwright';
import type { FullConfig } from '@playwright/test';

/** The +clerk_test users the app specs sign in as. Recreated if missing. */
export const E2E_USERS = [
  'falkyr.owner+clerk_test@example.com',
  'falkyr.intruder+clerk_test@example.com',
];

async function ensureUser(email: string, secret: string): Promise<void> {
  const H = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
  const found = await (
    await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, { headers: H })
  ).json();
  if (Array.isArray(found) && found.length > 0) return; // already exists
  const res = await fetch('https://api.clerk.com/v1/users', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ email_address: [email], password: 'FalkyrE2E!Test2026', skip_password_checks: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[e2e] could not create test user ${email}: ${res.status} ${body.slice(0, 160)}`);
  }
  console.log(`[e2e] created missing test user ${email}`);
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY || !process.env.VITE_CLERK_PUBLISHABLE_KEY) {
    console.warn('[e2e] Clerk keys absent — the `app` project will skip its signed-in flows.');
    return;
  }
  // Clerk reads CLERK_PUBLISHABLE_KEY; mirror our Vite-prefixed var.
  process.env.CLERK_PUBLISHABLE_KEY ??= process.env.VITE_CLERK_PUBLISHABLE_KEY;
  for (const email of E2E_USERS) await ensureUser(email, process.env.CLERK_SECRET_KEY);
  await clerkSetup();
}
