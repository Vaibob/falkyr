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

/**
 * The Glove — single-row candidate profile. Mirrors the `profile` table exactly.
 * TRUST INVARIANT: grounding reads only `peer_card` (the human-released card)
 * and `approved_cv_md`; `peer_card_draft` and fetched caches never ground.
 * The peer-card JSON shape is validated by src/profile/peerCard.ts (zod).
 */
export interface Profile {
  id: 1;
  // gathered inputs
  cv_md: string | null;
  essay_work: string | null;
  essay_target: string | null;
  essay_edge: string | null;
  github_username: string | null;
  portfolio_url: string | null;
  linkedin_url: string | null;
  linkedin_paste: string | null;
  // fetched caches (deterministic renderings, shown verbatim)
  github_md: string | null;
  github_fetched_at: string | null;
  github_error: string | null;
  portfolio_text: string | null;
  portfolio_fetched_at: string | null;
  portfolio_error: string | null;
  // peer card: draft vs released
  peer_card_draft: string | null;
  draft_distilled_at: string | null;
  draft_inputs_hash: string | null;
  draft_model: string | null;
  peer_card: string | null;
  peer_card_approved_at: string | null;
  approved_inputs_hash: string | null;
  approved_cv_md: string | null;
  created_at: string;
  updated_at: string;
}
