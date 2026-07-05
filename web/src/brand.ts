// THE single place the brand lives (jobpilot-saas/BRAND.md is the canon).
// Every wordmark, title, and copy block reads from these constants.

export const BRAND = {
  /** Lowercase wordmark form — how the name is set in the logo. */
  name: 'falkyr',
  /** Sentence-case form — Falkyr as the subject of a sentence. */
  title: 'Falkyr',
  tagline: 'Hunts from your hand.',
  /** Grounded one-paragraph description (meta description / boilerplate). */
  description:
    'Falkyr is a local-first job-application agent for technical job-seekers who already pay for Claude. It hunts each role individually — every application cut from your real CV, checked line by line by a deterministic verifier, and never submitted without your release.',
  /** The naming system: everything user-facing lives in the falconer's world. */
  names: {
    /** Dashboard — where the bird rests and you see everything it sees. */
    dashboard: 'the Perch',
    /** Profile / CV source of truth — what the bird flies from. */
    profile: 'the Glove',
    /** Deterministic verifier — the tether no claim escapes. */
    verifier: 'the Jesses',
    /** A discovered role. */
    role: 'quarry',
    /** A completed tailored application awaiting your review. */
    ready: 'returned to hand',
  },
} as const;

// Back-compat exports — existing pages import these; keep them stable.
export const BRAND_TITLE = BRAND.title;
export const TAGLINE = BRAND.tagline;
