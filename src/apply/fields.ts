// src/apply/fields.ts
//
// Pure (DOM-free) heuristics for application forms:
//   1. A catalogue of the common identity fields (name, email, phone, ...) and
//      the keyword patterns that identify each one from a field's visible label,
//      placeholder, name, id, or aria-label.
//   2. A fuzzy matcher used to align *generated* form answers (from the
//      `answers` table, kind='form') to arbitrary custom questions on a form by
//      comparing their question text to the label.
//
// Keeping this logic here (separate from the Playwright driver) makes it
// deterministic and unit-testable without launching a browser.

import type { CandidateProfile } from './profile.js';

/** Stable keys for the identity fields we know how to fill. */
export type IdentityFieldKey =
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'location'
  | 'city'
  | 'country'
  | 'linkedin'
  | 'github'
  | 'portfolio'
  | 'twitter';

/** A descriptor: how to recognize a field, and how to get its value. */
export interface IdentityField {
  key: IdentityFieldKey;
  /** Human label for logging. */
  label: string;
  /**
   * Ordered keyword groups. A candidate label matches this field when it
   * contains ALL tokens of ANY one group. More specific fields (first/last
   * name) are listed before generic ones (name) so they win during ranking.
   */
  patterns: string[][];
  /** Pull this field's value out of the candidate profile. */
  value: (p: CandidateProfile) => string | undefined;
}

/**
 * Field catalogue, ordered most-specific first. Order matters: `bestIdentityField`
 * prefers the earliest field on an equal score, so "First name" resolves to
 * `firstName` rather than the broader `fullName`.
 */
export const IDENTITY_FIELDS: readonly IdentityField[] = [
  {
    key: 'firstName',
    label: 'First name',
    patterns: [['first', 'name'], ['given', 'name'], ['forename']],
    value: (p) => p.firstName,
  },
  {
    key: 'lastName',
    label: 'Last name',
    patterns: [['last', 'name'], ['family', 'name'], ['surname']],
    value: (p) => p.lastName,
  },
  {
    key: 'fullName',
    label: 'Full name',
    patterns: [['full', 'name'], ['your', 'name'], ['name']],
    value: (p) => p.fullName,
  },
  {
    key: 'email',
    label: 'Email',
    patterns: [['email'], ['e-mail']],
    value: (p) => p.email,
  },
  {
    key: 'phone',
    label: 'Phone',
    patterns: [['phone'], ['mobile'], ['telephone'], ['contact', 'number']],
    value: (p) => p.phone,
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    patterns: [['linkedin']],
    value: (p) => p.linkedin,
  },
  {
    key: 'github',
    label: 'GitHub',
    patterns: [['github']],
    value: (p) => p.github,
  },
  {
    key: 'twitter',
    label: 'Twitter/X',
    patterns: [['twitter'], ['x profile'], ['x.com']],
    value: (p) => p.twitter,
  },
  {
    key: 'portfolio',
    label: 'Portfolio/Website',
    patterns: [['portfolio'], ['personal', 'website'], ['website'], ['personal', 'site']],
    value: (p) => p.portfolio,
  },
  {
    key: 'city',
    label: 'City',
    patterns: [['city'], ['town']],
    value: (p) => p.city,
  },
  {
    key: 'country',
    label: 'Country',
    patterns: [['country']],
    value: (p) => p.country,
  },
  {
    key: 'location',
    label: 'Location',
    patterns: [['location'], ['where', 'located'], ['based'], ['address']],
    value: (p) => p.location,
  },
];

/**
 * Label tokens that indicate a NON-person "name" field. `fullName` can win via
 * its bare single-token ['name'] group (score 1) — but a control labeled
 * "Company name" / "Product name" / etc. (or whose name/id attribute merely
 * contains "name") must NOT receive the candidate's full name. If the bare
 * 'name' match is the ONLY thing that fired and one of these tokens is present,
 * we reject the identity match.
 */
const NAME_DISQUALIFIERS = [
  'company', 'organization', 'organisation', 'employer', 'business', 'product',
  'project', 'reference', 'referrer', 'referral', 'file', 'user', 'account',
  'domain', 'event', 'brand', 'school', 'university', 'college', 'team', 'manager',
];

/** Lowercase + collapse punctuation/whitespace for robust token matching. */
export function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-/]+/g, ' ')
    .replace(/[^a-z0-9@.+ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does `haystack` (normalized) contain every token of the group? */
function matchesGroup(haystack: string, group: string[]): boolean {
  return group.every((tok) => haystack.includes(tok));
}

/**
 * Choose the best identity field for a given label text. Returns the matching
 * descriptor and its resolved value, or null if nothing matches or the profile
 * has no value for it.
 *
 * Scoring: a field's score is the number of tokens in its longest matching
 * group (so a two-word group like ["first","name"] beats a one-word ["name"]).
 * Ties break toward the earlier (more specific) catalogue entry.
 */
export function bestIdentityField(
  label: string,
  profile: CandidateProfile,
): { field: IdentityField; value: string } | null {
  const hay = normalizeLabel(label);
  if (!hay) return null;

  let best: { field: IdentityField; score: number } | null = null;

  for (const field of IDENTITY_FIELDS) {
    let score = 0;
    for (const group of field.patterns) {
      if (matchesGroup(hay, group)) score = Math.max(score, group.length);
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { field, score };
    }
  }

  if (!best) return null;
  // Guard the generic "name" collision: only fullName can win via the bare
  // 1-token 'name' group (score 1). If it did AND the label names a non-person
  // entity ("Company name", etc.), reject rather than type the candidate's name
  // into the wrong field.
  if (best.field.key === 'fullName' && best.score === 1 && NAME_DISQUALIFIERS.some((d) => hay.includes(d))) {
    return null;
  }
  const value = best.field.value(profile);
  if (!value) return null;
  return { field: best.field, value };
}

// ---------------------------------------------------------------------------
// Fuzzy matching of generated answers to custom questions
// ---------------------------------------------------------------------------

/** Tokenize into a set of meaningful words, dropping tiny stopwords. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are',
  'you', 'your', 'we', 'our', 'do', 'did', 'have', 'has', 'with', 'what',
  'why', 'how', 'please', 'this', 'that', 'be', 'at', 'as', 'if', 'about',
]);

function tokenSet(s: string): Set<string> {
  const set = new Set<string>();
  for (const tok of normalizeLabel(s).split(' ')) {
    if (tok.length >= 3 && !STOPWORDS.has(tok)) set.add(tok);
  }
  return set;
}

/**
 * Jaccard-like similarity between two question strings in [0,1]: size of the
 * token intersection over the size of the smaller token set (so a short label
 * fully contained in a longer generated question still scores high).
 */
export function questionSimilarity(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / Math.min(sa.size, sb.size);
}

/** A generated answer keyed by the question it was written for. */
export interface GeneratedAnswer {
  question: string;
  answer: string;
}

/**
 * Given a form field's label and the pool of generated answers, return the
 * best-matching answer if its similarity clears `threshold`. Used only for
 * free-text custom questions the identity catalogue does not cover.
 */
export function bestAnswerForLabel(
  label: string,
  answers: readonly GeneratedAnswer[],
  threshold = 0.5,
): { answer: GeneratedAnswer; score: number } | null {
  let best: { answer: GeneratedAnswer; score: number } | null = null;
  for (const a of answers) {
    if (!a.question || !a.answer) continue;
    const score = questionSimilarity(label, a.question);
    if (score >= threshold && (!best || score > best.score)) {
      best = { answer: a, score };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Typed-control question classification (selects / radios / checkboxes)
// ---------------------------------------------------------------------------

/**
 * Category of a non-free-text question, used to decide the safe action:
 *   - 'eeo'         → demographic self-ID: DECLINE (or leave blank). Never guess.
 *   - 'work-auth'   → legal work-authorization: LEAVE BLANK + flag for the user.
 *   - 'sponsorship' → visa sponsorship: LEAVE BLANK + flag for the user.
 *   - 'consent'     → "I agree / privacy policy": safe to check (user reviews before submit).
 *   - 'benign'      → everything else (country, "how did you hear", …): fill when confident.
 */
export type QuestionCategory = 'eeo' | 'work-auth' | 'sponsorship' | 'consent' | 'benign';

const EEO_PATTERNS = [
  'race', 'ethnic', 'gender', 'sex', 'disab', 'veteran', 'sexual orientation',
  'self identif', 'hispanic', 'latino', 'lgbt', 'pronoun', 'transgender', 'national origin',
];
const SPONSORSHIP_PATTERNS = ['sponsor', 'visa'];
const WORK_AUTH_PATTERNS = [
  'authorized to work', 'legally authorized', 'right to work', 'work authorization',
  'eligible to work', 'work permit', 'authorised to work',
];
const CONSENT_PATTERNS = [
  'i agree', 'i consent', 'i certify', 'i acknowledge', 'privacy policy', 'terms and',
  'gdpr', 'data processing', 'consent to', 'i understand',
];

/** Classify a control's question label into a safe-action category. */
export function classifyQuestion(label: string): QuestionCategory {
  const h = normalizeLabel(label);
  if (!h) return 'benign';
  if (EEO_PATTERNS.some((p) => h.includes(p))) return 'eeo';
  if (SPONSORSHIP_PATTERNS.some((p) => h.includes(p))) return 'sponsorship';
  if (WORK_AUTH_PATTERNS.some((p) => h.includes(p))) return 'work-auth';
  if (CONSENT_PATTERNS.some((p) => h.includes(p))) return 'consent';
  return 'benign';
}

const DECLINE_PATTERNS = [
  'decline', 'prefer not', 'do not wish', 'don t wish', 'not to answer',
  'not to disclose', 'choose not', 'rather not', 'not wish to', 'i don t want',
];

/** From a list of option labels, return the one that means "decline to answer", or null. */
export function pickDeclineOption(options: readonly string[]): string | null {
  for (const o of options) {
    if (DECLINE_PATTERNS.some((p) => normalizeLabel(o).includes(p))) return o;
  }
  return null;
}

/**
 * Match a desired value (e.g. the candidate's country) to the best option label
 * in a dropdown. Exact match wins, then containment, then token similarity ≥ 0.5.
 * Returns null if nothing is confidently close (we never guess).
 */
export function matchOption(options: readonly string[], desired: string): string | null {
  const d = normalizeLabel(desired);
  if (!d) return null;
  let best: { o: string; score: number } | null = null;
  for (const o of options) {
    const n = normalizeLabel(o);
    if (!n) continue;
    let score = 0;
    if (n === d) score = 3;
    else if (n.includes(d) || d.includes(n)) score = 2;
    else if (questionSimilarity(o, desired) >= 0.5) score = 1;
    if (score > 0 && (!best || score > best.score)) best = { o, score };
  }
  return best?.o ?? null;
}
