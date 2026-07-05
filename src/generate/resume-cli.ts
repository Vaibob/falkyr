// CLI entry: `npm run rewrite -- --job <id>`
// De-correlates and human-voices the résumé for one job, persists it as a
// kind='cv' answer, and prints a readable summary. Exits non-zero on error so
// scripts/CI can detect failures.
import { addEvent, getAnswers, getJob } from '../db/index.js';
import { isClaudeAvailable } from './claude.js';
import {
  rewriteResumeForJob,
  REVIEW_MARKER,
  RESUME_QUESTION,
} from './resume.js';

interface CliArgs {
  jobId?: number;
  help: boolean;
  /** Print the full résumé markdown instead of a preview. */
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

const USAGE = `Usage: npm run rewrite -- --job <id> [--full]

Rewrites your résumé for ONE job into a DE-CORRELATED, human-voiced, one-page
Markdown résumé tailored to that job's description. The counter-strategy against
algorithmic hiring monocultures (FAccT 2026): each application should read as an
independent draw, not one generic résumé repeated N times.

The rewrite:
  - de-correlates — leads with the project(s), framing, and keywords specific to
    THIS JD so it differs from a generic résumé;
  - reads human — varied sentence length, minimal em-dashes, no filler, your
    real voice (beats the ~1-in-3 managers running AI-detectors);
  - leads every bullet with quantified impact ($ / % / a number);
  - surfaces verifiable proof (GitHub, shipped projects);
  - stays 100% grounded in your career-ops files (cv.md, config/profile.yml,
    article-digest.md) and respects the honest gaps — nothing is fabricated.

Backend: shells out to 'claude -p'. If the Claude CLI is missing or errors, a
deterministic fallback reorders your REAL cv.md bullets by JD keyword overlap and
prefixes "${REVIEW_MARKER}" so you know to review/edit it before sending.

Options:
  --job <id>   Job id to rewrite the résumé for (required)
  --full       Print the full résumé markdown (default: a preview)
  --help       Show this help`;

function preview(text: string | null, full: boolean): string {
  if (full) return text ?? '';
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 400 ? `${t.slice(0, 397)}...` : t;
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

  console.log(
    `Rewriting résumé for job #${job.id}: ${job.role ?? '(role?)'} @ ${job.company ?? '(company?)'}`,
  );
  console.log(`  URL: ${job.url}`);
  console.log(
    `  Backend available: claude CLI ${isClaudeAvailable() ? 'FOUND' : 'NOT found (will use deterministic fallback)'}`,
  );
  console.log('');

  let result: Awaited<ReturnType<typeof rewriteResumeForJob>>;
  try {
    result = await rewriteResumeForJob(args.jobId);
  } catch (e) {
    // Terminal event so the UI live poll stops promptly on an unexpected throw.
    addEvent(args.jobId, 'rewrite.error', e instanceof Error ? e.message : String(e));
    throw e;
  }

  if (result.backend === 'paused') {
    console.log(`⏸  Paused — ${result.note}`);
    return;
  }

  console.log(`Done via '${result.backend}' backend.`);
  console.log(`  ${result.note}`);
  if (result.answerId !== null) {
    console.log(`  Saved as answer #${result.answerId} (kind='cv', "${RESUME_QUESTION}").`);
  }
  console.log('');

  // Re-read from the DB so we print exactly what was persisted.
  const saved = getAnswers(args.jobId).find((a) => a.id === result.answerId);
  if (saved) {
    console.log('Tailored résumé:');
    console.log(preview(saved.answer, args.full));
    console.log('');
  }

  console.log(
    `Review the tailored résumé in the UI, then approve before applying. ` +
      (result.backend === 'fallback'
        ? `This fallback is a mechanical reorder marked "${REVIEW_MARKER}" — sharpen it before sending.`
        : `De-correlate the NEXT application too — don't reuse this one verbatim.`),
  );
}

main().catch((err) => {
  console.error('rewrite failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
