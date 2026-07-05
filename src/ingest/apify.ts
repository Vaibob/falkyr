// src/ingest/apify.ts
//
// DORMANT Dice (and other scrape-only board) connector via the Apify platform.
//
// Dice.com shut down its public API in 2017, so there is no clean JSON feed to
// ingest. Apify hosts a Dice scraper actor we can run on demand. This is OFF by
// default and requires BOTH:
//   1. sources.config.json -> apify.dice.enabled = true
//   2. env APIFY_TOKEN set (usage-based; has free credits)
// If either is missing, maybeFetchDice() returns [] and logs a note — the rest
// of ingest (the free public APIs) is unaffected.

import { APIFY_TOKEN } from '../config.js';
import type { SourcesConfig, UpsertPayload } from './providers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

/**
 * Run the configured Apify Dice actor synchronously and return normalized jobs.
 * Returns [] (dormant) unless explicitly enabled AND an APIFY_TOKEN is present.
 */
export async function maybeFetchDice(cfg: SourcesConfig): Promise<UpsertPayload[]> {
  const dice = cfg.apify?.dice as Json | undefined;
  if (!dice?.enabled) return [];

  if (!APIFY_TOKEN) {
    console.warn('[apify] dice is enabled in config but APIFY_TOKEN is not set — skipping (dormant).');
    return [];
  }

  const actorId = String(dice.actorId ?? 'easyapi/dice-com-job-scraper').replace('/', '~');
  const input = {
    query: dice.query ?? 'machine learning engineer',
    maxItems: Number(dice.maxItems ?? 100),
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000); // scraping is slower than an API
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`,
      {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    if (!res.ok) throw new Error(`Apify HTTP ${res.status} ${res.statusText}`);
    const items: Json[] = await res.json();
    return (Array.isArray(items) ? items : [])
      .map((j) => ({
        url: j.url || j.jobUrl || j.applyUrl,
        source: 'apify:dice',
        company: j.company ?? j.companyName ?? null,
        role: j.title ?? j.jobTitle ?? null,
        location: j.location ?? j.jobLocation ?? null,
        remote: /remote/i.test(String(j.location ?? j.jobType ?? '')) ? 'remote' : null,
        comp_note: j.salary ?? null,
        ats_provider: 'dice',
        jd_text: typeof j.description === 'string' ? j.description.slice(0, 20000) : null,
      }))
      .filter((j) => !!j.url) as UpsertPayload[];
  } catch (err) {
    console.warn(`[apify] dice fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
