// The peer card — the structured, human-released document at the heart of the
// Glove. Distill output is validated against this schema; the release gate
// (releaseBlockers) adds the business rules zod's shape can't express.
//
// TRUST INVARIANT: a card object on its own proves nothing — only the copy
// stored in the profile table's `peer_card` column (written exclusively by
// POST /api/profile/approve) grounds generation/verification. Pipeline
// metadata (distilled_at, inputs_hash, model) lives in DB columns BESIDE the
// JSON so review-stage edits cannot forge provenance.
import { z } from 'zod';

/** Where a claim came from. 'user' = hand-added/edited in Review. */
export const PROVENANCE_SOURCES = [
  'resume',
  'github',
  'portfolio',
  'essay',
  'linkedin-paste',
  'user',
] as const;

export const provenanceSchema = z.object({
  source: z.enum(PROVENANCE_SOURCES),
  /** Short quote from the shown input that justifies the claim (chip tooltip). */
  excerpt: z.string().trim().min(1).max(300).optional(),
});

export const identitySchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  /** One-line professional headline, e.g. "ML engineer — RL post-training". */
  headline: z.string().trim().max(160).optional(),
  email: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  /** Display form, e.g. "Pune, India (remote-first)". */
  location: z.string().trim().max(120).optional(),
  city: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
  links: z
    .object({
      github: z.string().trim().max(200).optional(),
      linkedin: z.string().trim().max(200).optional(),
      portfolio: z.string().trim().max(200).optional(),
      twitter: z.string().trim().max(200).optional(),
    })
    .default({}),
});

export const archetypeSchema = z.object({
  /** "Backend engineer who owns data-heavy services" — a reading, not a title copy. */
  title: z.string().trim().min(1).max(120),
  strength: z.enum(['primary', 'adjacent', 'stretch']),
  why: z.string().trim().min(1).max(400),
  provenance: z.array(provenanceSchema).min(1).max(4),
});

export const proofPointSchema = z.object({
  /** Atomic, reusable claim. */
  claim: z.string().trim().min(1).max(400),
  /** The receipts: why a peer would believe it, in the source's own terms. */
  evidence: z.string().trim().min(1).max(600),
  /** Figures VERBATIM from the source — never rounded/reworded (the verifier
   *  matches numbers exactly). */
  metrics: z.array(z.string().trim().min(1).max(80)).max(6).default([]),
  provenance: z.array(provenanceSchema).min(1).max(4),
});

export const voiceSchema = z.object({
  summary: z.string().trim().max(600).default(''),
  traits: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  /** Phrases that would ring false in this candidate's mouth. */
  avoid: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  /** Verbatim essay lines that capture the real register. */
  sampleLines: z.array(z.string().trim().min(1).max(300)).max(3).default([]),
});

export const huntingGroundsSchema = z.object({
  targetTitles: z.array(z.string().trim().min(2).max(80)).min(1).max(15),
  /** Lowercase substrings — feeds the ingest title filter. */
  keywords: z
    .array(z.string().trim().toLowerCase().min(2).max(60))
    .min(1)
    .max(30),
  companyShapes: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  avoidTitles: z.array(z.string().trim().min(1).max(80)).max(15).default([]),
  seniority: z.string().trim().max(60).optional(),
});

export const honestGapSchema = z.object({
  /** Lowercase substring for the deterministic verifier (landmine form). */
  term: z.string().trim().toLowerCase().min(2).max(60),
  /** Human label: "PhD / doctorate". */
  label: z.string().trim().min(1).max(160),
  /** The ask: "Peers in your role usually claim a PhD — do you?" */
  question: z.string().trim().min(1).max(300),
  /** Only 'confirmed-gap' entries become landmines; 'unsure' blocks release. */
  status: z.enum(['unsure', 'confirmed-gap', 'have-it']).default('unsure'),
  note: z.string().trim().max(300).optional(),
});

export const policySchema = z.object({
  /** Verbatim phrasing — never currency-converted or rounded. */
  compTarget: z.string().trim().max(120).optional(),
  compMinimum: z.string().trim().max(120).optional(),
  locationFlexibility: z.string().trim().max(300).optional(),
  workAuthorization: z.string().trim().max(300).optional(),
  noticePeriod: z.string().trim().max(120).optional(),
});

export const peerCardSchema = z.object({
  version: z.literal(1),
  identity: identitySchema,
  archetypes: z.array(archetypeSchema).min(1).max(3),
  // Prompt targets 5–12 proof points; min(1) keeps thin-but-honest inputs parseable.
  proofPoints: z.array(proofPointSchema).min(1).max(12),
  voice: voiceSchema,
  huntingGrounds: huntingGroundsSchema,
  honestGaps: z.array(honestGapSchema).max(12).default([]),
  policy: policySchema.default({}),
});

export type PeerCard = z.infer<typeof peerCardSchema>;
export type HonestGap = z.infer<typeof honestGapSchema>;
export type ProofPoint = z.infer<typeof proofPointSchema>;

/**
 * Release-gate business rules on top of shape validation. Returns
 * human-readable blockers; empty array = releasable. Server-enforced by
 * POST /api/profile/approve, echoed verbatim by the UI.
 */
export function releaseBlockers(card: PeerCard): string[] {
  const blockers: string[] = [];
  const unsure = card.honestGaps.filter((g) => g.status === 'unsure');
  if (unsure.length > 0) {
    blockers.push(
      `Answer the honest-gap question${unsure.length === 1 ? '' : 's'} before releasing: ${unsure
        .map((g) => g.label)
        .join(' · ')}`,
    );
  }
  // Shape rules (≥1 archetype, ≥1 proof point, fullName, hunting grounds
  // non-empty) are already enforced by peerCardSchema.
  return blockers;
}

/** Parse a stored peer-card JSON string. Returns null (never throws) on any failure. */
export function parseStoredCard(json: string | null): PeerCard | null {
  if (!json) return null;
  try {
    const result = peerCardSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
