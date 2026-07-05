// Full live path: real `claude -p` backend + DB shim. Proves the model returns
// parseable grounded JSON that we persist. Deleted after run.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const hookUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '__fake-sqlite-hook.mjs'),
).href;
register(hookUrl);

const { upsertJob, getAnswers, getJob } = await import('../db/index.js');
const { generateForJob } = await import('./index.js');
const { isClaudeAvailable } = await import('./claude.js');

console.log('isClaudeAvailable:', isClaudeAvailable());

const job = upsertJob({
  url: 'https://example.test/live-rl',
  company: 'Nimbus Post-Training',
  role: 'ML Engineer, LLM Post-Training (Remote)',
  jd_text:
    'You will run GRPO/DPO post-training on LLMs, design verifiable rewards and evals, and serve with vLLM. Bonus: frontier multi-node distributed RL (FSDP/Megatron) and published NeurIPS/ICML work. Fully remote, global.',
  stage: 'evaluated',
  source: 'test',
});

const t0 = Date.now();
const result = await generateForJob(job.id);
console.log(`generateForJob returned in ${((Date.now() - t0) / 1000).toFixed(1)}s via '${result.backend}'`);
if (result.fallbackReason) console.log('fallbackReason:', result.fallbackReason);

const answers = getAnswers(job.id);
console.log('kinds:', answers.map((a) => a.kind).join(', '));
console.log('stage after:', getJob(job.id)?.stage);

const forms = answers.filter((a) => a.kind === 'form');
const cover = answers.find((a) => a.kind === 'cover');
const cv = answers.find((a) => a.kind === 'cv');

console.log('\n=== FORM ANSWERS ===');
for (const a of forms) {
  console.log(`\nQ: ${a.question}\nA: ${a.answer}`);
}
console.log('\n=== COVER LETTER ===\n' + (cover?.answer ?? '(none)'));
console.log('\n=== TAILORED CV (first 1200 chars) ===\n' + (cv?.answer ?? '(none)').slice(0, 1200));

// Honest-gaps spot checks on the LIVE model output.
const blob = answers.map((a) => a.answer ?? '').join('\n').toLowerCase();
const claimsPhd = /\bi (have|hold|earned|completed|did|possess) a?\s*ph\.?d/.test(blob) ||
  /my ph\.?d\b/.test(blob);
const claimsPapers = /\b(i|we) (published|authored) .*(neurips|icml|iclr)/.test(blob) ||
  /my (neurips|icml|iclr) (paper|publication)/.test(blob);
const anchorsInr = /(inr|₹|\brupee)/.test(blob);
console.log('\n=== HONEST-GAPS SPOT CHECKS (live output) ===');
console.log('  falsely claims PhD:', claimsPhd, '(must be false)');
console.log('  falsely claims top-tier papers:', claimsPapers, '(must be false)');
console.log('  anchors comp in INR:', anchorsInr, '(must be false)');
console.log('  mentions remote:', /remote/.test(blob), '(should be true)');

process.exit(0);
