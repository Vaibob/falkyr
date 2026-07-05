// Central configuration: paths, ports, and safety flags.
// Everything is resolved to absolute paths so modules work regardless of cwd.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUserConfig } from './userconfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** JobPilot repo root (one level up from src/). */
export const REPO_ROOT = resolve(__dirname, '..');

// Tiny dependency-free .env loader: root `.env` then `.env.local`, real
// environment always wins. Carries server-side secrets (CLERK_SECRET_KEY,
// CLAUDE_CODE_OAUTH_TOKEN) that must never live in code or the image; both
// files are git- and docker-ignored. Values are only set, never logged.
for (const envFile of ['.env', '.env.local']) {
  try {
    const text = readFileSync(join(REPO_ROOT, envFile), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      const key = m[1];
      let value = m[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* file absent — fine */
  }
}

// Per-user config (env > ~/.jobpilot/config.json > built-in default). This is
// what makes JobPilot installable by someone other than the original author.
const userConfig = getUserConfig();

/** Read-only career-ops repo: the source of truth for CV/profile/digest. */
export const CAREER_OPS_ROOT = userConfig.careerOpsRoot;

/** Key files inside the career-ops repo (read-only). */
export const CAREER_OPS_FILES = {
  cv: join(CAREER_OPS_ROOT, 'cv.md'),
  profile: join(CAREER_OPS_ROOT, 'config', 'profile.yml'),
  articleDigest: join(CAREER_OPS_ROOT, 'article-digest.md'),
} as const;

/** SQLite database file. Created on first run. */
export const DB_PATH = userConfig.dbPath;

/** Ports. */
export const API_PORT = Number(process.env.JOBPILOT_API_PORT ?? 3001);
export const UI_DEV_PORT = Number(process.env.JOBPILOT_UI_PORT ?? 5173);

/** Vite dev origin allowed by CORS. */
export const UI_DEV_ORIGIN = `http://localhost:${UI_DEV_PORT}`;

/**
 * HARD SAFETY GATE. The autofill module must refuse to click submit unless
 * job.stage === 'approved' AND this flag is true. Default is false.
 */
export const SUBMIT_ALLOWED = process.env.JOBPILOT_ALLOW_SUBMIT === 'true';

/**
 * Hosts that JobPilot will NEVER source from OR auto-apply to. LinkedIn/Indeed
 * aggressively ban automation (LinkedIn ToS §8.2) and the user has instructed
 * us never to apply there. Ingest drops these; the autofill engine refuses to
 * even open them. This is a code-level block, not a preference.
 */
export const BLOCKED_APPLY_HOSTS = ['linkedin.com', 'indeed.com'] as const;

/**
 * Optional Apify token for the DORMANT Dice/scraper connector (see
 * src/ingest/apify.ts). Empty by default → Dice stays off. Set APIFY_TOKEN to
 * enable it alongside apify.dice.enabled in sources.config.json.
 */
export const APIFY_TOKEN = process.env.APIFY_TOKEN ?? '';

/**
 * Network bind address for the API. Defaults to LOOPBACK ONLY (127.0.0.1): this
 * server can spawn a headed browser and submit real job applications on the
 * user's behalf, so it must NOT be reachable as a LAN service. The container
 * sets JOBPILOT_HOST=0.0.0.0 (so its published port works) but publishes to
 * 127.0.0.1 on the host, keeping the effective surface loopback-only.
 */
export const HOST = process.env.JOBPILOT_HOST ?? '127.0.0.1';

/**
 * Host headers the API will answer to. A loopback allowlist blocks DNS-rebinding
 * (a malicious web page pointing its own domain at 127.0.0.1 to reach this API
 * from the victim's browser). Override with JOBPILOT_ALLOWED_HOSTS (CSV) ONLY if
 * you intentionally front JobPilot with a trusted reverse proxy + real auth.
 */
export const ALLOWED_HOSTS = (process.env.JOBPILOT_ALLOWED_HOSTS ?? 'localhost,127.0.0.1,::1,[::1]')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
