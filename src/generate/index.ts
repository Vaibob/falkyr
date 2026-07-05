// Generation orchestrator. `generateForJob(id)` is the single entry point used
// by both the CLI (src/generate/cli.ts) and the HTTP API
// (POST /api/jobs/:id/generate). It:
//   1. loads the job + career-ops source-of-truth files,
//   2. builds a grounded prompt (honest-gaps rule baked in),
//   3. runs the Claude CLI backend; on any failure falls back to a deterministic
//      template that still pulls real facts and marks output "[[review-needed]]",
//   4. persists every piece via addAnswer(kind='form'|'cover'|'cv'),
//   5. records events and advances the job to stage 'drafted'.
import { addAnswer, addEvent, deleteAnswersForJob, getJob, setStage } from '../db/index.js';
import type { Answer, Job } from '../types.js';
import { loadCareerOpsSources } from './sources.js';
import { FORM_QUESTIONS, buildPrompt } from './prompt.js';
import {
  coerceBundle,
  extractJson,
  isClaudeAvailable,
  runClaude,
  ClaudeUnavailableError,
  type GeneratedBundle,
} from './claude.js';
import { buildFallbackBundle, REVIEW_MARKER } from './fallback.js';
import { verifyJobCv } from '../verify/index.js';

/** Which backend produced the bundle — surfaced to callers and recorded. */
export type GenerationBackend = 'claude' | 'fallback' | 'paused';

/** Result of generating for one job. */
export interface GenerationResult {
  jobId: number;
  backend: GenerationBackend;
  /** Human-readable reason the fallback/pause happened, if any. */
  fallbackReason?: string;
  /** True when we PAUSED on a Claude usage limit instead of shipping a template. */
  paused?: boolean;
  /** For a pause: a short retry hint from the CLI, if it gave one. */
  retryHint?: string;
  /** Persisted answer rows (form answers + cover + cv). Empty when paused. */
  answers: Answer[];
  /** Source files that could not be read (empty when all present). */
  missingSources: string[];
}

/** Options for generateForJob. */
export interface GenerateOptions {
  /**
   * What to do when Claude reports a usage/rate limit.
   *   'pause' (default): do NOT persist a template — return a paused result so the
   *     caller can tell the user to retry when their limit resets. This protects
   *     the candidate from unknowingly sending template-grade materials.
   *   'fallback': degrade to the deterministic template (marked for review).
   */
  onLimit?: 'pause' | 'fallback';
}

const GENERATED_QUESTIONS = [
  ...FORM_QUESTIONS,
  'Cover letter',
  'Tailored CV (Markdown)',
] as const;

/**
 * Generate application materials for `id` and persist them.
 * Throws only if the job does not exist; all backend/model failures are handled
 * internally by falling back to the deterministic template.
 */
export async function generateForJob(
  id: number,
  opts: GenerateOptions = {},
): Promise<GenerationResult> {
  const onLimit = opts.onLimit ?? 'pause';
  const job = getJob(id);
  if (!job) throw new Error(`generateForJob: no job with id=${id}`);

  const sources = loadCareerOpsSources();
  if (sources.missing.length > 0) {
    addEvent(
      id,
      'generate',
      `warning: missing career-ops source(s): ${sources.missing.join(', ')}`,
    );
  }

  addEvent(id, 'generate', 'generation started');

  let bundle: GeneratedBundle;
  let backend: GenerationBackend;
  let fallbackReason: string | undefined;

  if (isClaudeAvailable()) {
    try {
      const prompt = buildPrompt(job, sources);
      const raw = await runClaude(prompt);
      const parsed = extractJson(raw);
      const coerced = parsed ? coerceBundle(parsed) : null;
      if (!coerced) {
        throw new Error('claude output was not parseable into the expected bundle');
      }
      bundle = coerced;
      backend = 'claude';
    } catch (err) {
      fallbackReason = err instanceof Error ? err.message : String(err);
      const isLimit = err instanceof ClaudeUnavailableError && err.kind === 'limit';
      const retryHint = err instanceof ClaudeUnavailableError ? err.retryHint : undefined;
      // TRUST GATE: on a transient usage limit, do NOT silently ship a template.
      // Pause and let the user retry with real Claude when their limit resets.
      if (isLimit && onLimit === 'pause') {
        const note =
          `paused: Claude usage limit reached${retryHint ? ` — ${retryHint}` : ''}. ` +
          `No template was saved — retry when your limit resets to get real Claude output.`;
        addEvent(id, 'generate.paused', note);
        return {
          jobId: id,
          backend: 'paused',
          paused: true,
          retryHint,
          fallbackReason,
          answers: [],
          missingSources: sources.missing,
        };
      }
      addEvent(id, 'generate', `claude backend failed, using fallback: ${fallbackReason}`);
      bundle = buildFallbackBundle(job, sources);
      backend = 'fallback';
    }
  } else {
    fallbackReason = 'claude CLI not available';
    addEvent(id, 'generate', 'claude CLI not available, using deterministic fallback');
    bundle = buildFallbackBundle(job, sources);
    backend = 'fallback';
  }

  const removed = deleteAnswersForJob(job.id, { questions: GENERATED_QUESTIONS });
  if (removed > 0) {
    addEvent(id, 'generate', `removed ${removed} stale generated answer(s)`);
  }

  const answers = persistBundle(job, bundle);

  addEvent(
    id,
    'generate',
    `generation complete via ${backend}: ${answers.length} answer(s) saved` +
      (backend === 'fallback' ? ` (marked ${REVIEW_MARKER})` : ''),
  );

  // Auto-run the non-fabrication verifier on the freshly tailored CV so the
  // result is visible in the review flow without anyone remembering to call it.
  const report = verifyJobCv(id);
  if (report) {
    addEvent(id, report.clean ? 'verify.clean' : 'verify.flagged', report.summary);
  }

  // Advance the pipeline: discovered/evaluated -> drafted. Never downgrade a
  // job that a human already moved forward (approved/applied/etc.).
  if (job.stage === 'discovered' || job.stage === 'evaluated') {
    setStage(id, 'drafted', `drafted via generate (${backend})`);
  }

  return {
    jobId: id,
    backend,
    fallbackReason,
    answers,
    missingSources: sources.missing,
  };
}

/**
 * Persist a bundle. Form answers are stored one row each (kind='form') so the
 * autofill module can match them to individual form fields; the cover letter
 * and tailored CV are single rows (kind='cover' / kind='cv').
 */
function persistBundle(job: Job, bundle: GeneratedBundle): Answer[] {
  const saved: Answer[] = [];

  for (const fa of bundle.formAnswers) {
    saved.push(addAnswer(job.id, 'form', fa.question, fa.answer));
  }
  if (bundle.coverLetter) {
    saved.push(addAnswer(job.id, 'cover', 'Cover letter', bundle.coverLetter));
  }
  if (bundle.cvMarkdown) {
    saved.push(addAnswer(job.id, 'cv', 'Tailored CV (Markdown)', bundle.cvMarkdown));
  }

  return saved;
}
