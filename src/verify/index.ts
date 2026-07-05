// Reusable "verify the tailored résumé for a job" entry point, shared by the
// generate/rewrite lanes, the HTTP API, and the MCP server. Reads the latest
// kind='cv' answer for the job and runs the deterministic grounding verifier
// against the peer-card sources. Returns null when no tailored CV exists yet.
import { getAnswers } from '../db/index.js';
import { loadCareerOpsSources } from '../generate/sources.js';
import { getUserConfig } from '../userconfig.js';
import { effectiveLandmines } from '../profile/glove.js';
import { verifyGrounding, type GroundingReport } from './grounding.js';

export type { GroundingReport, LineFinding } from './grounding.js';

/** Verify the most recent tailored CV for a job. Null if none has been generated. */
export function verifyJobCv(jobId: number): GroundingReport | null {
  const cv = [...getAnswers(jobId)].reverse().find((a) => a.kind === 'cv' && a.answer);
  if (!cv?.answer) return null;
  // This user's honest-gap landmines: config landmines merged with the
  // released peer card's CONFIRMED gaps (the digest deliberately excludes
  // those terms so this tripwire can actually fire — see profile/glove.ts).
  return verifyGrounding(
    cv.answer,
    loadCareerOpsSources(),
    effectiveLandmines(getUserConfig().landmines),
  );
}
