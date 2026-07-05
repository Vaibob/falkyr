// De-correlating, human-voiced résumé rewriter.
//
// `rewriteResumeForJob(jobId)` is the single entry point (used by the CLI
// src/generate/resume-cli.ts and, later, the HTTP API). It:
//   1. loads the job + career-ops source-of-truth files,
//   2. builds a STRATEGY-AWARE prompt encoding the FAccT-2026 "algorithmic
//      monoculture" counter-strategy: de-correlate (pick lead projects/framing/
//      keywords specific to THIS JD), read human (sentence-length variation,
//      minimal em-dashes, no filler, keep the real voice), lead every bullet
//      with quantified impact, surface fake-proof-proof (GitHub/projects),
//   3. runs the Claude CLI backend (`claude -p`, prompt via stdin); on any
//      failure falls back to a DETERMINISTIC template that reorders the real
//      cv.md bullets by JD keyword overlap and prefixes "[[review-needed]]",
//   4. persists the résumé via addAnswer(jobId,'cv',...), records an addEvent,
//   5. returns { backend, answerId, note }.
//
// GROUNDING INVARIANT (non-negotiable): every line the rewriter emits must
// trace to cv.md / config/profile.yml / article-digest.md plus the JD. It never
// invents a PhD, top-tier papers, frontier multi-node distributed RL, or
// robotics — those are the candidate's honest gaps and are reproduced verbatim
// into the prompt so the model cannot drift into them.
import { addAnswer, addEvent, deleteAnswersForJob, getJob } from '../db/index.js';
import type { Answer, Job } from '../types.js';
import { loadCareerOpsSources, type CareerOpsSources } from './sources.js';
import { HONEST_GAPS_RULE, POLICY_RULE, jobContext, neverClaimBlock, untrustedJdBlock } from './prompt.js';
import { isClaudeAvailable, runClaude, ClaudeUnavailableError } from './claude.js';
import { verifyJobCv } from '../verify/index.js';

/** Which backend produced the résumé. Surfaced to the caller and recorded. */
export type ResumeBackend = 'claude' | 'fallback' | 'paused';

/** Marker prepended to the fallback résumé so a human knows to review it. */
export const REVIEW_MARKER = '[[review-needed]]';

/** The question label under which the tailored résumé is stored (kind='cv'). */
export const RESUME_QUESTION = 'Tailored résumé (de-correlated)';

/**
 * Voice/de-correlation directive handed to the model verbatim. Encodes the
 * "sound human" and "de-correlate" arms of the monoculture counter-strategy
 * (Bommasani et al., FAccT 2026): ~33% of managers run AI-detectors, so
 * "too-perfect", zero-variation, em-dash-laden prose reads as machine. Kept as
 * one constant so the strategy stays consistent with the rest of generate/.
 */
export const RESUME_STRATEGY_RULE = `STRATEGY (why this résumé must be TAILORED, not generic — from "Algorithmic Monocultures in Hiring", FAccT 2026):
- ~90% of US employers screen with algorithms and a few shared vendors dominate. Identical inputs to the same vendor produce correlated outcomes: applying to N roles with one generic résumé is closer to ONE decision repeated N times than N independent chances. The counter is to make each application an INDEPENDENT draw.
- (1) DE-CORRELATE: pick the LEAD project(s), framing, and keyword emphasis that are specific to THIS job description, so this résumé measurably differs from a generic one and from what you'd send elsewhere. Foreground the one or two proof points that map most directly onto this JD's stated needs; de-emphasise (do not delete) the rest. Mirror the JD's real vocabulary onto the candidate's genuine experience.
- (2) READ HUMAN — beat the AI-detector tells: VARY sentence length (mix short punchy bullets with longer ones); use em-dashes sparingly (at most one or two in the whole document); NO generic filler ("results-driven", "proven track record", "passionate", "leveraged synergies", "spearheaded", "cutting-edge"); keep the candidate's specific lived detail and real voice from cv.md rather than smoothing it into corporate template prose. Do not open consecutive bullets with the same word.
- (3) LEAD WITH IMPACT: start every experience/project bullet with a quantified outcome — money made/saved, a percentage moved, or a concrete number (e.g. "~30% CER reduction per round", "+40% human-AI agreement, −50% manual review load", "60,000+ records"). Duties without a number go last or get cut.
- (4) SURFACE PROOF THAT CAN'T BE FAKED: include the candidate's GitHub handle and links exactly as they appear in cv.md / profile.yml, and name the shipped projects/demos so a human reviewer can verify them.
- (5) STAY GROUNDED: 100% of content traces to the source files below plus the JD. Respect the honest gaps — never invent a PhD, top-tier papers, frontier multi-node distributed RL, or robotics.`;

/**
 * Format directive: a one-page Markdown résumé. Kept separate so the fallback
 * can reference the same target shape.
 */
export const RESUME_FORMAT_RULE = `FORMAT:
- Output a SINGLE Markdown document and NOTHING else — no code fences, no commentary before or after, no JSON wrapper. Just the résumé.
- Roughly one page: an H1 name line, a one/two-line contact row (keep the real email/phone/location/GitHub from cv.md), a 2–3 sentence Summary tailored to THIS role, then the sections that matter most for THIS JD (Experience, Projects, Skills) in the order that best serves the JD. You may drop or shorten less-relevant bullets; you may NOT invent new ones.
- Keep it scannable: short section headers, tight bullets, real metrics up front.`;

/** Result the caller (CLI / API) gets back. */
export interface RewriteResult {
  backend: ResumeBackend;
  /** id of the persisted answer row, or null if nothing was saved. */
  answerId: number | null;
  /** Human-readable note: how it was produced and any caveat. */
  note: string;
  /** True when we PAUSED on a Claude usage limit instead of shipping a template. */
  paused?: boolean;
  /** For a pause: a short retry hint from the CLI, if it gave one. */
  retryHint?: string;
}

/** Options for rewriteResumeForJob. See GenerateOptions for the onLimit rationale. */
export interface RewriteOptions {
  onLimit?: 'pause' | 'fallback';
}

/**
 * Rewrite the résumé for one job and persist it. Throws ONLY if the job does
 * not exist; every backend/model failure is caught and handled by falling back
 * to the deterministic template (which is still fully grounded and marked).
 */
export async function rewriteResumeForJob(
  jobId: number,
  opts: RewriteOptions = {},
): Promise<RewriteResult> {
  const onLimit = opts.onLimit ?? 'pause';
  const job = getJob(jobId);
  if (!job) throw new Error(`rewriteResumeForJob: no job with id=${jobId}`);

  const sources = loadCareerOpsSources();
  if (sources.missing.length > 0) {
    addEvent(
      jobId,
      'rewrite',
      `warning: missing career-ops source(s): ${sources.missing.join(', ')}`,
    );
  }

  addEvent(jobId, 'rewrite', 'résumé rewrite started');

  let markdown: string;
  let backend: ResumeBackend;
  let note: string;

  if (isClaudeAvailable()) {
    try {
      const prompt = buildResumePrompt(job, sources);
      const raw = await runClaude(prompt);
      const cleaned = cleanModelResume(raw);
      if (!cleaned) {
        throw new ClaudeUnavailableError('claude produced no usable résumé markdown');
      }
      markdown = cleaned;
      backend = 'claude';
      note = 'De-correlated, human-voiced résumé generated via claude -p and grounded in career-ops files.';
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const isLimit = err instanceof ClaudeUnavailableError && err.kind === 'limit';
      const retryHint = err instanceof ClaudeUnavailableError ? err.retryHint : undefined;
      // TRUST GATE: on a transient usage limit, pause rather than overwrite the
      // existing résumé with a template. The previous CV (if any) is preserved.
      if (isLimit && onLimit === 'pause') {
        const pausedNote =
          `paused: Claude usage limit reached${retryHint ? ` — ${retryHint}` : ''}. ` +
          `Kept your existing résumé — retry when your limit resets for a fresh tailored one.`;
        addEvent(jobId, 'rewrite.paused', pausedNote);
        return { backend: 'paused', answerId: null, note: pausedNote, paused: true, retryHint };
      }
      addEvent(jobId, 'rewrite', `claude backend failed, using fallback: ${reason}`);
      markdown = buildFallbackResume(job, sources);
      backend = 'fallback';
      note = `Claude backend unavailable (${reason}); used deterministic keyword-overlap fallback. Prefixed "${REVIEW_MARKER}" — review before sending.`;
    }
  } else {
    addEvent(jobId, 'rewrite', 'claude CLI not available, using deterministic fallback');
    markdown = buildFallbackResume(job, sources);
    backend = 'fallback';
    note = `Claude CLI not found; used deterministic keyword-overlap fallback. Prefixed "${REVIEW_MARKER}" — review before sending.`;
  }

  const removed = deleteAnswersForJob(jobId, { kind: 'cv', questions: [RESUME_QUESTION] });
  if (removed > 0) {
    addEvent(jobId, 'rewrite', `removed ${removed} previous rÃ©sumÃ© rewrite(s)`);
  }

  const saved: Answer = addAnswer(jobId, 'cv', RESUME_QUESTION, markdown);

  addEvent(
    jobId,
    'rewrite',
    `résumé rewrite complete via ${backend}: answer #${saved.id} saved` +
      (backend === 'fallback' ? ` (marked ${REVIEW_MARKER})` : ''),
  );

  // Auto-run the non-fabrication verifier so the grounding result is visible.
  const report = verifyJobCv(jobId);
  if (report) {
    addEvent(jobId, report.clean ? 'verify.clean' : 'verify.flagged', report.summary);
  }

  return { backend, answerId: saved.id, note };
}

// ---------------------------------------------------------------------------
// Prompt assembly (Claude backend)
// ---------------------------------------------------------------------------

/**
 * Assemble the strategy-aware prompt. Mirrors src/generate/prompt.ts in shape
 * (guardrails first, then target role + JD, then the grounding source files,
 * then the explicit ask) but asks for a single tailored one-page Markdown
 * résumé rather than the multi-piece JSON bundle.
 */
export function buildResumePrompt(job: Job, sources: CareerOpsSources): string {
  const ctx = jobContext(job);

  return `You are rewriting ONE candidate's résumé for ONE specific job. The candidate reviews everything before it is ever sent. Your job: produce a grounded, human-sounding, DE-CORRELATED one-page résumé tailored to THIS job — never a fabricated credential, never a generic template.

${RESUME_STRATEGY_RULE}

${HONEST_GAPS_RULE}
${neverClaimBlock(sources)}

${POLICY_RULE}

${RESUME_FORMAT_RULE}

=== TARGET ROLE ===
Company: ${ctx.company}
Role: ${ctx.role}

=== JOB DESCRIPTION ===
${untrustedJdBlock(ctx.jd)}

=== CANDIDATE SOURCE OF TRUTH (the ONLY factual basis you may use) ===

--- cv.md ---
${sources.cv || '(cv.md was not available)'}

--- config/profile.yml ---
${sources.profile || '(profile.yml was not available)'}

--- article-digest.md (canonical proof points and metrics — do NOT drift these numbers) ---
${sources.articleDigest || '(article-digest.md was not available)'}

=== NOW WRITE THE RÉSUMÉ ===
Return the tailored one-page Markdown résumé and NOTHING else. Lead with the project(s) and framing that map most directly onto the "${ctx.role}" role at ${ctx.company}, lead every bullet with a real quantified impact, keep the candidate's real voice with varied sentence length and minimal em-dashes, surface the GitHub and shipped projects as verifiable proof, and stay 100% grounded in the files above while respecting the honest gaps.`;
}

/**
 * Normalise raw model stdout into résumé Markdown: strip a wrapping ```markdown
 * / ``` fence if the model added one, and trim. Returns '' if there's nothing
 * usable so the caller can fall back.
 */
export function cleanModelResume(raw: string): string {
  let text = raw.trim();
  if (!text) return '';
  // Strip a single wrapping code fence (```markdown ... ``` or ``` ... ```).
  const fence = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) text = fence[1].trim();
  return text;
}

// ---------------------------------------------------------------------------
// Deterministic fallback: reorder REAL cv.md bullets by JD keyword overlap
// ---------------------------------------------------------------------------

/**
 * Build a deterministic, fully-grounded fallback résumé when Claude is
 * unavailable. It NEVER invents: it extracts the real bullet lines out of
 * cv.md, scores each by lexical keyword overlap with the JD (so the most
 * JD-relevant real content leads — a poor-man's de-correlation), and emits a
 * one-page Markdown résumé from those real lines. Every output is prefixed with
 * the review marker so a human tailors it before sending.
 */
export function buildFallbackResume(job: Job, sources: CareerOpsSources): string {
  const ctx = jobContext(job);
  const cv = sources.cv;

  if (!cv.trim()) {
    return `${REVIEW_MARKER}\n\n> Canonical cv.md was not available, so no résumé could be built for the ${ctx.role} role at ${ctx.company}. Add cv.md to career-ops and re-run.`;
  }

  const header = extractHeader(cv);
  const jdKeywords = keywordSet(`${ctx.jd} ${ctx.role}`);

  // Rank the résumé's real bullets by overlap with the JD keywords. Ties keep
  // original CV order (stable sort) so recency/importance is preserved.
  const experience = extractSection(cv, 'Experience');
  const projects = extractSection(cv, 'Projects');
  const rankedProjects = rankBullets(extractBullets(projects), jdKeywords);
  const rankedExperience = rankBullets(extractBullets(experience), jdKeywords);

  const skills = extractSection(cv, 'Skills');
  const summary = extractSection(cv, 'Summary');

  const parts: string[] = [];
  parts.push(
    `> ${REVIEW_MARKER} — Deterministic fallback: Claude was unavailable, so this résumé reorders your REAL cv.md content by keyword overlap with the ${ctx.role} JD at ${ctx.company}. Nothing here is invented; edit the framing and trim to one page before sending.`,
  );
  parts.push('');

  // Header (name, contact line) straight from cv.md.
  if (header) parts.push(header, '');

  // Tailored-ish summary: the real CV summary, lead sentence first.
  if (summary) {
    parts.push('## Summary', '');
    parts.push(firstSentence(summary));
    parts.push('');
  }

  // Projects first when the JD's top-overlap content is a project — this is the
  // de-correlation lever: lead with the most JD-relevant REAL proof.
  if (rankedProjects.length) {
    parts.push('## Projects (most relevant to this role first)', '');
    for (const b of rankedProjects) parts.push(`- ${b.text}`);
    parts.push('');
  }

  if (rankedExperience.length) {
    parts.push('## Experience (most relevant to this role first)', '');
    for (const b of rankedExperience) parts.push(`- ${b.text}`);
    parts.push('');
  }

  if (skills) {
    parts.push('## Skills', '');
    parts.push(skills.trim());
    parts.push('');
  }

  parts.push(
    `> Proof: the GitHub handle and links from your CV header above, plus the shipped projects. This is a mechanical reorder — a human must sharpen the lead framing, cut filler, and confirm it fits one page.`,
  );

  return `${REVIEW_MARKER}\n${parts.join('\n').trim()}`;
}

// --- tiny, dependency-free extractors / rankers ----------------------------

/** A ranked bullet: the raw text plus its JD-overlap score and CV order. */
interface RankedBullet {
  text: string;
  score: number;
  order: number;
}

/**
 * The résumé header: the H1 name line plus the contiguous contact block that
 * immediately follows it (the bulleted Location/Email/... lines and the bold
 * role tagline), up to the first section heading or Summary.
 */
function extractHeader(cv: string): string {
  const lines = cv.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^##\s/.test(line)) break; // reached the first section
    // Scrub the stale "open to relocation" phrasing: it contradicts the
    // authoritative remote-only / not-relocating policy (POLICY_RULE). We drop
    // the offending sentence rather than reproduce a policy contradiction.
    out.push(line.replace(/\s*(?:Open to relocation[^.]*\.)\s*/gi, ' ').replace(/\s+$/, ''));
  }
  return out.join('\n').trim();
}

/** Body text of a `## <name>` section, up to the next `## ` (or `# `) or EOF. */
function extractSection(cv: string, name: string): string {
  const re = new RegExp(`##\\s+${name}\\b\\s*\\n([\\s\\S]*?)(?:\\n##\\s|\\n#\\s|$)`, 'i');
  const m = cv.match(re);
  return m ? m[1].trim() : '';
}

/** First sentence of a block of text — a compact self-description. */
function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const m = cleaned.match(/^(.*?[.!?])(\s|$)/);
  return (m ? m[1] : cleaned).trim();
}

/**
 * Extract résumé bullets from a section body. Handles both `- ` list items
 * (Experience) and bolded `**Name.** description` project paragraphs (Projects).
 * `### ` sub-headings (role lines) are kept as bullets too so context isn't
 * lost, but ranked like everything else.
 */
function extractBullets(section: string): string[] {
  if (!section) return [];
  const bullets: string[] = [];
  const lines = section.split(/\r?\n/);
  let currentHeading = '';
  let paragraph = '';

  const flushParagraph = () => {
    const p = paragraph.trim();
    if (p) bullets.push(p);
    paragraph = '';
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    const headingMatch = line.match(/^###\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      currentHeading = headingMatch[1].trim();
      // Emit the role/heading line itself so employer+dates survive.
      bullets.push(`**${currentHeading}**`);
      continue;
    }
    const listMatch = line.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      bullets.push(listMatch[1].trim());
      continue;
    }
    // Otherwise accumulate as a project paragraph (e.g. "**Name.** ...").
    paragraph = paragraph ? `${paragraph} ${line}` : line;
  }
  flushParagraph();
  return bullets;
}

/**
 * Rank bullets by descending JD-keyword overlap, stable on CV order for ties.
 * Heading bullets (bold-only, like a role line) get a small boost via their
 * own token overlap but are never dropped — they carry employer/date context.
 */
function rankBullets(bullets: string[], jdKeywords: Set<string>): RankedBullet[] {
  const ranked = bullets.map((text, order) => ({
    text,
    order,
    score: overlapScore(text, jdKeywords),
  }));
  ranked.sort((a, b) => (b.score - a.score) || (a.order - b.order));
  return ranked;
}

/** Count of distinct JD keywords that appear in the bullet's token set. */
function overlapScore(text: string, jdKeywords: Set<string>): number {
  if (jdKeywords.size === 0) return 0;
  const tokens = keywordSet(text);
  let score = 0;
  for (const t of tokens) if (jdKeywords.has(t)) score++;
  return score;
}

/**
 * Lowercase alphanumeric tokens of length >= 3, minus a small stop list.
 * Deliberately simple and dependency-free; good enough to float the most
 * JD-relevant real bullets to the top.
 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
  'you', 'your', 'our', 'their', 'will', 'have', 'has', 'had', 'not', 'but',
  'they', 'them', 'its', 'into', 'across', 'over', 'per', 'via', 'out', 'who',
  'all', 'any', 'can', 'able', 'more', 'most', 'each', 'than', 'then', 'when',
  'what', 'which', 'while', 'work', 'working', 'role', 'team', 'teams', 'using',
  'use', 'used', 'build', 'built', 'building', 'help', 'including',
]);

function keywordSet(text: string): Set<string> {
  const set = new Set<string>();
  const matches = text.toLowerCase().match(/[a-z0-9+#.]+/g);
  if (!matches) return set;
  for (const raw of matches) {
    const t = raw.replace(/^[.]+|[.]+$/g, ''); // trim stray dots
    if (t.length < 3) continue;
    if (STOP_WORDS.has(t)) continue;
    set.add(t);
  }
  return set;
}
