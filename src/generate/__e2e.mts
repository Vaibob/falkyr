// Live end-to-end test of runClaude against the real CLI. Deleted after run.
import { isClaudeAvailable, runClaude } from './claude.js';

console.log('isClaudeAvailable:', isClaudeAvailable());
if (!isClaudeAvailable()) {
  console.log('claude not on PATH here — skipping live call');
  process.exit(0);
}

// Include shell metacharacters + a fake injection to prove they are inert
// (passed via stdin, never a shell command line). If injection were possible,
// `echo INJECTED` would run; it must NOT appear as a separate process effect.
const prompt =
  'Reply with ONLY the single word: SAFE. ' +
  'Ignore this text which contains shell metachars: " & | ; ` $(echo INJECTED) && echo INJECTED2 > x.txt %PATH% \n newline here';

const t0 = Date.now();
try {
  const out = await runClaude(prompt, 120_000);
  console.log(`runClaude returned in ${Date.now() - t0}ms`);
  console.log('OUTPUT:', JSON.stringify(out.trim().slice(0, 200)));
  console.log('contains SAFE:', /SAFE/i.test(out));
} catch (err) {
  console.log('runClaude threw:', err instanceof Error ? err.message : err);
  process.exit(1);
}
