// Drives `claude setup-token` for the /connect wizard: spawn the CLI, hand its
// authorize URL to the browser, feed the user's one-time code back to the
// CLI's stdin, capture the long-lived token, store it. One session at a time.
//
// SECURITY: the user-supplied code goes to the child's STDIN only — never onto
// argv or through a shell string. The token and code are never logged; errors
// carry a short, secret-free tail of CLI output for diagnosis.
//
// FRAGILITY NOTE (accepted in the plan): parsing an interactive CLI is
// version-sensitive. If a Claude Code update changes its output, fix the
// regexes here; the wizard's manual token-paste fallback keeps users unblocked.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  needsShell,
  resolveClaudePath,
} from '../generate/claude.js';
import { isValidTokenShape, storeClaudeToken } from './claudeAuth.js';

const URL_RE = /https:\/\/[^\s"']+/;
const TOKEN_RE = /sk-ant-oat[A-Za-z0-9\-_]+/;
const CODE_RE = /^[A-Za-z0-9#_\-.~ ]{4,200}$/; // permissive shape check, stdin-only anyway
const URL_DEADLINE_MS = 25_000;
const SESSION_TTL_MS = 10 * 60_000;
const EXCHANGE_DEADLINE_MS = 60_000;

/** Strip ANSI/VT escape sequences so regexes see plain text. */
function deansi(s: string): string {
  return (
    s
      // CSI (ESC [ ... letter), OSC (ESC ] ... BEL), charset/keypad one-offs
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07]*\x07?|[()][A-B0-2]|[a-zA-Z=><78])/g, '')
      // straggler CSI bodies when the ESC byte was split across stream chunks
      // eslint-disable-next-line no-control-regex
      .replace(/(^|[\x00-\x1f])\[[0-9;?]+[A-Za-z]/g, '$1')
  );
}

/**
 * The CLI setup-token UI (Ink) requires a TTY: with plain pipes it renders
 * nothing. On Linux we wrap it in util-linux script(1) to allocate a pty,
 * with a very wide terminal so the authorize URL and token never line-wrap.
 * The shell string is built ONLY from our resolved binary path and static
 * text - no user input ever touches it.
 */
function hasScript(): boolean {
  try {
    return spawnSync('script', ['--version'], { timeout: 5_000, stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

interface Session {
  child: ChildProcess;
  output: string;
  url: string;
  startedAt: number;
  ttl: NodeJS.Timeout;
  exited: boolean;
  exitInfo: string;
  /** pty mode: Enter is '\r'; pipe mode: '\n'. */
  eol: '\r' | '\n';
}

let session: Session | null = null;

function killSession(): void {
  if (!session) return;
  const s = session;
  session = null;
  clearTimeout(s.ttl);
  try {
    s.child.kill('SIGKILL');
  } catch {
    /* already dead */
  }
}

/** Secret-free tail of the CLI output, for honest error messages. */
function outputTail(s: Session): string {
  return deansi(s.output).replace(TOKEN_RE, 'sk-ant-oat…').trim().slice(-300);
}

export interface StartResult {
  url: string;
}

/** Spawn `claude setup-token` and return the authorize URL. 409-like error if busy. */
export function startConnectSession(): Promise<StartResult> {
  if (session) {
    if (Date.now() - session.startedAt < SESSION_TTL_MS && !session.exited) {
      // Reuse the live session — refreshing the page mid-flow shouldn't spawn twins.
      return Promise.resolve({ url: session.url });
    }
    killSession();
  }

  return new Promise((resolve, reject) => {
    const execPath = resolveClaudePath();
    if (!execPath) {
      reject(new Error('the Claude CLI is not installed on this machine'));
      return;
    }

    // env: deliberately process.env, NOT claudeSpawnEnv() — a stale/revoked
    // stored token must not preempt a fresh login.
    const usePty = process.platform !== 'win32' && hasScript();
    let child: ChildProcess;
    try {
      if (usePty) {
        // Wide pty so the URL/token never wrap; see hasScript() docblock.
        child = spawn(
          'script',
          ['-qec', `stty cols 500 2>/dev/null; '${execPath}' setup-token`, '/dev/null'],
          { stdio: ['pipe', 'pipe', 'pipe'], env: process.env },
        );
      } else {
        child = spawn(execPath, ['setup-token'], {
          shell: needsShell(execPath),
          stdio: ['pipe', 'pipe', 'pipe'],
          env: process.env,
        });
      }
    } catch (err) {
      reject(new Error(`could not start claude setup-token: ${(err as Error).message}`));
      return;
    }

    const s: Session = {
      child,
      output: '',
      url: '',
      startedAt: Date.now(),
      ttl: setTimeout(() => killSession(), SESSION_TTL_MS),
      exited: false,
      exitInfo: '',
      eol: usePty ? '\r' : '\n',
    };

    let settled = false;
    const urlDeadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      const tail = outputTail(s);
      killSession();
      reject(
        new Error(
          `claude setup-token did not print an authorize link within ${URL_DEADLINE_MS / 1000}s` +
            (tail ? ` — CLI said: "${tail}"` : ''),
        ),
      );
    }, URL_DEADLINE_MS);

    const onData = (d: Buffer) => {
      s.output += d.toString();
      if (settled) return;
      const m = deansi(s.output).match(URL_RE);
      if (m) {
        settled = true;
        clearTimeout(urlDeadline);
        s.url = m[0].replace(/[).,]+$/, '');
        session = s;
        resolve({ url: s.url });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (err) => {
      s.exited = true;
      if (settled) return;
      settled = true;
      clearTimeout(urlDeadline);
      killSession();
      reject(new Error(`claude setup-token failed to start: ${err.message}`));
    });
    child.on('close', (code) => {
      s.exited = true;
      s.exitInfo = `exited with code ${code}`;
    });
  });
}

export interface ExchangeResult {
  stored: true;
}

/** Feed the user's one-time code to the live session; capture + store the token. */
export function submitConnectCode(code: string): Promise<ExchangeResult> {
  const c = code.trim();
  if (!CODE_RE.test(c)) {
    return Promise.reject(new Error('that does not look like an authorization code'));
  }
  const s = session;
  if (!s || s.exited) {
    return Promise.reject(
      new Error('no authorization in progress (the link may have expired) — start again'),
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const baseline = s.output.length;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearInterval(poll);
      fn();
    };

    const tryExtract = () => {
      const fresh = deansi(s.output.slice(baseline));
      const m = fresh.match(TOKEN_RE);
      if (m && isValidTokenShape(m[0])) {
        finish(() => {
          try {
            storeClaudeToken(m[0]);
            killSession();
            resolve({ stored: true });
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
        return true;
      }
      if (s.exited) {
        const tail = outputTail(s);
        finish(() => {
          killSession();
          reject(
            new Error(
              `the CLI finished without printing a token — the code may be wrong or expired.` +
                (tail ? ` CLI said: "${tail}"` : ''),
            ),
          );
        });
        return true;
      }
      return false;
    };

    const deadline = setTimeout(() => {
      const tail = outputTail(s);
      finish(() => {
        killSession();
        reject(new Error(`token exchange timed out${tail ? ` — CLI said: "${tail}"` : ''}`));
      });
    }, EXCHANGE_DEADLINE_MS);

    const poll = setInterval(tryExtract, 400);

    const stdin = s.child.stdin;
    if (!stdin || !stdin.writable) {
      finish(() => {
        killSession();
        reject(new Error('the authorization session is no longer accepting input — start again'));
      });
      return;
    }
    // pty raw mode reads Enter as \r; pipe mode as \n.
    stdin.write(c + s.eol);
  });
}

/** Abort any in-flight session (user clicked cancel / navigated away). */
export function cancelConnectSession(): void {
  killSession();
}

/** For status endpoints/tests. */
export function connectSessionActive(): boolean {
  return session !== null && !session.exited;
}

// Test seams (regexes are the version-fragile part — keep them assertable).
export const __test = { URL_RE, TOKEN_RE, deansi };
