// Storage for the user's long-lived Claude Code OAuth token (sk-ant-oat…),
// captured by the /connect wizard. Lives as a file on the data volume —
// git-ignored, docker-ignored, loopback-only surface — and is injected into
// every spawned `claude` process's env (see src/generate/claude.ts).
//
// Precedence: stored file > process env. The UI's Disconnect must actually
// disconnect, so the file (when present) always wins over a compose-level
// CLAUDE_CODE_OAUTH_TOKEN.

import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DB_PATH } from '../config.js';

const TOKEN_PATH = join(dirname(DB_PATH), 'claude-token');
const TOKEN_RE = /^sk-ant-oat[A-Za-z0-9\-_]+$/;

/** Validate the token shape (never log the value itself). */
export function isValidTokenShape(token: string): boolean {
  return TOKEN_RE.test(token.trim());
}

/** The token from the wizard's store, or null. Trims; ignores unreadable files. */
function readStoredToken(): string | null {
  try {
    if (!existsSync(TOKEN_PATH)) return null;
    const t = readFileSync(TOKEN_PATH, 'utf8').trim();
    return isValidTokenShape(t) ? t : null;
  } catch {
    return null;
  }
}

/** Effective token: stored file first, then process env. Null = not connected. */
export function getClaudeToken(): string | null {
  const stored = readStoredToken();
  if (stored) return stored;
  const env = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  return env && isValidTokenShape(env) ? env : null;
}

/** True when the token came from the wizard's file (vs env/none). */
export function tokenIsStored(): boolean {
  return readStoredToken() !== null;
}

/** Persist a token (0600 best-effort; chmod is a no-op on Windows ACLs). */
export function storeClaudeToken(token: string): void {
  const t = token.trim();
  if (!isValidTokenShape(t)) throw new Error('that does not look like a Claude Code token (sk-ant-oat…)');
  writeFileSync(TOKEN_PATH, t + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(TOKEN_PATH, 0o600);
  } catch {
    /* windows */
  }
}

/** Remove the stored token (env-level token, if any, is out of our hands). */
export function clearClaudeToken(): void {
  try {
    rmSync(TOKEN_PATH, { force: true });
  } catch {
    /* already gone */
  }
}
