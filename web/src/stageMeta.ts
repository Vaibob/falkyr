// Presentation metadata for each pipeline Stage: short label + Tailwind color classes.
// Dark-first (Falkyr ink palette): stage color lives in a small dot and a quiet
// tinted badge — never loud. Hues still read left-to-right as the pipeline
// progresses, with rejected/skipped muted.
import type { Stage } from './types.js';

export interface StageMeta {
  /** Human label for the column header / badges. */
  label: string;
  /** Tailwind classes for the column header accent dot. */
  headerAccent: string;
  /** Tailwind classes for a small stage badge (bg + text), dark-surface friendly. */
  badge: string;
  /** Tailwind classes for the card's left border accent (muted on ink). */
  cardAccent: string;
}

export const STAGE_META: Record<Stage, StageMeta> = {
  discovered: {
    label: 'Discovered',
    headerAccent: 'bg-slate-500',
    badge: 'bg-slate-400/10 text-slate-300',
    cardAccent: 'border-l-slate-500/40',
  },
  evaluated: {
    label: 'Evaluated',
    headerAccent: 'bg-sky-400',
    badge: 'bg-sky-400/10 text-sky-300',
    cardAccent: 'border-l-sky-400/40',
  },
  drafted: {
    label: 'Drafted',
    headerAccent: 'bg-indigo-400',
    badge: 'bg-indigo-400/10 text-indigo-300',
    cardAccent: 'border-l-indigo-400/40',
  },
  ready: {
    label: 'Ready',
    headerAccent: 'bg-amber-400',
    badge: 'bg-amber-400/10 text-amber-300',
    cardAccent: 'border-l-amber-400/40',
  },
  approved: {
    label: 'Approved',
    headerAccent: 'bg-emerald-400',
    badge: 'bg-emerald-400/10 text-emerald-300',
    cardAccent: 'border-l-emerald-400/40',
  },
  applied: {
    label: 'Applied',
    headerAccent: 'bg-teal-400',
    badge: 'bg-teal-400/10 text-teal-300',
    cardAccent: 'border-l-teal-400/40',
  },
  responded: {
    label: 'Responded',
    headerAccent: 'bg-cyan-400',
    badge: 'bg-cyan-400/10 text-cyan-300',
    cardAccent: 'border-l-cyan-400/40',
  },
  interview: {
    label: 'Interview',
    headerAccent: 'bg-violet-400',
    badge: 'bg-violet-400/10 text-violet-300',
    cardAccent: 'border-l-violet-400/40',
  },
  offer: {
    label: 'Offer',
    headerAccent: 'bg-green-400',
    badge: 'bg-green-400/10 text-green-300',
    cardAccent: 'border-l-green-400/40',
  },
  rejected: {
    label: 'Rejected',
    headerAccent: 'bg-rose-500',
    badge: 'bg-rose-400/10 text-rose-300',
    cardAccent: 'border-l-rose-500/40',
  },
  skipped: {
    label: 'Skipped',
    headerAccent: 'bg-slate-600',
    badge: 'bg-slate-400/10 text-slate-400',
    cardAccent: 'border-l-slate-600/40',
  },
};

/**
 * Color classes for a fit-score chip based on the 0..1 (or 0..100) score.
 * Dark-surface friendly: a high fit earns the gold tint (the accent stays
 * scarce); everything else stays quiet ink — the number carries the data.
 */
export function fitScoreClasses(score: number | null): string {
  if (score == null) return 'bg-transparent text-[#6B7488] ring-1 ring-ink-800';
  // Accept either 0..1 or 0..100 scales.
  const pct = score <= 1 ? score * 100 : score;
  if (pct >= 80) return 'bg-gold-400/10 text-gold-300 ring-1 ring-gold-400/25';
  if (pct >= 60) return 'bg-ink-850 text-[#A7AFC2] ring-1 ring-ink-700';
  return 'bg-ink-850 text-[#6B7488] ring-1 ring-ink-700';
}

/** Format a fit score for display (e.g. 0.82 -> "82", 82 -> "82"). */
export function formatFitScore(score: number | null): string {
  if (score == null) return '—';
  const pct = score <= 1 ? score * 100 : score;
  return String(Math.round(pct));
}
