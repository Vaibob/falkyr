// Web-facing compatibility facade for the shared JobPilot contracts.
// Components keep importing from ./types.js, while the actual source of truth
// lives in src/types.ts and src/strategy/types.ts.
import type { Answer, Job, JobEvent } from '../../src/types.js';

export { STAGES } from '../../src/types.js';
export type { Answer, AnswerKind, Job, JobEvent, Stage } from '../../src/types.js';
export type {
  DecorrelationInfo,
  MonocultureRisk,
  RiskTier,
  RoutingSuggestion,
  StrategyReport,
  VoiceRisk,
} from '../../src/strategy/types.js';
export type { GroundingReport, LineFinding } from '../../src/verify/grounding.js';
export type { Profile } from '../../src/types.js';
export type {
  HonestGap,
  PeerCard,
  ProofPoint,
} from '../../src/profile/peerCard.js';

/** Shape returned by GET /api/jobs/:id. */
export interface JobDetail {
  job: Job;
  answers: Answer[];
  events: JobEvent[];
}

/** Shape returned by GET /api/profile. */
export interface ProfileStatus {
  profile: import('../../src/types.js').Profile | null;
  grounding: { active: 'glove' | 'files' | 'none'; filesMissing: string[] };
  /** cli: binary present · connected: some auth works · tokenStored: wizard token on disk. */
  claude: { cli: boolean; connected: boolean; tokenStored: boolean };
  /** Live AI-step state (distill/extract/fetch); lets the UI resume after reload. */
  intake: { busy: string | null; startedAt: string | null };
  /** Back-compat: cli && connected. */
  claudeAvailable: boolean;
}
