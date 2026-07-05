// Voice scorer. PURE HEURISTICS — no LLM, no network, no DB.
//
// Grounding: 33% of hiring managers run AI-detectors, and "too perfect" text —
// generic phrasing, uniform sentence length, zero specific lived detail, no
// quantified impact — reads as machine-authored and gets penalized. This module
// gives a DETERMINISTIC estimate of how "AI-looking" a piece of text is (higher
// score = more AI-looking = higher risk), plus concrete, actionable flags and
// suggestions. It is intentionally not an AI-detector itself; it approximates
// the signals detectors and skeptical humans key on. Advisory only.
import type { RiskTier, VoiceRisk } from './types.js';

/**
 * Generic, filler phrases that read as machine-authored or resume-boilerplate.
 * Matched case-insensitively as substrings; "responsible for" is handled
 * specially in suggestions because it usually signals a duty, not an impact.
 */
const GENERIC_PHRASES = [
  'responsible for',
  'results-driven',
  'team player',
  'proven track record',
  'passionate about',
  'leverage',
  'synergy',
  'cutting-edge',
  'fast-paced',
  'spearheaded',
  'wide range of',
  "in today's",
];

/** Common -ly adverbs whose density inflates "polished but empty" prose. */
const ADVERB_RE = /\b\w+ly\b/gi;

/** Passive-voice approximation: a be-verb followed (within a few words) by a
 * past participle. Cheap and deterministic; over/under-counts a little, which
 * is fine for a relative risk signal. */
const PASSIVE_RE = /\b(?:is|are|was|were|be|been|being)\b\s+(?:\w+\s+){0,2}\w+ed\b/gi;

/** Em-dash and its common typed proxies (spaced hyphen, double hyphen). */
const EMDASH_RE = /—|--|\s-\s/g;

/** Tokens that indicate quantified impact: numbers, %, $, and common units. */
const QUANT_RE = /(\$\s?\d|\d+(?:\.\d+)?\s?%|\b\d{2,}\b|\b\d+(?:\.\d+)?\s?(?:x|k|m|bn|b|ms|s|gb|tb|hrs?|hours?|days?|weeks?|months?|years?|pp|bps)\b)/gi;

/** Split text into sentences (crude but deterministic). */
function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Word count (unicode-word-ish, deterministic). */
function words(text: string): string[] {
  const m = text.toLowerCase().match(/[a-z0-9$%][a-z0-9$%'.-]*/gi);
  return m ?? [];
}

/** Population standard deviation. */
function stdev(nums: number[]): number {
  if (nums.length === 0) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) * (b - mean), 0) / nums.length;
  return Math.sqrt(variance);
}

/** Count non-overlapping regex matches without mutating a shared lastIndex. */
function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

/** Clamp to [0, 1]. */
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Score how AI-looking `text` is (0 = clearly human, 1 = clearly machine).
 * Deterministic: same input always yields the same score/flags/suggestions.
 *
 * Signals (each contributes a bounded amount to the score):
 *  - low sentence-length variance (uniform rhythm reads as generated),
 *  - high em-dash density (a known AI-prose tell),
 *  - generic/filler phrase hits,
 *  - high adverb + passive density,
 *  - LACK of quantified impact (few numbers / $ / %).
 */
export function scoreVoice(text: string): VoiceRisk {
  const clean = (text ?? '').trim();
  const flags: string[] = [];
  const suggestions: string[] = [];

  // Degenerate input: nothing to judge. Neutral-low, but flag it.
  if (clean.length < 40) {
    return {
      tier: 'low',
      score: 0,
      flags: ['Too little text to assess voice reliably.'],
      suggestions: ['Provide the full draft (résumé bullets / cover letter) to get a voice read.'],
    };
  }

  const sentences = splitSentences(clean);
  const allWords = words(clean);
  const wordCount = allWords.length || 1;
  const sentenceLengths = sentences.map((s) => words(s).length).filter((n) => n > 0);

  // --- Signal 1: sentence-length variance (uniform = AI-looking) ---
  // Coefficient of variation (stdev / mean). Human writing typically has a CV
  // well above ~0.4; very uniform prose sits near 0. We invert so LOW variance
  // maps to a HIGH sub-score.
  const meanLen = sentenceLengths.reduce((a, b) => a + b, 0) / (sentenceLengths.length || 1);
  const cv = meanLen > 0 ? stdev(sentenceLengths) / meanLen : 0;
  let varianceScore = 0;
  if (sentenceLengths.length >= 3) {
    // cv >= 0.5 → 0 (healthy variation); cv <= 0.1 → ~1 (robotic uniformity).
    varianceScore = clamp01((0.5 - cv) / 0.4);
    if (varianceScore > 0.5) {
      flags.push(
        `Uniform sentence length (variation coefficient ${cv.toFixed(2)}) — reads as machine-even.`,
      );
      suggestions.push(
        'Vary sentence length: cut one long sentence into two, and let at least one run short.',
      );
    }
  }

  // --- Signal 2: em-dash density ---
  const emdashes = countMatches(clean, EMDASH_RE);
  const emdashPer100 = (emdashes / wordCount) * 100;
  // ~1 per 100 words is already high for this length of copy.
  const emdashScore = clamp01(emdashPer100 / 1.5);
  if (emdashes >= 2 && emdashScore > 0.33) {
    flags.push(`High em-dash density (${emdashes} in ${wordCount} words) — a common AI-prose tell.`);
    suggestions.push('Cut the em-dashes: replace most with a period or a comma.');
  }

  // --- Signal 3: generic-phrase hits ---
  const lower = clean.toLowerCase();
  const hitPhrases = GENERIC_PHRASES.filter((p) => lower.includes(p));
  const phraseScore = clamp01(hitPhrases.length / 4);
  if (hitPhrases.length > 0) {
    flags.push(`Generic/filler phrasing: ${hitPhrases.map((p) => `"${p}"`).join(', ')}.`);
    if (lower.includes('responsible for')) {
      suggestions.push(
        `Replace "responsible for X" with the metric you moved (e.g. "cut CER ~30%/round on the Land Registry RL loop").`,
      );
    }
    suggestions.push(
      'Delete boilerplate ("results-driven", "passionate about", "team player") and state a specific, true thing instead.',
    );
  }

  // --- Signal 4: adverb + passive density ---
  const adverbs = countMatches(clean, ADVERB_RE);
  const passives = countMatches(clean, PASSIVE_RE);
  const adverbPer100 = (adverbs / wordCount) * 100;
  const passivePer100 = (passives / wordCount) * 100;
  // ~5 adverbs/100w or ~3 passives/100w starts to read as padded/evasive.
  const adverbScore = clamp01(adverbPer100 / 6);
  const passiveScore = clamp01(passivePer100 / 4);
  if (adverbScore > 0.5) {
    flags.push(`High adverb density (${adverbs} -ly adverbs in ${wordCount} words).`);
    suggestions.push('Trim -ly adverbs; let strong verbs and concrete numbers carry the weight.');
  }
  if (passiveScore > 0.5) {
    flags.push(`Heavy passive voice (~${passives} passive constructions) — obscures who did what.`);
    suggestions.push('Rewrite passive constructions in the active voice: say what YOU did.');
  }

  // --- Signal 5: LACK of quantified impact ---
  const quants = countMatches(clean, QUANT_RE);
  const quantsPer100 = (quants / wordCount) * 100;
  // Impact-led writing carries roughly >=1 quantified fact per ~40 words.
  // Sub-score is HIGH when quantification is LOW.
  const quantScore = clamp01((2.0 - quantsPer100) / 2.0);
  if (quantsPer100 < 1 && wordCount >= 40) {
    flags.push(
      `Little quantified impact (${quants} number/$/% token${quants === 1 ? '' : 's'} in ${wordCount} words) — reads as duties, not results.`,
    );
    suggestions.push(
      'Lead with impact: every claim should show money made/saved or a number moved (%, $, x, latency, throughput).',
    );
  }

  // --- Combine (weighted, bounded to [0,1]) ---
  // Weights sum to 1.0; each sub-score is already in [0,1].
  const score = clamp01(
    0.22 * varianceScore +
      0.14 * emdashScore +
      0.22 * phraseScore +
      0.1 * adverbScore +
      0.08 * passiveScore +
      0.24 * quantScore,
  );

  const tier: RiskTier = score >= 0.6 ? 'high' : score >= 0.35 ? 'medium' : 'low';

  if (flags.length === 0) {
    flags.push('No strong AI-looking tells detected — reads human.');
  }
  if (suggestions.length === 0) {
    suggestions.push('Keep the specific lived detail and natural sentence variation.');
  }

  return { tier, score: Number(score.toFixed(3)), flags, suggestions };
}
