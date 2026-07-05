// De-correlation checker. PURE HEURISTICS over the local DB — no LLM, no network.
//
// Grounding: under an algorithmic monoculture, N applications with identical
// inputs are closer to ONE decision repeated N times than N independent
// chances. The counter-strategy is to DE-CORRELATE: tailor each application
// (different lead projects, framing, keywords) so you become independent draws.
// This module measures how much THIS job's generated materials overlap the
// materials generated for OTHER jobs, using token Jaccard over lowercased word
// sets. score = 1 - maxSimilarity (1.0 when nothing else to compare against),
// so a HIGH score means "nicely de-correlated" and a LOW score means "too
// similar — vary it". Advisory only.
import { getAnswers, getJobs } from '../db/index.js';
import type { Answer } from '../types.js';
import type { DecorrelationInfo } from './types.js';

/** Concatenate all of a job's generated answer text into one lowercased blob. */
function materialsText(answers: Answer[]): string {
  return answers
    .map((a) => `${a.question ?? ''} ${a.answer ?? ''}`)
    .join(' ')
    .toLowerCase();
}

/** Very common words to ignore so similarity reflects substance, not grammar. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with',
  'at', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'this', 'that', 'these', 'those', 'it', 'its', 'i', 'im', "i'm", 'my', 'me',
  'we', 'our', 'you', 'your', 'they', 'their', 'he', 'she', 'his', 'her',
  'so', 'if', 'then', 'than', 'not', 'no', 'do', 'does', 'did', 'have', 'has',
  'had', 'will', 'would', 'can', 'could', 'should', 'about', 'into', 'over',
  'out', 'up', 'down', 'more', 'most', 'some', 'any', 'all', 'each', 'where',
  'when', 'what', 'which', 'who', 'how', 'why', 'there', 'here', 'am',
]);

/** Build a set of meaningful lowercased word tokens (stopwords + short removed). */
function tokenSet(text: string): Set<string> {
  const raw = text.match(/[a-z0-9][a-z0-9'-]*/gi) ?? [];
  const set = new Set<string>();
  for (const w of raw) {
    const t = w.toLowerCase();
    if (t.length < 3) continue;
    if (STOPWORDS.has(t)) continue;
    set.add(t);
  }
  return set;
}

/** Jaccard similarity of two token sets: |A ∩ B| / |A ∪ B|, in [0,1]. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  // Iterate the smaller set for the intersection count.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) {
    if (large.has(t)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Compute how de-correlated `jobId`'s generated materials are from every OTHER
 * job that also has materials. Returns score = 1 - maxSimilarity (so higher is
 * better / more independent), the top-3 most-similar jobs, and paper-grounded
 * advice. If this job has no materials, or no OTHER job does, similarity is 0
 * and the score is a clean 1.0.
 */
export function decorrelation(jobId: number): DecorrelationInfo {
  const thisAnswers = getAnswers(jobId);
  const thisTokens = tokenSet(materialsText(thisAnswers));

  // No materials for this job yet → nothing to correlate; treat as independent.
  if (thisTokens.size === 0) {
    return {
      score: 1,
      similarTo: [],
      advice:
        'No generated materials for this job yet — generate a tailored draft, then re-check that it does not read like a clone of your other applications.',
    };
  }

  const others = getJobs().filter((j) => j.id !== jobId);
  const sims: { jobId: number; company: string | null; similarity: number }[] = [];

  for (const other of others) {
    const otherTokens = tokenSet(materialsText(getAnswers(other.id)));
    if (otherTokens.size === 0) continue; // no materials to compare against
    const sim = jaccard(thisTokens, otherTokens);
    sims.push({ jobId: other.id, company: other.company, similarity: Number(sim.toFixed(3)) });
  }

  // No other job has materials → this application is (trivially) independent.
  if (sims.length === 0) {
    return {
      score: 1,
      similarTo: [],
      advice:
        'This is the only application with generated materials so far — nothing to correlate against yet. As you draft more, keep varying lead projects and framing so they stay independent draws.',
    };
  }

  sims.sort((a, b) => b.similarity - a.similarity);
  const maxSim = sims[0].similarity;
  const score = Number((1 - maxSim).toFixed(3));
  const similarTo = sims.slice(0, 3);

  const advice = adviceFor(score, maxSim, similarTo[0]);

  return { score, similarTo, advice };
}

/** Paper-grounded advice keyed on how similar the nearest other application is. */
function adviceFor(
  score: number,
  maxSim: number,
  nearest: { jobId: number; company: string | null; similarity: number } | undefined,
): string {
  const near = nearest?.company?.trim() || (nearest ? `job #${nearest.jobId}` : 'another job');
  const pct = Math.round(maxSim * 100);

  if (score < 0.4) {
    return `Too similar: this draft overlaps ~${pct}% with your ${near} application. Under an algorithmic monoculture that makes them one repeated bet, not independent draws — vary the LEAD project, the framing, and the keywords so the two applications de-correlate.`;
  }
  if (score < 0.7) {
    return `Moderately correlated (~${pct}% overlap with ${near}). Swap in a different lead project or reframe the opening so this reads as an independent application rather than a template refill.`;
  }
  return `Well de-correlated (only ~${pct}% overlap with the nearest other application, ${near}). Keep leading with role-specific projects and framing so each application stays an independent draw.`;
}
