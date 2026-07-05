// One-time Clerk setup for the `app` project: validates keys and warms the
// testing token so browser sign-ins with *+clerk_test@example.com users work.
import { clerkSetup } from '@clerk/testing/playwright';
import type { FullConfig } from '@playwright/test';

export default async function globalSetup(_config: FullConfig): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY || !process.env.VITE_CLERK_PUBLISHABLE_KEY) {
    console.warn('[e2e] Clerk keys absent — the `app` project will skip its signed-in flows.');
    return;
  }
  // Clerk reads CLERK_PUBLISHABLE_KEY; mirror our Vite-prefixed var.
  process.env.CLERK_PUBLISHABLE_KEY ??= process.env.VITE_CLERK_PUBLISHABLE_KEY;
  await clerkSetup();
}
