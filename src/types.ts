// Shared TypeScript types for JobPilot.
// These mirror the SQLite tables in src/db/schema.sql EXACTLY.
// Downstream agents import from '../types.js' (ESM specifier).

/**
 * Stage enum (in workflow order). Mirrors the `stage` column on `jobs`.
 * Also used as the CHECK-free enum shared across modules.
 */
export type Stage =
  | 'discovered'
  | 'evaluated'
  | 'drafted'
  | 'ready'
  | 'approved'
  | 'applied'
  | 'responded'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'skipped';

/** Ordered list of stages (same order as the Stage union). */
export const STAGES: readonly Stage[] = [
  'discovered',
  'evaluated',
  'drafted',
  'ready',
  'approved',
  'applied',
  'responded',
  'interview',
  'offer',
  'rejected',
  'skipped',
] as const;

/**
 * A job row. Mirrors the `jobs` table exactly.
 * Nullable columns are typed `T | null` because SQLite returns null for them.
 */
export interface Job {
  id: number;
  source: string | null;
  company: string | null;
  role: string | null;
  url: string; // UNIQUE
  location: string | null;
  remote: string | null;
  comp_note: string | null;
  ats_provider: string | null;
  fit_score: number | null;
  jd_text: string | null;
  stage: Stage; // NOT NULL DEFAULT 'discovered'
  created_at: string; // DEFAULT CURRENT_TIMESTAMP
  updated_at: string; // DEFAULT CURRENT_TIMESTAMP
}

/** Kind of generated answer. Mirrors the CHECK constraint on `answers.kind`. */
export type AnswerKind = 'form' | 'cover' | 'cv';

/** An answer row. Mirrors the `answers` table exactly. */
export interface Answer {
  id: number;
  job_id: number;
  kind: AnswerKind;
  question: string | null;
  answer: string | null;
  created_at: string; // DEFAULT CURRENT_TIMESTAMP
}

/** An event row. Mirrors the `events` table exactly. */
export interface JobEvent {
  id: number;
  job_id: number;
  type: string | null;
  detail: string | null;
  created_at: string; // DEFAULT CURRENT_TIMESTAMP
}
