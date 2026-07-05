// Ingest orchestration.
//
// Two ingest paths, both idempotent by URL (upsertJob keys on UNIQUE url):
//   - ingest()        : career-ops data (pipeline.md + reports/*.md)
//   - ingestSources() : live multi-source pull (aggregators + ATS APIs + dormant Dice)
//
// Re-running never duplicates rows and never downgrades a job's stage (the
// ON CONFLICT clause in upsertJob leaves stage untouched), so an approved job
// stays approved across re-ingests.

import { join, dirname } from 'node:path';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CAREER_OPS_ROOT } from '../config.js';
import { getUserConfig } from '../userconfig.js';
import { upsertJob, getJobs } from '../db/index.js';
import type { Job } from '../types.js';
import { parsePipelineFile, type PipelineJob } from './pipeline.js';
import { parseReportFile, type ReportEnrichment } from './reports.js';
import { deriveAtsProvider } from './ats.js';
import { canonicalizeUrl } from '../url.js';
import {
  collectFromSources,
  dedupePayloads,
  filterRelevantPayloads,
  isBlockedHost,
  sourceKeywords,
  type SourcesConfig,
  type SourceStat,
} from './providers.js';
import { maybeFetchDice } from './apify.js';

/** Source tag written to jobs.source for everything from career-ops. */
export const CAREER_OPS_SOURCE = 'career-ops';

/** Default locations of the source-of-truth files inside career-ops. */
export const PIPELINE_PATH = join(CAREER_OPS_ROOT, 'data', 'pipeline.md');
export const REPORTS_DIR = join(CAREER_OPS_ROOT, 'reports');

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Default multi-source config (aggregators + ATS company slugs). */
export const DEFAULT_SOURCES_CONFIG = join(__dirname, 'sources.config.json');

export interface IngestResult {
  pipelineParsed: number;
  reportsParsed: number;
  reportsMatched: number;
  upserted: number;
  totalJobs: number;
}

export interface IngestOptions {
  pipelinePath?: string;
  reportsDir?: string;
}

/** Run the career-ops ingest. Safe to call repeatedly (idempotent upsert by URL). */
export function ingest(opts: IngestOptions = {}): IngestResult {
  const pipelinePath = opts.pipelinePath ?? PIPELINE_PATH;
  const reportsDir = opts.reportsDir ?? REPORTS_DIR;

  const pipelineJobs: PipelineJob[] = existsSync(pipelinePath) ? parsePipelineFile(pipelinePath) : [];

  const enrichments = new Map<string, ReportEnrichment>();
  let reportsParsed = 0;
  if (existsSync(reportsDir)) {
    for (const file of listMarkdown(reportsDir)) {
      const enr = parseReportFile(file);
      if (!enr) continue;
      reportsParsed++;
      const prev = enrichments.get(enr.url);
      if (!prev || (prev.fit_score == null && enr.fit_score != null)) {
        enrichments.set(enr.url, enr);
      }
    }
  }

  // Drop LinkedIn/Indeed here too (the live-sources path already does): the
  // "ingest never sources blocked hosts" invariant must hold for career-ops
  // pipeline/report URLs as well, not just the API providers.
  // Key by CANONICAL url so an imported /jobs/view/ form and a live-scanned
  // /{slug}/j/ form of the same posting converge (no duplicate rows).
  const upsertByUrl = new Map<string, ReturnType<typeof buildUpsert>>();
  for (const p of pipelineJobs) {
    if (isBlockedHost(p.url)) continue;
    const key = canonicalizeUrl(p.url);
    upsertByUrl.set(key, buildUpsert(p, enrichments.get(p.url) ?? enrichments.get(key)));
  }
  for (const [url, enr] of enrichments) {
    const key = canonicalizeUrl(url);
    if (upsertByUrl.has(key) || isBlockedHost(url)) continue;
    upsertByUrl.set(key, buildUpsert(null, enr));
  }

  let reportsMatched = 0;
  for (const [url, payload] of upsertByUrl) {
    upsertJob(payload);
    if (enrichments.has(url)) reportsMatched++;
  }

  return {
    pipelineParsed: pipelineJobs.length,
    reportsParsed,
    reportsMatched,
    upserted: upsertByUrl.size,
    totalJobs: getJobs().length,
  };
}

export interface SourceIngestResult {
  /** Per-source fetch/keep counts (including any failures). */
  bySource: SourceStat[];
  /** Distinct relevant jobs kept across all sources (post filter + dedup). */
  totalKept: number;
  /** Rows upserted into the DB. */
  upserted: number;
  /** Total jobs in the DB after this ingest. */
  totalJobs: number;
}

/**
 * Run the live multi-source ingest: free aggregators + configured ATS boards +
 * (dormant) Dice via Apify. Reads sources.config.json unless a path is given.
 */
export async function ingestSources(configPath?: string): Promise<SourceIngestResult> {
  const cfgPath = configPath ?? getUserConfig().sourcesConfigPath ?? DEFAULT_SOURCES_CONFIG;
  const cfg: SourcesConfig = existsSync(cfgPath)
    ? (JSON.parse(readFileSync(cfgPath, 'utf8')) as SourcesConfig)
    : { aggregators: {}, ats: {} };

  const { payloads, stats } = await collectFromSources(cfg);

  // Dormant Dice/Apify (returns [] unless enabled + APIFY_TOKEN set).
  const diceRaw = await maybeFetchDice(cfg);
  const dice = filterRelevantPayloads(
    diceRaw,
    sourceKeywords(cfg),
    cfg.maxPerSource ?? 150,
  );
  const allPayloads = dedupePayloads([...payloads, ...dice]);
  if (diceRaw.length) {
    stats.push({ source: 'apify:dice', fetched: diceRaw.length, kept: dice.length, ok: true });
  }

  let upserted = 0;
  for (const p of allPayloads) {
    upsertJob({ ...p, stage: 'discovered' });
    upserted++;
  }

  return {
    bySource: stats,
    totalKept: allPayloads.length,
    upserted,
    totalJobs: getJobs().length,
  };
}

/** Merge a pipeline entry and/or report enrichment into an upsert payload. */
function buildUpsert(
  p: PipelineJob | null,
  enr: ReportEnrichment | undefined,
): Partial<Omit<Job, 'id' | 'created_at' | 'updated_at'>> & { url: string } {
  const url = canonicalizeUrl((p?.url ?? enr?.url)!);
  return {
    url,
    source: CAREER_OPS_SOURCE,
    company: p?.company ?? null,
    role: p?.role ?? null,
    location: p?.location ?? null,
    ats_provider: p?.ats_provider ?? deriveFromUrlSafely(url),
    fit_score: enr?.fit_score ?? null,
    jd_text: enr?.jd_text ?? null,
    stage: 'discovered',
  };
}

function deriveFromUrlSafely(url: string): string | null {
  try {
    return deriveAtsProvider(url);
  } catch {
    return null;
  }
}

/** Return absolute paths of *.md files directly under dir (non-recursive). */
function listMarkdown(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .map((name) => join(dir, name))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
}
