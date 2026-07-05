// Parse career-ops evaluation reports (reports/*.md) into enrichment records.
//
// Reports carry their metadata as bold-key header lines, e.g.:
//   **URL:** https://apply.workable.com/huggingface/j/81B46579FE
//   **Score:** 2.0/5
//   **Legitimacy:** High Confidence
// (Some reports may instead use a `---`-delimited YAML front-matter block or a
// `## Machine Summary` YAML section; we handle the bold-key form primarily and
// fall back to YAML-ish `key: value` scanning.)
//
// We key enrichment by URL so it can be matched against ingested jobs.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Enrichment derived from one report, matched to a job by URL. */
export interface ReportEnrichment {
  url: string;
  /** Numeric fit score in [0,5] parsed from "Score: X.Y/5", or null. */
  fit_score: number | null;
  /** Legitimacy tier text, e.g. "High Confidence", or null. */
  legitimacy: string | null;
  /** A compact JD/eval summary blob suitable for the jobs.jd_text column. */
  jd_text: string | null;
  /** Source report filename (for provenance in the summary blob). */
  sourceFile: string | null;
}

const RE = {
  url: /^\s*\**\s*URL\s*\**\s*[:*]*\s*(\S.*?)\s*$/im,
  score: /^\s*\**\s*Score\s*\**\s*[:*]*\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*5)?/im,
  legitimacy: /^\s*\**\s*Legitimacy\s*\**\s*[:*]*\s*(\S.*?)\s*$/im,
} as const;

/**
 * Parse a single report's content. Returns null if no URL can be found
 * (without a URL there's nothing to match a job against).
 */
export function parseReport(content: string, sourceFile?: string): ReportEnrichment | null {
  const url = firstCapture(content, RE.url);
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const scoreRaw = firstCapture(content, RE.score);
  const fit_score = scoreRaw != null ? clampScore(Number(scoreRaw)) : null;
  const legitimacy = firstCapture(content, RE.legitimacy);

  return {
    url,
    fit_score,
    legitimacy,
    jd_text: buildJdText(content, { fit_score, legitimacy, sourceFile }),
    sourceFile: sourceFile ?? null,
  };
}

/** Read + parse a report file from disk. */
export function parseReportFile(path: string): ReportEnrichment | null {
  return parseReport(readFileSync(path, 'utf8'), basename(path));
}

/**
 * Build a compact jd_text blob from the report: title line, recommendation,
 * TL;DR (if present), extracted keywords, and provenance. Kept small and
 * plain-text so downstream generation has useful grounding without the whole
 * report. Returns null if nothing useful was found.
 */
function buildJdText(
  content: string,
  meta: { fit_score: number | null; legitimacy: string | null; sourceFile?: string },
): string | null {
  const parts: string[] = [];

  const title = firstCapture(content, /^\s*#\s+(.*\S)\s*$/m);
  if (title) parts.push(title);

  const rec = firstCapture(content, /\*\*RECOMMENDATION:.*?\*\*\s*(.*?)(?:\n\n|\n---|\r\n\r\n|$)/is);
  if (rec) parts.push(`Recommendation: ${collapse(rec)}`);

  const tldr = firstCapture(content, /^\s*\|?\s*TL;DR\s*\|\s*(.*?)\s*\|?\s*$/im);
  if (tldr) parts.push(`TL;DR: ${collapse(tldr)}`);

  // "## Keywords extracted" block (career-ops report convention).
  const kw = firstCapture(content, /##\s*Keywords\s+extracted\s*\r?\n+([\s\S]*?)(?:\r?\n#{1,6}\s|\r?\n?$)/i);
  if (kw) parts.push(`Keywords: ${collapse(kw)}`);

  const provenance: string[] = [];
  if (meta.fit_score != null) provenance.push(`score ${meta.fit_score}/5`);
  if (meta.legitimacy) provenance.push(`legitimacy ${meta.legitimacy}`);
  if (meta.sourceFile) provenance.push(`from ${meta.sourceFile}`);
  if (provenance.length) parts.push(`[career-ops eval: ${provenance.join(', ')}]`);

  const blob = parts.filter(Boolean).join('\n\n').trim();
  return blob.length ? blob : null;
}

function firstCapture(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m && m[1] != null ? m[1].trim() : null;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function clampScore(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(5, n));
}
