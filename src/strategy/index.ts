// Strategy orchestrator. `buildStrategyReport(id)` is the single entry point
// used by the CLI and HTTP API. It combines three PURE, dependency-free
// heuristics — NO LLM calls, no network — into one advisory report:
//
//   1. classifyMonoculture(job)  → how monocultured the screening path is,
//      and routingFor(job, risk) → channels that route around the filter,
//   2. scoreVoice(text)          → how AI-looking the generated materials read
//      (run on the concatenated cover/cv/form text; null if none exist yet),
//   3. decorrelation(jobId)      → how independent this application is from the
//      others (1 - max token-Jaccard similarity across jobs with materials).
//
// Grounding: "Algorithmic Monocultures in Hiring" (Bommasani, Bana, Creel,
// Jurafsky, Liang; FAccT 2026; arXiv:2605.27371). The engine is ADVISORY only —
// it never submits, never calls a model, and never mutates job state.
import { getAnswers, getJob } from '../db/index.js';
import type { StrategyReport, VoiceRisk } from './types.js';
import { classifyMonoculture, routingFor } from './monoculture.js';
import { scoreVoice } from './voice.js';
import { decorrelation } from './decorrelate.js';

/** Concatenate a job's generated cover + cv + form text for the voice check. */
function generatedMaterials(jobId: number): string {
  return getAnswers(jobId)
    .map((a) => a.answer ?? '')
    .filter((s) => s.trim().length > 0)
    .join('\n\n')
    .trim();
}

/**
 * Build the full advisory strategy report for `jobId`.
 * Throws if the job does not exist. Everything else is best-effort and pure.
 */
export function buildStrategyReport(jobId: number): StrategyReport {
  const job = getJob(jobId);
  if (!job) throw new Error(`buildStrategyReport: no job with id=${jobId}`);

  const monoculture = classifyMonoculture(job);
  const routing = routingFor(job, monoculture);

  const materials = generatedMaterials(jobId);
  const voice: VoiceRisk | null = materials.length > 0 ? scoreVoice(materials) : null;

  const decorrelationInfo = decorrelation(jobId);

  const summary = buildSummary(job.company, monoculture.tier, voice, decorrelationInfo.score, routing.length);

  return {
    jobId,
    monoculture,
    routing,
    voice,
    decorrelation: decorrelationInfo,
    summary,
  };
}

/** One-line, human-readable summary tying the three findings together. */
function buildSummary(
  company: string | null,
  monoTier: StrategyReport['monoculture']['tier'],
  voice: VoiceRisk | null,
  decorrelationScore: number,
  routeCount: number,
): string {
  const who = company?.trim() || 'this role';

  const mono =
    monoTier === 'high'
      ? 'HIGH monoculture risk — route around the shared screener'
      : monoTier === 'medium'
        ? 'MEDIUM monoculture risk — tailor the portal app and seek a referral'
        : 'LOW monoculture risk — a tailored, human application is the main lever';

  const voicePart = voice
    ? `voice reads ${voice.tier}-risk (${voice.score.toFixed(2)})`
    : 'no materials drafted yet for a voice check';

  const decorr =
    decorrelationScore < 0.4
      ? 'materials are too similar to other applications — de-correlate them'
      : decorrelationScore < 0.7
        ? 'materials are moderately correlated with other applications'
        : 'materials are well de-correlated from other applications';

  return `${who}: ${mono}; ${voicePart}; ${decorr}. ${routeCount} routing suggestion${routeCount === 1 ? '' : 's'}.`;
}
