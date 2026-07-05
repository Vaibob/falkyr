// src/verify/grounding.ts
//
// Deterministic (NO LLM) fabrication tripwire for tailored résumés. A tailored
// résumé must REFORMULATE real cv.md / article-digest content, never invent
// facts. This checks each content line of a tailored résumé against the
// source-of-truth files and flags three things, worst-first:
//   1. hard flags — honest-gap landmines (PhD, top-tier papers, frontier
//      distributed RL, robotics) present in the résumé but ABSENT from the
//      sources → a likely fabricated credential.
//   2. unmatched numbers — a metric/number in the résumé that appears nowhere in
//      the sources → a likely hallucinated metric (the highest-risk fabrication).
//   3. low grounding — a line whose vocabulary barely overlaps the sources.
//
// Advisory: a deterministic aid for the human review gate, NOT a proof of
// non-fabrication. A verifier that must catch hallucination should itself be
// deterministic — never another LLM that could rationalize the fabrication.

export interface LineFinding {
  line: string;
  /** significant-token overlap with the sources, 0..1 */
  score: number;
  /** numeric tokens in the line not found in the sources */
  unmatchedNumbers: string[];
  /** honest-gap terms present in the line but absent from the sources */
  hardFlags: string[];
}

export interface GroundingReport {
  /** true when nothing was flagged */
  clean: boolean;
  totalLines: number;
  flaggedLines: number;
  /** flagged lines only, worst-first (hard flags, then numbers, then low score) */
  findings: LineFinding[];
  summary: string;
}

export interface GroundingSources {
  cv: string;
  profile: string;
  articleDigest: string;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'you', 'your',
  'our', 'their', 'will', 'have', 'has', 'had', 'not', 'but', 'they', 'them', 'its', 'into',
  'across', 'over', 'per', 'via', 'out', 'who', 'all', 'any', 'can', 'able', 'more', 'most',
  'each', 'than', 'then', 'when', 'what', 'which', 'while', 'work', 'role', 'team', 'using',
  'use', 'used', 'build', 'built', 'help', 'including', 'a', 'an', 'to', 'of', 'in', 'on', 'at',
]);

/**
 * DEFAULT honest-gap landmines (lowercased substrings). If any appears in the
 * résumé and NOT in the sources, it's a hard flag — the candidate does NOT have
 * these, so their presence implies fabrication. These defaults reflect the
 * original (RL/ML) user; a real per-user list is supplied by the caller from
 * `~/.jobpilot/config.json` (a data engineer's landmines differ entirely).
 */
export const DEFAULT_LANDMINES: readonly string[] = [
  'phd', 'ph.d', 'doctorate', 'neurips', 'icml', 'iclr', 'published', 'publication',
  'fsdp', 'deepspeed', 'megatron', 'tensor parallel', 'pipeline parallel', 'zero-3',
  'robotics', 'robot', 'embodiment', 'embodied', 'sim-to-real', 'sim2real', 'cfm',
];

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9+#.]+/g) ?? [])
    .map((t) => t.replace(/^[.]+|[.]+$/g, ''))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Numeric tokens, comma-stripped so "60,000" and "60000" compare equal. */
function numberSet(s: string): Set<string> {
  const set = new Set<string>();
  for (const m of s.toLowerCase().matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    set.add(m[0].replace(/,/g, ''));
  }
  return set;
}

/**
 * Verify a tailored résumé's grounding against the source files. Splits the
 * résumé into lines, skips headers/markers, and flags any line that trips a
 * hard flag, an unmatched number, or low token overlap.
 */
export function verifyGrounding(
  tailored: string,
  sources: GroundingSources,
  landmines: readonly string[] = DEFAULT_LANDMINES,
): GroundingReport {
  const sourceText = `${sources.cv}\n${sources.articleDigest}\n${sources.profile}`.toLowerCase();
  const sourceTokens = new Set(tokens(sourceText));
  const sourceNumbers = numberSet(sourceText);
  const activeLandmines = landmines.length > 0 ? landmines : DEFAULT_LANDMINES;

  const findings: LineFinding[] = [];
  let totalLines = 0;

  for (const rawLine of tailored.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Skip structural / non-claim lines: headings, blockquotes/markers, hrules.
    if (/^#{1,6}\s/.test(line) || line.startsWith('>') || /^[-*_]{3,}$/.test(line)) continue;
    // Strip a leading list bullet so "- " doesn't skew tokens.
    const content = line.replace(/^[-*]\s+/, '');
    const lineTokens = tokens(content);
    if (lineTokens.length < 2) continue; // too short to judge (e.g. a lone label)

    totalLines++;

    const matched = lineTokens.filter((t) => sourceTokens.has(t)).length;
    const score = Number((matched / lineTokens.length).toFixed(2));

    const lower = content.toLowerCase();
    const hardFlags = activeLandmines.filter((m) => lower.includes(m) && !sourceText.includes(m));
    const unmatchedNumbers = [...numberSet(content)].filter((n) => !sourceNumbers.has(n));

    if (hardFlags.length > 0 || unmatchedNumbers.length > 0 || score < 0.35) {
      findings.push({ line: content, score, unmatchedNumbers, hardFlags });
    }
  }

  // Worst-first: hard flags, then unmatched numbers, then lowest grounding.
  const weight = (f: LineFinding): number =>
    (f.hardFlags.length ? 1000 : 0) + f.unmatchedNumbers.length * 10 + (1 - f.score);
  findings.sort((a, b) => weight(b) - weight(a));

  const clean = findings.length === 0;
  const hard = findings.filter((f) => f.hardFlags.length).length;
  const summary = clean
    ? `Clean: all ${totalLines} content line(s) trace to your CV/profile/article-digest.`
    : `${findings.length}/${totalLines} line(s) flagged` +
      (hard ? `, ${hard} with an honest-gap term not in your sources (likely fabrication)` : '') +
      `. Review these before sending.`;

  return { clean, totalLines, flaggedLines: findings.length, findings, summary };
}
