// Parse career-ops's data/pipeline.md into structured job records.
//
// Pipeline lines look like:
//   - [ ] {url} | {company} | {role} | {location}
// (checkbox may be "[ ]" or "[x]"). Fields after the URL are pipe-delimited
// and optional/ragged; we defensively handle missing trailing fields.

import { readFileSync } from 'node:fs';
import { deriveAtsProvider } from './ats.js';

/** A single parsed pipeline entry, ready to upsert into `jobs`. */
export interface PipelineJob {
  url: string;
  company: string | null;
  role: string | null;
  location: string | null;
  ats_provider: string | null;
}

// Matches a markdown task-list line and captures everything after the checkbox.
// e.g. "- [ ] https://... | Company | Role | Loc"
const TASK_LINE = /^\s*[-*]\s*\[[ xX]\]\s+(.*\S)\s*$/;

/**
 * Parse pipeline.md content into job records. Only task-list lines whose first
 * pipe-field is an http(s) URL are treated as jobs; headers, prose, and empty
 * checkboxes-without-urls are skipped. Deduplicates by URL (first wins) so the
 * caller's upsert stays idempotent within a single file too.
 */
export function parsePipeline(content: string): PipelineJob[] {
  const out: PipelineJob[] = [];
  const seen = new Set<string>();

  for (const line of content.split(/\r?\n/)) {
    const m = TASK_LINE.exec(line);
    if (!m) continue;

    const fields = m[1].split('|').map((s) => s.trim());
    const url = fields[0];
    if (!url || !/^https?:\/\//i.test(url)) continue; // not a job URL line
    if (seen.has(url)) continue;
    seen.add(url);

    out.push({
      url,
      company: emptyToNull(fields[1]),
      role: emptyToNull(fields[2]),
      // Location may itself contain no pipes but plenty of separators/commas;
      // rejoin any extra pipe-fields so we don't silently drop location text.
      location: emptyToNull(fields.slice(3).join(' | ').trim()),
      ats_provider: deriveAtsProvider(url),
    });
  }

  return out;
}

/** Read + parse a pipeline.md file from disk. */
export function parsePipelineFile(path: string): PipelineJob[] {
  return parsePipeline(readFileSync(path, 'utf8'));
}

function emptyToNull(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  return s.length ? s : null;
}
