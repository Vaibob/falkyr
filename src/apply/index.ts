// src/apply/index.ts
//
// Public surface of the autofill lane. The Fastify API imports `applyToJob`
// from here (see POST /api/jobs/:id/apply). Everything the server needs is
// re-exported; the CLI lives in cli.ts.

export { applyToJob, resolveCvPath, IDENTITY_FIELDS } from './autofill.js';
export type { ApplyMode, ApplyResult } from './autofill.js';
export { loadCandidateProfile } from './profile.js';
export type { CandidateProfile } from './profile.js';
