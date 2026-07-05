// Generation backend: shells out to the Claude Code headless CLI (`claude -p`).
// No API key is used — this reuses the user's local Claude Code auth. If the
// CLI is missing or errors, callers fall back to the deterministic template.
//
// SECURITY: the prompt embeds untrusted external text (the job description).
// We therefore NEVER interpolate the prompt into a shell command line. The
// prompt is written to the child's STDIN (`claude -p` reads stdin when given no
// prompt argument), so no shell metacharacter in a JD can break out of an arg
// or inject a command. Only static flags (`-p`, `--output-format text`) are
// ever placed on argv. We also resolve the concrete executable path so the
// happy path spawns without a shell at all (avoids Node DEP0190).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getClaudeToken } from '../profile/claudeAuth.js';

/** Structured result the orchestrator persists. */
export interface GeneratedBundle {
  formAnswers: { question: string; answer: string }[];
  coverLetter: string;
  cvMarkdown: string;
}

/**
 * Why a Claude call failed. This distinction is TRUST-CRITICAL:
 *   - 'limit' → the user hit a usage/rate limit (or the API is overloaded). This
 *     is TRANSIENT: the right move is to PAUSE and let them retry when it resets,
 *     NOT to silently ship a template-grade CV (the exact spray-tool quality the
 *     product positions against).
 *   - 'error' → any other failure (crash, timeout, unparseable output). A
 *     deterministic template is a reasonable, clearly-marked degraded output.
 */
export type ClaudeErrorKind = 'limit' | 'error';

/** Raised when the Claude backend is unavailable or fails. Carries a `kind`. */
export class ClaudeUnavailableError extends Error {
  readonly kind: ClaudeErrorKind;
  /** For 'limit': a short human hint about when to retry, if the CLI gave one. */
  readonly retryHint?: string;
  constructor(
    message: string,
    opts: { kind?: ClaudeErrorKind; retryHint?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ClaudeUnavailableError';
    this.kind = opts.kind ?? 'error';
    this.retryHint = opts.retryHint;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

/**
 * Classify a failed `claude -p` run from its stderr + exit code. Detects the
 * usage/rate-limit case (and server-overload, which is likewise transient) so
 * callers can pause-and-retry instead of degrading to a template.
 */
export function classifyClaudeFailure(stderr: string, _code: number | null): {
  kind: ClaudeErrorKind;
  retryHint?: string;
} {
  const s = (stderr || '').toLowerCase();
  const isLimit =
    /usage limit|rate.?limit|limit reached|limit exceeded|too many requests|\b429\b|quota|overloaded|\b529\b|resets? (?:at|in)|try again later/.test(
      s,
    );
  if (!isLimit) return { kind: 'error' };
  // Pull a "resets at 11pm" / "try again in 2h" style hint if present.
  const m = stderr.match(/resets?\s+(?:at|in)\s+[^.\n]+|try again (?:at|in)\s+[^.\n]+/i);
  return { kind: 'limit', retryHint: m ? m[0].trim() : undefined };
}

const IS_WINDOWS = process.platform === 'win32';

/** Env override for the CLI name/path; defaults to `claude` on PATH. */
const CLAUDE_BIN = process.env.JOBPILOT_CLAUDE_BIN ?? 'claude';

/**
 * Resolve `CLAUDE_BIN` to a concrete executable path so we can spawn it without
 * a shell. If it is already an absolute/relative path that exists, use it. Else
 * ask the OS (`where` on Windows, `which` elsewhere) and take the first hit.
 * Returns null if nothing resolves. Cached per process.
 */
let cachedPath: string | null | undefined;
export function resolveClaudePath(): string | null {
  if (cachedPath !== undefined) return cachedPath;

  // If the override already looks like a path with a separator, trust it as-is;
  // spawn will surface ENOENT if it is wrong.
  if (CLAUDE_BIN.includes('/') || CLAUDE_BIN.includes('\\')) {
    cachedPath = CLAUDE_BIN;
    return cachedPath;
  }

  const finder = IS_WINDOWS ? 'where' : 'which';
  try {
    const res = spawnSync(finder, [CLAUDE_BIN], {
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    if (res.status === 0 && res.stdout) {
      // Prefer a .exe/.cmd/.bat over a bare extensionless match on Windows.
      const lines = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 0) {
        const preferred =
          lines.find((l) => /\.(exe|cmd|bat)$/i.test(l)) ?? lines[0];
        cachedPath = preferred;
        return cachedPath;
      }
    }
  } catch {
    /* fall through */
  }
  cachedPath = null;
  return cachedPath;
}

/**
 * `.cmd`/`.bat` shims cannot be executed by CreateProcess directly and require
 * a shell. Native `.exe` (the common install) and POSIX binaries do not.
 */
export function needsShell(execPath: string | null): boolean {
  if (!execPath) return IS_WINDOWS; // unresolved on Windows → let the shell try
  return IS_WINDOWS && /\.(cmd|bat)$/i.test(execPath);
}

/**
 * Env for spawned `claude` processes: the wizard-stored token (or compose env)
 * rides along as CLAUDE_CODE_OAUTH_TOKEN so headless auth works in-container.
 */
export function claudeSpawnEnv(): NodeJS.ProcessEnv {
  const token = getClaudeToken();
  return token ? { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token } : process.env;
}

/**
 * Heuristic: the CLI has its own interactive login on this machine (the normal
 * host case — `claude` was logged in via the browser, credentials live under
 * ~/.claude). In the container that dir doesn't exist, so auth must come from
 * the wizard/env token instead.
 */
function hasLocalCliCredentials(): boolean {
  try {
    const home = homedir();
    return (
      existsSync(join(home, '.claude', '.credentials.json')) ||
      existsSync(join(home, '.claude.json'))
    );
  } catch {
    return false;
  }
}

/**
 * cli: the binary is invocable · connected: cli AND some auth exists (wizard
 * token file, env token, or the CLI's own interactive login on this machine).
 * GlovePage/routes treat cli && connected as "available".
 */
export function claudeStatus(): { cli: boolean; connected: boolean } {
  const cli = isClaudeAvailable();
  return {
    cli,
    connected: cli && (getClaudeToken() !== null || hasLocalCliCredentials()),
  };
}

/**
 * Detect whether the Claude CLI is invocable. Cheap, synchronous, cached per
 * process. Runs `claude --version`; any non-zero/spawn error means unavailable.
 */
// Time-boxed cache. A LONG-LIVED process (the MCP server) must not get stuck in
// a stale verdict: if `claude` wasn't on PATH at first call, or was briefly
// unavailable, we re-check after the TTL rather than answering wrong forever.
const AVAILABILITY_TTL_MS = 60_000;
let availabilityCache: { value: boolean; at: number } | undefined;
export function isClaudeAvailable(): boolean {
  const now = Date.now();
  if (availabilityCache && now - availabilityCache.at < AVAILABILITY_TTL_MS) {
    return availabilityCache.value;
  }
  const execPath = resolveClaudePath();
  const cmd = execPath ?? CLAUDE_BIN;
  let value = false;
  try {
    const res = spawnSync(cmd, ['--version'], {
      shell: needsShell(execPath),
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    value = res.status === 0 && !res.error;
  } catch {
    value = false;
  }
  availabilityCache = { value, at: now };
  return value;
}

/** Options for runClaude. A bare number is accepted as timeoutMs (back-compat). */
export interface RunClaudeOptions {
  timeoutMs?: number;
  /**
   * Model alias/id, e.g. 'haiku' | 'sonnet'. SECURITY: on Windows the `.cmd`
   * shim spawns with shell:true, so argv extensions are shell-interpreted —
   * the value is whitelist-validated here and must only ever come from
   * src/profile/models.ts constants, never from a request.
   */
  model?: string;
  /** Pre-approved tools for this run. Only 'Read' is ever allowed. */
  allowedTools?: readonly ('Read')[];
}

const MODEL_RE = /^[a-z0-9.:-]+$/i;
const TOOL_ALLOWLIST = new Set(['Read']);

/**
 * Run `claude -p` capturing stdout, feeding the prompt via STDIN (not argv) so
 * the untrusted JD text can never be interpreted by a shell. Resolves with raw
 * stdout; rejects with ClaudeUnavailableError on spawn failure, non-zero exit,
 * timeout, or empty output.
 */
export function runClaude(
  prompt: string,
  options: number | RunClaudeOptions = 180_000,
): Promise<string> {
  const opts: RunClaudeOptions = typeof options === 'number' ? { timeoutMs: options } : options;
  const timeoutMs = opts.timeoutMs ?? 180_000;

  return new Promise((resolve, reject) => {
    const execPath = resolveClaudePath();
    const cmd = execPath ?? CLAUDE_BIN;
    // Only static, trusted, whitelist-validated flags go on argv. `-p` with no
    // positional prompt makes `claude` read the prompt from stdin.
    const args = ['-p', '--output-format', 'text'];
    if (opts.model) {
      if (!MODEL_RE.test(opts.model)) {
        reject(new ClaudeUnavailableError(`refusing invalid model name: ${opts.model.slice(0, 40)}`));
        return;
      }
      args.push('--model', opts.model);
    }
    if (opts.allowedTools?.length) {
      const bad = opts.allowedTools.find((t) => !TOOL_ALLOWLIST.has(t));
      if (bad) {
        reject(new ClaudeUnavailableError(`refusing non-allowlisted tool: ${String(bad).slice(0, 40)}`));
        return;
      }
      args.push('--allowedTools', opts.allowedTools.join(','));
    }

    let child;
    try {
      child = spawn(cmd, args, {
        shell: needsShell(execPath),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: claudeSpawnEnv(),
      });
    } catch (err) {
      reject(new ClaudeUnavailableError('failed to spawn claude CLI', { cause: err }));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        child.kill('SIGKILL');
        reject(new ClaudeUnavailableError(`claude CLI timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      finish(() => reject(new ClaudeUnavailableError('claude CLI spawn error', { cause: err })));
    });

    child.on('close', (code) => {
      finish(() => {
        if (code !== 0) {
          const { kind, retryHint } = classifyClaudeFailure(stderr, code);
          const prefix = kind === 'limit' ? 'claude usage limit reached' : `claude CLI exited with code ${code}`;
          reject(
            new ClaudeUnavailableError(
              `${prefix}${retryHint ? ` (${retryHint})` : ''}: ${stderr.trim().slice(0, 500)}`,
              { kind, retryHint },
            ),
          );
          return;
        }
        if (!stdout.trim()) {
          reject(new ClaudeUnavailableError('claude CLI produced no output'));
          return;
        }
        resolve(stdout);
      });
    });

    // Feed the prompt via stdin, then close it so `claude` stops reading.
    const stdin = child.stdin;
    if (!stdin) {
      finish(() => reject(new ClaudeUnavailableError('claude CLI stdin unavailable')));
      return;
    }
    stdin.on('error', (err) => {
      // EPIPE if the child exits early — surfaced via the close/error handlers.
      finish(() => reject(new ClaudeUnavailableError('failed writing prompt to stdin', { cause: err })));
    });
    stdin.write(prompt, 'utf8');
    stdin.end();
  });
}

/**
 * Extract the first balanced top-level JSON object from arbitrary model output.
 * Handles the common cases: bare JSON, JSON wrapped in ```json fences, or JSON
 * with leading/trailing prose. Returns null if no parseable object is found.
 */
export function extractJson(raw: string): unknown | null {
  const text = raw.trim();

  // Try the whole thing first (the happy path when the model obeys).
  const direct = tryParse(text);
  if (direct !== undefined) return direct;

  // Strip a ```json ... ``` (or ``` ... ```) fence if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const inner = tryParse(fence[1].trim());
    if (inner !== undefined) return inner;
  }

  // Scan for a balanced { ... } (respecting strings/escapes). If the first
  // balanced object fails to parse (e.g. a "{question, answer}" mention in prose
  // that precedes the real JSON), keep scanning from the NEXT '{' rather than
  // giving up — otherwise a good JSON object later in the output is ignored.
  let start = text.indexOf('{');
  while (start !== -1) {
    let depth = 0;
    let inStr = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return null; // nothing balanced from here on
    const parsed = tryParse(text.slice(start, end + 1));
    if (parsed !== undefined) return parsed;
    start = text.indexOf('{', start + 1); // that candidate didn't parse — try the next
  }
  return null;
}

function tryParse(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * Coerce parsed JSON into a GeneratedBundle, tolerating minor schema drift
 * (e.g. `formAnswers` vs `form_answers`). Returns null if the shape is unusable
 * (no cover letter AND no CV AND no answers) so the caller can fall back.
 */
export function coerceBundle(parsed: unknown): GeneratedBundle | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  const rawAnswers = obj.form_answers ?? obj.formAnswers ?? obj.answers;
  const formAnswers: { question: string; answer: string }[] = [];
  if (Array.isArray(rawAnswers)) {
    for (const item of rawAnswers) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const question = typeof rec.question === 'string' ? rec.question.trim() : '';
      const answer = typeof rec.answer === 'string' ? rec.answer.trim() : '';
      if (question && answer) formAnswers.push({ question, answer });
    }
  }

  const coverLetter =
    typeof (obj.cover_letter ?? obj.coverLetter) === 'string'
      ? String(obj.cover_letter ?? obj.coverLetter).trim()
      : '';
  const cvMarkdown =
    typeof (obj.cv_markdown ?? obj.cvMarkdown ?? obj.cv) === 'string'
      ? String(obj.cv_markdown ?? obj.cvMarkdown ?? obj.cv).trim()
      : '';

  if (formAnswers.length === 0 && !coverLetter && !cvMarkdown) return null;
  return { formAnswers, coverLetter, cvMarkdown };
}
