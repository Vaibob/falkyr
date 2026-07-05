// src/apply/browser.ts
//
// Browser bootstrap for the autofill engine. Two goals:
//   1. Reuse an ALREADY-INSTALLED chromium so no fresh ~150MB download happens
//      on the user's machine. Playwright resolves browser binaries from
//      PLAYWRIGHT_BROWSERS_PATH; if the caller has not set it, we point it at
//      the standard per-user cache that career-ops' Playwright installs into
//      (`%LOCALAPPDATA%/ms-playwright` on Windows). Set it BEFORE importing
//      'playwright' so the resolver sees it.
//   2. Always launch HEADED (visible) — this tool operates on the user's own
//      machine, under their eyes, so they can watch/verify every field and take
//      over at the submit step. Headless is never used here.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Ensure PLAYWRIGHT_BROWSERS_PATH is set so Playwright reuses an existing
 * chromium instead of downloading a fresh copy. No-op if the caller already
 * set it. Must run before `import('playwright')`.
 */
export function ensureBrowsersPath(): string | undefined {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }

  // Standard per-user Playwright browser cache locations by platform.
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    candidates.push(join(local, 'ms-playwright'));
  } else if (process.platform === 'darwin') {
    candidates.push(join(homedir(), 'Library', 'Caches', 'ms-playwright'));
  } else {
    candidates.push(join(homedir(), '.cache', 'ms-playwright'));
  }

  for (const dir of candidates) {
    if (existsSync(dir)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = dir;
      return dir;
    }
  }
  // Leave unset: Playwright falls back to its own default resolution, which may
  // trigger a download. We surface a clearer error later if launch fails.
  return undefined;
}

/**
 * Launch a visible chromium and return the browser + a fresh page.
 * `slowMoMs` adds a small delay between actions so the user can follow along.
 */
export async function launchHeadedChromium(slowMoMs = 40): Promise<{
  browser: import('playwright').Browser;
  context: import('playwright').BrowserContext;
  page: import('playwright').Page;
}> {
  ensureBrowsersPath();
  const { chromium } = await import('playwright');

  let browser: import('playwright').Browser;
  try {
    browser = await chromium.launch({ headless: false, slowMo: slowMoMs });
  } catch (err) {
    throw new Error(
      `Failed to launch chromium. Ensure a chromium build is installed and ` +
        `reachable via PLAYWRIGHT_BROWSERS_PATH ` +
        `(currently: ${process.env.PLAYWRIGHT_BROWSERS_PATH ?? '<unset>'}). ` +
        `Original error: ${(err as Error).message}`,
    );
  }

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  return { browser, context, page };
}
