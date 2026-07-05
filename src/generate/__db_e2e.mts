// Proves the DB-write seam of generateForJob WITHOUT the native better-sqlite3
// binary. We register a Node module-resolution hook that substitutes a tiny
// in-memory fake for 'better-sqlite3', supporting exactly the statements that
// src/db/index.ts issues. Then we drive the real generateForJob() and assert
// that form/cover/cv rows were persisted with the correct `kind` values and the
// job advanced to 'drafted'. Deleted after run.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --- register the loader hook (defined in a sibling file) BEFORE importing db.
const hookUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '__fake-sqlite-hook.mjs'),
).href;
register(hookUrl);

// Force the fallback backend so this test is deterministic and offline.
process.env.JOBPILOT_CLAUDE_BIN = 'definitely-not-a-real-binary-xyz';
process.env.JOBPILOT_DB = ':memory:';

const { db, upsertJob, getAnswers, getEvents, getJob } = await import('../db/index.js');
const { generateForJob } = await import('./index.js');

let pass = 0,
  fail = 0;
const ok = (n: string, c: boolean) => {
  if (c) {
    pass++;
    console.log('  PASS', n);
  } else {
    fail++;
    console.log('  FAIL', n);
  }
};

// Seed a job.
const job = upsertJob({
  url: 'https://example.test/rl-eng',
  company: 'Acme RL Labs',
  role: 'Reinforcement Learning Engineer',
  jd_text: 'GRPO, DPO, verifiable rewards, vLLM. Frontier multi-node distributed RL. PhD preferred.',
  stage: 'evaluated',
  source: 'test',
});
ok('seeded job has id', typeof job.id === 'number');
ok('seeded stage evaluated', job.stage === 'evaluated');

const result = await generateForJob(job.id);
ok('backend is fallback (no claude)', result.backend === 'fallback');
ok('persisted >=5 answers', result.answers.length >= 5);

const answers = getAnswers(job.id);
const kinds = answers.map((a) => a.kind);
ok('has form rows', kinds.filter((k) => k === 'form').length >= 3);
ok('has exactly one cover row', kinds.filter((k) => k === 'cover').length === 1);
ok('has exactly one cv row', kinds.filter((k) => k === 'cv').length === 1);
ok('all kinds within CHECK enum', kinds.every((k) => k === 'form' || k === 'cover' || k === 'cv'));
ok(
  'every answer body is non-empty',
  answers.every((a) => (a.answer ?? '').length > 0),
);
ok(
  'fallback rows carry review marker',
  answers.every((a) => (a.answer ?? '').startsWith('[[review-needed]]')),
);

const after = getJob(job.id)!;
ok('job advanced to drafted', after.stage === 'drafted');

const events = getEvents(job.id);
ok('recorded generate events', events.some((e) => e.type === 'generate'));
ok('recorded a stage event', events.some((e) => e.type === 'stage'));

// Idempotency-ish: a second generate should not downgrade an approved job.
db.prepare(`UPDATE jobs SET stage='approved' WHERE id=?`).run(job.id);
await generateForJob(job.id);
ok('does not downgrade approved job', getJob(job.id)!.stage === 'approved');
const afterSecondAnswers = getAnswers(job.id);
ok('second generate replaces stale generated rows', afterSecondAnswers.length === answers.length);
ok(
  'still has exactly one cover row after second generate',
  afterSecondAnswers.filter((a) => a.kind === 'cover').length === 1,
);
ok(
  'still has exactly one cv row after second generate',
  afterSecondAnswers.filter((a) => a.kind === 'cv').length === 1,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
console.log('\n--- persisted questions ---');
for (const a of getAnswers(job.id).filter((a) => a.kind === 'form')) {
  console.log(`  [${a.kind}] ${a.question}`);
}
process.exit(fail === 0 ? 0 : 1);
