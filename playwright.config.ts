// Playwright e2e config for Falkyr. Two projects:
//   • security  — API-level guards (origin, host, identity/owner). No browser
//     auth needed; drives the API directly. Always runs.
//   • app       — full browser flows through Clerk-gated pages. Requires Clerk
//     test keys (.env.local) + the two *+clerk_test@example.com users; skips
//     itself cleanly when they're absent so CI without secrets still passes.
//
// The web server is started per-run on an isolated port + throwaway DB so tests
// never touch real data. Run: npm run e2e   (or: npx playwright test).
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Load Clerk keys the same way the app does (root env files).
loadEnv({ path: '.env' });
loadEnv({ path: '.env.local' });

const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_URL = `http://127.0.0.1:${PORT}`;
// Throwaway DB per run — never the real data/jobpilot.db.
const E2E_DB = join(tmpdir(), `falkyr-e2e-${process.pid}.db`);

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false, // single-profile install → serialize to avoid owner-binding races
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'security', testMatch: /security\.spec\.ts/ },
    {
      name: 'app',
      testMatch: /app\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run server',
    url: `${BASE_URL}/api/health`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      JOBPILOT_API_PORT: String(PORT),
      JOBPILOT_DB: E2E_DB,
      JOBPILOT_HOST: '127.0.0.1',
      // Isolate grounding: force files-mode off so tests see a clean install.
      CAREER_OPS_ROOT: join(tmpdir(), 'falkyr-e2e-no-careerops'),
      LOG_LEVEL: 'warn',
    },
  },
});
