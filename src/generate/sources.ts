// Loads the source-of-truth material that grounds every generation. Two modes:
//  - GLOVE MODE: a human-released peer card exists (web intake) — the approved
//    résumé + deterministic card renderings ground everything.
//  - FILE MODE: the read-only career-ops files (cv.md, profile.yml,
//    article-digest.md) — byte-identical to the original behavior.
// Either way, these sources are the ONLY factual basis for user-facing content
// (career-ops CLAUDE.md "Source-of-Truth Boundary"); we never invent beyond them.
import { readFileSync } from 'node:fs';
import { CAREER_OPS_FILES } from '../config.js';
import {
  getReleasedCard,
  honestGapLabels,
  peerCardToDigest,
  synthesizeProfileYaml,
} from '../profile/glove.js';

/** Raw text of the three grounding sources, plus a note on what was missing. */
export interface CareerOpsSources {
  /** Canonical CV (Markdown). Empty string if unreadable. */
  cv: string;
  /** config/profile.yml raw text (or the synthesized card YAML). */
  profile: string;
  /** article-digest.md proof points (or the card digest). */
  articleDigest: string;
  /** Human-readable names of files we could not read (for warnings/events). */
  missing: string[];
  /**
   * Confirmed honest-gap labels from the released card, for the generation
   * prompts' never-claim block. DELIBERATELY not part of the grounding text:
   * verifyGrounding reads only cv/profile/articleDigest, and gap terms in the
   * source blob would neutralize its landmine tripwire.
   */
  honestGapLabels?: string[];
}

/** Read one file, returning '' (and recording the miss) if it cannot be read. */
function readOrEmpty(path: string, label: string, missing: string[]): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    missing.push(label);
    return '';
  }
}

/**
 * Load the grounding sources. Glove mode wins when a released card exists
 * (JOBPILOT_GROUNDING=files forces file mode back); otherwise the career-ops
 * files load exactly as before. Never throws: a missing file yields an empty
 * section and is recorded in `missing` so the caller can warn/flag.
 */
export function loadCareerOpsSources(): CareerOpsSources {
  const released = getReleasedCard();
  if (released) {
    return {
      // Only human-approved material grounds: the résumé snapshotted at
      // release + deterministic renderings of the released card.
      cv: released.profile.approved_cv_md ?? '',
      profile: synthesizeProfileYaml(released.card),
      articleDigest: peerCardToDigest(released.card),
      missing: [],
      honestGapLabels: honestGapLabels(released.card),
    };
  }

  const missing: string[] = [];
  const cv = readOrEmpty(CAREER_OPS_FILES.cv, 'cv.md', missing);
  const profile = readOrEmpty(CAREER_OPS_FILES.profile, 'config/profile.yml', missing);
  const articleDigest = readOrEmpty(
    CAREER_OPS_FILES.articleDigest,
    'article-digest.md',
    missing,
  );
  return { cv, profile, articleDigest, missing };
}
