// src/apply/profile.ts
//
// Reads the candidate's identity (name, email, phone, location, links) from the
// READ-ONLY career-ops profile at `config/profile.yml`. This is the single
// source of truth for who is applying — the autofill engine never invents
// personal data, it only mirrors what the user has already put in that file.
//
// We deliberately do NOT depend on `js-yaml`: package.json is owned by the
// Scaffold agent and does not declare a YAML parser. The `candidate:` block we
// care about is a flat, quoted key/value map, so a tiny purpose-built reader is
// sufficient and keeps this lane dependency-free.

import { readFileSync, existsSync } from 'node:fs';
import { CAREER_OPS_FILES } from '../config.js';
import { getReleasedCard, synthesizeProfileYaml } from '../profile/glove.js';

/** Candidate identity, normalized for form-filling. All fields optional. */
export interface CandidateProfile {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  location?: string;
  city?: string;
  country?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  twitter?: string;
}

/** Strip surrounding quotes and trailing inline comments from a YAML scalar. */
function cleanScalar(raw: string): string {
  let v = raw.trim();
  // Drop a trailing inline comment that is NOT inside quotes.
  if (!(v.startsWith('"') || v.startsWith("'"))) {
    const hash = v.indexOf(' #');
    if (hash !== -1) v = v.slice(0, hash).trim();
  }
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v.trim();
}

/**
 * Extract simple `key: value` pairs from the block introduced by `blockName:`
 * at column 0. Only direct children (exactly two leading spaces, no deeper
 * nesting) are returned. This is intentionally minimal — enough for the flat
 * `candidate:` and `location:` blocks in profile.yml, and nothing more.
 */
function readBlock(yaml: string, blockName: string): Record<string, string> {
  const lines = yaml.split(/\r?\n/);
  const out: Record<string, string> = {};
  let inBlock = false;

  for (const line of lines) {
    // A new top-level key (column 0, non-space, non-comment) ends the block.
    if (/^[^\s#]/.test(line)) {
      if (inBlock) break;
      inBlock = line.replace(/\s+$/, '') === `${blockName}:`;
      continue;
    }
    if (!inBlock) continue;

    // Only accept direct children: exactly two spaces of indentation.
    const m = /^ {2}([A-Za-z0-9_]+):\s?(.*)$/.exec(line);
    if (m) {
      const key = m[1];
      const val = cleanScalar(m[2] ?? '');
      if (val !== '') out[key] = val;
    }
  }
  return out;
}

/**
 * Load the candidate profile from career-ops. Returns an empty object (never
 * throws) if the file is missing or unreadable — the caller degrades gracefully
 * and simply fills fewer fields.
 */
export function loadCandidateProfile(): CandidateProfile {
  // Glove mode: a human-released peer card exists — its synthesized YAML runs
  // through the SAME parser as the file, so both paths share one
  // normalization (full_name splitting, quoting, inline comments).
  const released = getReleasedCard();
  if (released) return parseCandidateProfile(synthesizeProfileYaml(released.card));

  const path = CAREER_OPS_FILES.profile;
  if (!existsSync(path)) return {};

  let yaml: string;
  try {
    yaml = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  return parseCandidateProfile(yaml);
}

/**
 * Parse a profile.yml-shaped string (candidate:/location: blocks) into a
 * normalized CandidateProfile. Exported so the Glove's synthesized YAML is
 * round-trip tested against exactly this parser.
 */
export function parseCandidateProfile(yaml: string): CandidateProfile {
  const c = readBlock(yaml, 'candidate');
  const loc = readBlock(yaml, 'location');

  const fullName = c.full_name || undefined;
  let firstName: string | undefined;
  let lastName: string | undefined;
  if (fullName) {
    const parts = fullName.split(/\s+/);
    firstName = parts[0];
    if (parts.length > 1) lastName = parts.slice(1).join(' ');
  }

  return {
    fullName,
    firstName,
    lastName,
    email: c.email || undefined,
    phone: c.phone || undefined,
    location: c.location || undefined,
    city: loc.city || undefined,
    country: loc.country || undefined,
    linkedin: c.linkedin || undefined,
    github: c.github || undefined,
    portfolio: c.portfolio_url || undefined,
    twitter: c.twitter || undefined,
  };
}
