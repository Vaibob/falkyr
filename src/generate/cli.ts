// CLI entry: `npm run generate -- --job <id>`
// Generates application materials for one job and prints a readable summary.
// Exits non-zero on error so scripts/CI can detect failures.
import { addEvent, getAnswers, getJob } from '../db/index.js';
import { generateForJob } from './index.js';
import { isClaudeAvailable } from './claude.js';
import { REVIEW_MARKER } from './fallback.js';

interface CliArgs {
  jobId?: number;
  help: boolean;
  /** Print full answer bodies instead of a one-line preview. */
  full: boolean;
}

/** Minimal, dependency-free arg parser for --job <id>, --full, --help. */
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false, full: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--full') args.full = true;
    else if (a === '--job' || a === '--id') {
      const v = argv[++i];
      args.jobId = v === undefined ? NaN : Number(v);
    } else if (a.startsWith('--job=')) {
      args.jobId = Number(a.slice('--job='.length));
    } else if (a.startsWith('--id=')) {
      args.jobId = Number(a.slice('--id='.length));
    }
  }
  return args;
}

const USAGE = `Usage: npm run generate -- --job <id> [--full]

Generates humanized, grounded application materials for one job:
  - 3-6 first-person form answers (why this role, why you, salary, notice, work auth)
  - a short cover letter
  - a tailored one-page CV (Markdown) reframing your real cv.md for the JD

Materials are grounded ONLY in the career-ops source files (cv.md, config/profile.yml,
article-digest.md) plus the job's role/company/JD. Nothing is fabricated.

Backend: shells out to 'claude -p'. If the Claude CLI is missing or errors, a
deterministic template is used instead and every answer is prefixed with
"${REVIEW_MARKER}" so you know to review/edit it before sending.

Options:
  --job <id>   Job id to generate for (required)
  --full       Print full answer bodies (default: one-line previews)
  --help       Show this help`;

function preview(text: string | null, full: boolean): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (full) return text ?? '';
  return t.length > 140 ? `${t.slice(0, 137)}...` : t;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.jobId === undefined || Number.isNaN(args.jobId)) {
    console.error('error: --job <id> is required (an integer job id)\n');
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const job = getJob(args.jobId);
  if (!job) {
    console.error(`error: no job with id=${args.jobId}. Ingest/list jobs first.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Generating for job #${job.id}: ${job.role ?? '(role?)'} @ ${job.company ?? '(company?)'}`);
  console.log(`  URL: ${job.url}`);
  console.log(`  Backend available: claude CLI ${isClaudeAvailable() ? 'FOUND' : 'NOT found (will use fallback)'}`);
  console.log('');

  let result: Awaited<ReturnType<typeof generateForJob>>;
  try {
    result = await generateForJob(args.jobId);
  } catch (e) {
    // Emit a terminal event so the UI's live poll stops promptly instead of
    // hanging to its 120s safety cap when generation throws unexpectedly.
    addEvent(args.jobId, 'generate.error', e instanceof Error ? e.message : String(e));
    throw e;
  }

  if (result.backend === 'paused') {
    console.log(`⏸  Paused — Claude usage limit reached${result.retryHint ? ` (${result.retryHint})` : ''}.`);
    console.log('   No template was saved. Retry when your limit resets to get real Claude output.');
    return;
  }

  console.log(`Done via '${result.backend}' backend.`);
  if (result.fallbackReason) {
    console.log(`  Fallback reason: ${result.fallbackReason}`);
  }
  if (result.missingSources.length) {
    console.log(`  Missing source files: ${result.missingSources.join(', ')}`);
  }
  if (result.backend === 'fallback') {
    console.log(`  NOTE: answers are templated and prefixed "${REVIEW_MARKER}" — review before sending.`);
  }
  console.log('');

  // Re-read from DB so we show exactly what was persisted.
  const all = getAnswers(args.jobId);
  const fresh = all.filter((a) => result.answers.some((r) => r.id === a.id));

  const forms = fresh.filter((a) => a.kind === 'form');
  const covers = fresh.filter((a) => a.kind === 'cover');
  const cvs = fresh.filter((a) => a.kind === 'cv');

  console.log(`Form answers (${forms.length}):`);
  for (const a of forms) {
    console.log(`  Q: ${a.question}`);
    console.log(`  A: ${preview(a.answer, args.full)}`);
    console.log('');
  }
  for (const a of covers) {
    console.log(`Cover letter:`);
    console.log(preview(a.answer, args.full));
    console.log('');
  }
  for (const a of cvs) {
    console.log(`Tailored CV (${a.kind}):`);
    console.log(preview(a.answer, args.full));
    console.log('');
  }

  console.log(
    `Saved ${result.answers.length} answer row(s) for job #${job.id}. ` +
      `Review in the UI, then approve before applying.`,
  );
}

main().catch((err) => {
  console.error('generate failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
