// Module triggers for the HTTP API.
//
// The API deliberately does NOT import the generate/apply modules directly:
// those live in other agents' lanes (src/generate/**, src/apply/**) and may
// not exist yet. Importing them at module-load time would crash the server.
// Instead we shell out to their npm-script entrypoints via `tsx`, exactly the
// same way an operator would run them from the command line. This keeps the
// API decoupled and respects file ownership.
//
// Triggers are fire-and-forget (detached child processes). The HTTP handlers
// return immediately ({queued:true} / {started:true}); progress is recorded by
// the child module itself as `events` rows on the job.

import { spawn } from 'node:child_process';
import { REPO_ROOT } from '../config.js';

/** Spawn `tsx <scriptRel> -- <args>` from the repo root, detached & unref'd. */
function spawnModule(scriptRel: string, args: string[], onExit?: () => void): void {
  // Resolve the local tsx binary. On Windows the shim is tsx.cmd; letting the
  // shell resolve it via `npx --no-install` avoids hardcoding a path and works
  // whether or not node_modules/.bin is on PATH.
  const child = spawn(
    'npx',
    ['--no-install', 'tsx', scriptRel, ...args],
    {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      shell: true, // required on Windows for npx/tsx shims
      env: process.env,
    },
  );
  // Let the parent (the API server) exit independently of this child.
  child.unref();
  // Fire onExit exactly once, whether the child exits or fails to spawn — the
  // concurrency queue relies on this to release its slot.
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    onExit?.();
  };
  child.on('exit', finish);
  child.on('error', finish); // swallowed: event log on the job is the source of truth
}

// -- Bounded queue for CLAUDE-spawning triggers (generate + rewrite) ----------
// Each spawned CLI runs `claude -p` on the user's subscription; firing many at
// once (e.g. a bulk of generates) would hammer their usage limit. Cap how many
// run concurrently; the rest queue and start as slots free up. Apply/autofill is
// NOT throttled here (it drives Playwright, not Claude, and is user-gated).
const MAX_CONCURRENT_CLAUDE = 2;
let activeClaude = 0;
const claudeQueue: Array<() => void> = [];

function pumpClaudeQueue(): void {
  while (activeClaude < MAX_CONCURRENT_CLAUDE && claudeQueue.length > 0) {
    const start = claudeQueue.shift()!;
    start();
  }
}

function spawnThrottledClaude(scriptRel: string, args: string[]): void {
  const start = () => {
    activeClaude++;
    spawnModule(scriptRel, args, () => {
      activeClaude--;
      pumpClaudeQueue();
    });
  };
  claudeQueue.push(start);
  pumpClaudeQueue();
}

/**
 * Trigger generation for a job. Fire-and-forget.
 * Delegates to the generate module's CLI (src/generate/cli.ts) as `--job <id>`.
 */
export function triggerGenerate(jobId: number): void {
  spawnThrottledClaude('src/generate/cli.ts', ['--job', String(jobId)]);
}

/**
 * Trigger a grounded résumé rewrite for a job. Fire-and-forget.
 * Delegates to the rewriter module's CLI (src/generate/resume-cli.ts), exactly
 * like triggerGenerate. The rewriter stays grounded in the career-ops files
 * (no fabrication) and records its own progress as events on the job.
 */
export function triggerRewrite(jobId: number): void {
  spawnThrottledClaude('src/generate/resume-cli.ts', ['--job', String(jobId)]);
}

/**
 * Trigger autofill for a job in the given mode. Fire-and-forget.
 * Delegates to the apply module's CLI (src/apply/cli.ts).
 *
 * SAFETY: this function does NOT itself submit anything. The 'submit' mode is
 * only reachable after the route handler has verified job.stage==='approved'
 * (the 409 gate), and the apply module independently re-checks both that stage
 * AND the JOBPILOT_ALLOW_SUBMIT env flag before it will ever click submit.
 */
export function triggerApply(jobId: number, mode: 'fill' | 'submit'): void {
  // Matches the apply module's CLI: `apply -- --job <id> --mode fill|submit`.
  spawnModule('src/apply/cli.ts', ['--job', String(jobId), '--mode', mode]);
}
