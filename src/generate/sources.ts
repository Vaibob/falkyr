// Reads the read-only career-ops source-of-truth files that ground every
// generation. These files are the ONLY factual basis for user-facing content
// (see career-ops CLAUDE.md "Source-of-Truth Boundary"): cv.md, profile.yml,
// article-digest.md. We never invent facts beyond what these files contain.
import { readFileSync } from 'node:fs';
import { CAREER_OPS_FILES } from '../config.js';

/** Raw text of the three grounding files, plus a note on what was missing. */
export interface CareerOpsSources {
  /** Canonical CV (Markdown). Empty string if unreadable. */
  cv: string;
  /** config/profile.yml raw text. Empty string if unreadable. */
  profile: string;
  /** article-digest.md proof points. Empty string if unreadable. */
  articleDigest: string;
  /** Human-readable names of files we could not read (for warnings/events). */
  missing: string[];
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
 * Load the career-ops grounding files. Never throws: a missing file yields an
 * empty section and is recorded in `missing` so the caller can warn/flag.
 */
export function loadCareerOpsSources(): CareerOpsSources {
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
