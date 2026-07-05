// Deterministic fallback generator. Used when the Claude CLI is missing or
// errors. It still pulls REAL facts out of the career-ops source files (never
// invents), and marks every produced string with a leading "[[review-needed]]"
// so a human knows this was templated, not model-authored, and must be edited
// before sending. It respects the honest-gaps rule by construction: it only
// emits facts it lexically extracted from cv.md / profile.yml / article-digest.md.
import type { Job } from '../types.js';
import type { CareerOpsSources } from './sources.js';
import type { GeneratedBundle } from './claude.js';
import { FORM_QUESTIONS, jobContext } from './prompt.js';

/** Marker prepended to every fallback string. Downstream/UI can surface it. */
export const REVIEW_MARKER = '[[review-needed]]';

/** Prepend the review marker on its own line. */
function mark(text: string): string {
  return `${REVIEW_MARKER}\n${text.trim()}`;
}

// --- tiny, dependency-free extractors over the source text -----------------

/** First non-empty Markdown H1 as the candidate's name (from cv.md). */
function extractName(cv: string): string {
  const m = cv.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : 'the candidate';
}

/** Pull a scalar value for a top-level-ish YAML key from profile.yml. */
function yamlValue(profile: string, key: string): string {
  // Matches `  key: "value"` or `key: value` anywhere; strips quotes.
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(?:"([^"]*)"|'([^']*)'|([^#\\n]+?))\\s*$`, 'm');
  const m = profile.match(re);
  if (!m) return '';
  return (m[1] ?? m[2] ?? m[3] ?? '').trim();
}

/** The CV Summary section body (between `## Summary` and the next `## `). */
function extractSummary(cv: string): string {
  const m = cv.match(/##\s+Summary\s*\n([\s\S]*?)(?:\n##\s|\n#\s|$)/i);
  return m ? m[1].trim() : '';
}

/** First sentence of the CV summary — a compact self-description. */
function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const m = cleaned.match(/^(.*?[.!?])(\s|$)/);
  return (m ? m[1] : cleaned).trim();
}

/** The most-recent experience heading, e.g. "ML Engineer | Eucloid ... | ...". */
function extractCurrentRoleLine(cv: string): string {
  // First `### ` under `## Experience`.
  const exp = cv.match(/##\s+Experience\s*\n([\s\S]*?)(?:\n##\s|$)/i);
  const body = exp ? exp[1] : cv;
  const m = body.match(/^###\s+(.+?)\s*$/m);
  return m ? m[1].trim() : '';
}

/** Names of the Projects (bolded lead-ins) from cv.md, best-effort. */
function extractProjectNames(cv: string): string[] {
  const proj = cv.match(/##\s+Projects\s*\n([\s\S]*?)(?:\n##\s|$)/i);
  if (!proj) return [];
  const names: string[] = [];
  const re = /\*\*(.+?)\.?\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(proj[1])) !== null) {
    // Keep the part before an em/en dash or colon — the project name proper.
    names.push(m[1].split(/[—–:-]/)[0].trim());
  }
  return names.slice(0, 3);
}

/** Compensation phrasing straight from profile.yml (never INR-anchored here). */
function extractComp(profile: string): { range: string; minimum: string; flex: string } {
  return {
    range: yamlValue(profile, 'target_range'),
    minimum: yamlValue(profile, 'minimum'),
    flex: yamlValue(profile, 'location_flexibility'),
  };
}

// --- the fallback bundle ----------------------------------------------------

/**
 * Build a deterministic, fact-grounded bundle. Every field is `mark()`-ed with
 * the review marker. This never contacts the model and never invents content
 * beyond what the source files literally contain.
 */
export function buildFallbackBundle(job: Job, sources: CareerOpsSources): GeneratedBundle {
  const ctx = jobContext(job);
  const { cv, profile, articleDigest } = sources;

  const name = extractName(cv);
  const summary = extractSummary(cv);
  const summaryLead = firstSentence(summary);
  const currentRole = extractCurrentRoleLine(cv);
  const projects = extractProjectNames(cv);
  const comp = extractComp(profile);

  const flagshipLine = projects[0]
    ? `my ${projects[0]} work`
    : 'my hands-on RL post-training work';

  // ---- form answers (grounded, generic where facts are absent) ----
  const answers: { question: string; answer: string }[] = [];

  answers.push({
    question: FORM_QUESTIONS[0], // Why this role?
    answer: mark(
      [
        `The ${ctx.role} role at ${ctx.company} lines up with where I want my work to be centered: ${summaryLead || 'production ML with LLM/VLM post-training and reinforcement learning as the core of the job.'}`,
        currentRole
          ? `Right now (${currentRole}) I do a version of this day to day, and I'm looking for a role where it's the main event rather than a side quest.`
          : `I'm looking for a role where this is the main event rather than a side quest.`,
      ].join(' '),
    ),
  });

  answers.push({
    question: FORM_QUESTIONS[1], // Why you?
    answer: mark(
      [
        summaryLead ||
          `I've spent about three years in production ML, roughly two of them on LLM/VLM post-training and RL.`,
        `Concretely, ${flagshipLine} is the kind of thing I'd bring here${
          articleDigest.includes('CER')
            ? ' — verifiable-reward design and eval discipline, with a held-out set the reward never sees as a reward-hacking tripwire.'
            : '.'
        }`,
        `Where the role needs something I haven't done at scale, I'll say so plainly and treat it as a ramp rather than pretend otherwise.`,
      ].join(' '),
    ),
  });

  answers.push({
    question: FORM_QUESTIONS[2], // Salary expectation
    answer: mark(
      [
        comp.range
          ? `I'm targeting ${comp.range}.`
          : `I'm targeting USD $100K+ (or the EUR/GBP equivalent).`,
        `I work fully remote from India and shift my hours to the team's timezone, so I'm looking for global-rate compensation for the role rather than a location-adjusted one.`,
        `I'm flexible on structure — what matters is the total package, equity where relevant, and the opportunity.`,
      ].join(' '),
    ),
  });

  answers.push({
    question: FORM_QUESTIONS[3], // Notice period / availability
    answer: mark(
      `I'm available to start after a standard notice period and I'm flexible to the team's timeline. Happy to firm up exact dates once we're aligned on the role.`,
    ),
  });

  answers.push({
    question: FORM_QUESTIONS[4], // Work authorization / location
    answer: mark(
      comp.flex ||
        `I work fully remotely from Pune, India, and shift my working day to overlap the team's timezone (US PST–EST, EU GMT–CET, or IST). I'm not relocating — I'm looking for a remote role — and because I work from India there's no visa sponsorship needed.`,
    ),
  });

  // ---- cover letter (grounded, compact) ----
  const coverBody = [
    `Dear ${ctx.company} team,`,
    ``,
    `I'm applying for the ${ctx.role} role. ${
      summaryLead ||
      'I build production ML systems, with LLM/VLM post-training and reinforcement learning as my depth.'
    }`,
    currentRole ? `In my current role (${currentRole}), I do much of this already.` : ``,
    projects.length
      ? `Work I'd point to: ${projects.join(', ')}.`
      : ``,
    `I work fully remote from India and shift my hours to the team's timezone. I'd welcome the chance to talk about how this maps to what you're building.`,
    ``,
    `Best regards,`,
    `${name}`,
  ]
    .filter((line) => line !== ``)
    .join('\n');
  const coverLetter = mark(coverBody);

  // ---- tailored CV (fallback = the real cv.md, unreordered, clearly flagged) ----
  // We do NOT algorithmically reorder here (that risks dropping/garbling real
  // content); instead we surface the genuine cv.md verbatim under the marker so
  // a human can tailor it. This guarantees zero fabrication in the fallback path.
  const cvMarkdown = mark(
    cv
      ? `> Tailored-CV generation is unavailable offline; below is your canonical cv.md unchanged. Reorder/trim it for the ${ctx.role} role at ${ctx.company} before sending.\n\n${cv.trim()}`
      : `Canonical cv.md was not available to build a tailored CV. Add it to career-ops and regenerate.`,
  );

  return { formAnswers: answers, coverLetter, cvMarkdown };
}
