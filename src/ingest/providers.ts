// src/ingest/providers.ts
//
// Multi-source job ingestion providers.
//
// Two provider families:
//   1. Free remote-job aggregators with public JSON APIs (no key, no config):
//      Himalayas, RemoteOK, Remotive, Arbeitnow, Jobicy.
//   2. Per-company ATS boards with public JSON APIs ("compliant"):
//      Greenhouse, Lever, Ashby, SmartRecruiters, Breezy (full),
//      Workable, BambooHR (best-effort — shapes vary per tenant).
//
// ATS platforms with NO public listings API (iCIMS, JazzHR, Jobvite, Zoho,
// Paylocity, ADP, Dover, Gem) and per-tenant ones (Workday, Oracle, UKG,
// Rippling) are NOT ingested here — they are apply-time targets handled by the
// autofill engine, or can be pulled via the dormant Apify path (see apify.ts).
// See ATS_COMPLIANCE below for the full status map.
//
// Every provider is wrapped by the caller in try/catch so one failing API never
// aborts the run. Results are normalized to db upsert payloads, filtered to the
// candidate's relevant titles, and de-duplicated by URL. LinkedIn/Indeed hosts
// are dropped (never a source, never an apply target — see config.BLOCKED_APPLY_HOSTS).

import type { Job } from '../types.js';
import { BLOCKED_APPLY_HOSTS } from '../config.js';
import { canonicalizeUrl } from '../url.js';

/** A normalized job ready for upsertJob(). */
export type UpsertPayload = Partial<Omit<Job, 'id' | 'created_at' | 'updated_at'>> & { url: string };

/** Per-source outcome for the CLI/summary. */
export interface SourceStat {
  source: string;
  fetched: number;
  kept: number;
  ok: boolean;
  error?: string;
}

/** Config shape (see sources.config.json). */
export interface SourcesConfig {
  aggregators?: Record<string, { enabled?: boolean; [k: string]: unknown }>;
  ats?: Record<string, string[]>;
  apify?: { dice?: { enabled?: boolean; [k: string]: unknown }; [k: string]: unknown };
  titleKeywords?: string[];
  maxPerSource?: number;
}

/**
 * Compliance status of every ATS the user named, for documentation + routing:
 *   'api'        — clean public per-company JSON API (ingested here)
 *   'best-effort'— public but shape varies per tenant (ingested, may fail)
 *   'apply-only' — no public listings API; handled at apply-time / via Apify
 */
export const ATS_COMPLIANCE: Record<string, 'api' | 'best-effort' | 'apply-only'> = {
  greenhouse: 'api',
  lever: 'api',
  ashby: 'api',
  smartrecruiters: 'api',
  breezy: 'api',
  workable: 'best-effort',
  bamboohr: 'best-effort',
  workday: 'apply-only',
  rippling: 'apply-only',
  icims: 'apply-only',
  jazzhr: 'apply-only',
  jobvite: 'apply-only',
  oracle: 'apply-only',
  paylocity: 'apply-only',
  ukg: 'apply-only',
  zoho: 'apply-only',
  adp: 'apply-only',
  dover: 'apply-only',
  gem: 'apply-only',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const UA = 'JobPilot/0.1 (+local job-search assistant)';

/** Relevance keywords for the candidate (RL / post-training / applied ML). Overridable via config.titleKeywords. */
const DEFAULT_KEYWORDS = [
  'reinforcement learning', 'rl engineer', 'post-training', 'post training', 'rlhf', 'rlvr',
  'llm', 'vlm', 'large language model', 'machine learning', 'ml engineer', 'ai engineer',
  'applied ai', 'research engineer', 'research scientist', 'member of technical staff',
  'deep learning', 'nlp', 'mlops', 'generative', 'fine-tun', 'foundation model', 'ai/ml',
];

/** Effective title-keyword list for a source config. */
export function sourceKeywords(cfg: SourcesConfig): readonly string[] {
  return cfg.titleKeywords?.length ? cfg.titleKeywords : DEFAULT_KEYWORDS;
}

async function fetchJson(
  url: string,
  opts: { method?: string; body?: string; headers?: Record<string, string> } = {},
  timeoutMs = 20000,
): Promise<Json> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      body: opts.body,
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(url: string): string {
  try {
    // Strip a trailing dot so "linkedin.com." can't slip past the block.
    return new URL(url).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    return '';
  }
}

/** True when a URL's host is on the never-apply/never-source list (LinkedIn/Indeed). */
export function isBlockedHost(url: string): boolean {
  const h = hostOf(url);
  return BLOCKED_APPLY_HOSTS.some((b) => h === b || h.endsWith('.' + b));
}

/** Does the title contain at least one relevance keyword? */
export function titleMatches(title: string | null | undefined, keywords: readonly string[]): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return keywords.some((k) => t.includes(k.toLowerCase()));
}

/** Apply the common source safety/relevance filters and per-source cap. */
export function filterRelevantPayloads(
  jobs: readonly UpsertPayload[],
  keywords: readonly string[],
  cap: number,
): UpsertPayload[] {
  // Canonicalize URLs FIRST so blocked-host checks + downstream dedup see one
  // consistent form per posting (fixes duplicate rows across providers/forms).
  let filtered = jobs
    .map((j) => ({ ...j, url: canonicalizeUrl(j.url) }))
    .filter((j) => j.url && !isBlockedHost(j.url));
  filtered = filtered.filter((j) => titleMatches(j.role, keywords));
  return filtered.length > cap ? filtered.slice(0, cap) : filtered;
}

/** De-duplicate by URL, preserving the first source's payload. */
export function dedupePayloads(jobs: readonly UpsertPayload[]): UpsertPayload[] {
  const seen = new Set<string>();
  const payloads: UpsertPayload[] = [];
  for (const j of jobs) {
    if (seen.has(j.url)) continue;
    seen.add(j.url);
    payloads.push(j);
  }
  return payloads;
}

/** slug -> "Pretty Company". */
function prettyCompany(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function clip(s: unknown, n = 20000): string | null {
  return typeof s === 'string' && s.length ? s.slice(0, n) : null;
}

// ---------------------------------------------------------------------------
// Aggregators (free public JSON, no key, no per-company config)
// ---------------------------------------------------------------------------

async function fetchHimalayas(cfg: Json): Promise<UpsertPayload[]> {
  const limit = Number(cfg?.limit ?? 100);
  const data = await fetchJson(`https://himalayas.app/jobs/api?limit=${limit}`);
  const jobs: Json[] = data?.jobs ?? [];
  return jobs.map((j) => ({
    // Prefer the real apply link; only fall back to guid if it's an http(s) URL.
    url: j.applicationLink || (/^https?:\/\//i.test(j.guid ?? '') ? j.guid : ''),
    source: 'himalayas',
    company: j.companyName ?? null,
    role: j.title ?? null,
    location: Array.isArray(j.locationRestrictions) ? j.locationRestrictions.join(', ') || 'Remote' : (j.locationRestrictions ?? 'Remote'),
    remote: 'remote',
    comp_note: j.minSalary || j.maxSalary ? `${j.minSalary ?? '?'}-${j.maxSalary ?? '?'}` : null,
    ats_provider: 'himalayas',
    jd_text: clip(j.description ?? j.excerpt),
  })).filter((j) => !!j.url) as UpsertPayload[];
}

async function fetchRemoteOK(): Promise<UpsertPayload[]> {
  const data = await fetchJson('https://remoteok.com/api');
  const arr: Json[] = Array.isArray(data) ? data : [];
  return arr
    .filter((j) => j && j.id && j.position)
    .map((j) => ({
      url: j.url || j.apply_url,
      source: 'remoteok',
      company: j.company ?? null,
      role: j.position ?? null,
      location: j.location || 'Remote',
      remote: 'remote',
      comp_note: j.salary_min || j.salary_max ? `${j.salary_min ?? '?'}-${j.salary_max ?? '?'}` : null,
      ats_provider: 'remoteok',
      jd_text: clip(j.description),
    }))
    .filter((j) => !!j.url) as UpsertPayload[];
}

async function fetchRemotive(cfg: Json): Promise<UpsertPayload[]> {
  const search = cfg?.search ? `?search=${encodeURIComponent(String(cfg.search))}&limit=100` : '?limit=100';
  const data = await fetchJson(`https://remotive.com/api/remote-jobs${search}`);
  const jobs: Json[] = data?.jobs ?? [];
  return jobs.map((j) => ({
    url: j.url,
    source: 'remotive',
    company: j.company_name ?? null,
    role: j.title ?? null,
    location: j.candidate_required_location || 'Remote',
    remote: 'remote',
    comp_note: j.salary || null,
    ats_provider: 'remotive',
    jd_text: clip(j.description),
  })).filter((j) => !!j.url) as UpsertPayload[];
}

async function fetchArbeitnow(): Promise<UpsertPayload[]> {
  const data = await fetchJson('https://www.arbeitnow.com/api/job-board-api');
  const arr: Json[] = data?.data ?? [];
  return arr.map((j) => ({
    url: j.url,
    source: 'arbeitnow',
    company: j.company_name ?? null,
    role: j.title ?? null,
    location: j.location || null,
    remote: j.remote ? 'remote' : null,
    ats_provider: 'arbeitnow',
    jd_text: clip(j.description),
  })).filter((j) => !!j.url) as UpsertPayload[];
}

async function fetchJobicy(cfg: Json): Promise<UpsertPayload[]> {
  const count = Number(cfg?.count ?? 100);
  const tag = cfg?.tag ? `&tag=${encodeURIComponent(String(cfg.tag))}` : '';
  const data = await fetchJson(`https://jobicy.com/api/v2/remote-jobs?count=${count}${tag}`);
  const jobs: Json[] = data?.jobs ?? [];
  return jobs.map((j) => ({
    url: j.url,
    source: 'jobicy',
    company: j.companyName ?? null,
    role: j.jobTitle ?? null,
    location: j.jobGeo || 'Remote',
    remote: 'remote',
    comp_note: j.annualSalaryMin || j.annualSalaryMax ? `${j.annualSalaryMin ?? '?'}-${j.annualSalaryMax ?? '?'} ${j.salaryCurrency ?? ''}`.trim() : null,
    ats_provider: 'jobicy',
    jd_text: clip(j.jobExcerpt),
  })).filter((j) => !!j.url) as UpsertPayload[];
}

// ---------------------------------------------------------------------------
// ATS boards (per-company, public JSON APIs)
// ---------------------------------------------------------------------------

async function fetchGreenhouse(slug: string): Promise<UpsertPayload[]> {
  const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`);
  const jobs: Json[] = data?.jobs ?? [];
  return jobs.map((j) => ({
    url: j.absolute_url,
    source: 'greenhouse',
    company: prettyCompany(slug),
    role: j.title ?? null,
    location: j.location?.name ?? null,
    remote: /remote/i.test(j.location?.name ?? '') ? 'remote' : null,
    ats_provider: 'greenhouse',
    jd_text: clip(j.content),
  })).filter((j) => !!j.url) as UpsertPayload[];
}

async function fetchLever(slug: string): Promise<UpsertPayload[]> {
  const data = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
  const arr: Json[] = Array.isArray(data) ? data : [];
  return arr.map((j) => ({
    url: j.hostedUrl,
    source: 'lever',
    company: prettyCompany(slug),
    role: j.text ?? null,
    location: j.categories?.location ?? null,
    remote: /remote/i.test(j.workplaceType ?? j.categories?.location ?? '') ? 'remote' : null,
    ats_provider: 'lever',
    jd_text: clip(j.descriptionPlain),
  })).filter((j) => !!j.url) as UpsertPayload[];
}

async function fetchAshby(slug: string): Promise<UpsertPayload[]> {
  const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`);
  const jobs: Json[] = data?.jobs ?? [];
  return jobs.map((j) => ({
    url: j.applyUrl || j.jobUrl,
    source: 'ashby',
    company: prettyCompany(slug),
    role: j.title ?? null,
    location: j.location ?? null,
    remote: j.isRemote ? 'remote' : null,
    comp_note: j.compensation?.compensationTierSummary ?? null,
    ats_provider: 'ashby',
    jd_text: clip(j.descriptionPlain),
  })).filter((j) => !!j.url) as UpsertPayload[];
}

async function fetchSmartRecruiters(slug: string): Promise<UpsertPayload[]> {
  const data = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100`);
  const arr: Json[] = data?.content ?? [];
  return arr.map((j) => ({
    url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
    source: 'smartrecruiters',
    company: j.company?.name ?? prettyCompany(slug),
    role: j.name ?? null,
    location: [j.location?.city, j.location?.country].filter(Boolean).join(', ') || null,
    remote: j.location?.remote ? 'remote' : null,
    ats_provider: 'smartrecruiters',
  })).filter((j) => !!j.url) as UpsertPayload[];
}

async function fetchBreezy(slug: string): Promise<UpsertPayload[]> {
  const data = await fetchJson(`https://${encodeURIComponent(slug)}.breezy.hr/json`);
  const arr: Json[] = Array.isArray(data) ? data : [];
  return arr.map((j) => ({
    url: j.url || j.friendly_url,
    source: 'breezy',
    company: prettyCompany(slug),
    role: j.name ?? null,
    location: j.location?.name ?? null,
    remote: j.location?.is_remote ? 'remote' : null,
    ats_provider: 'breezy',
  })).filter((j) => !!j.url) as UpsertPayload[];
}

async function fetchWorkable(slug: string): Promise<UpsertPayload[]> {
  // Best-effort: public widget API. Shape varies; caller catches failures.
  const data = await fetchJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`);
  const arr: Json[] = data?.jobs ?? [];
  return arr.map((j) => ({
    // The API returns the slug-LESS shortlink (apply.workable.com/j/{code}); the
    // canonical human posting URL is /{account}/j/{shortcode}. Build it from the
    // shortcode + slug rather than trusting the API's `url`.
    url: j.shortcode
      ? `https://apply.workable.com/${slug}/j/${j.shortcode}`
      : j.url || j.application_url || j.shortlink,
    source: 'workable',
    company: data?.name ?? prettyCompany(slug),
    role: j.title ?? null,
    location: [j.city, j.country].filter(Boolean).join(', ') || null,
    remote: j.remote || /remote/i.test(j.city ?? '') ? 'remote' : null,
    ats_provider: 'workable',
  })).filter((j) => !!j.url) as UpsertPayload[];
}

async function fetchBambooHR(slug: string): Promise<UpsertPayload[]> {
  // Best-effort: public careers list JSON.
  const data = await fetchJson(`https://${encodeURIComponent(slug)}.bamboohr.com/careers/list`);
  const arr: Json[] = data?.result ?? [];
  return arr.map((j) => ({
    url: `https://${slug}.bamboohr.com/careers/${j.id}`,
    source: 'bamboohr',
    company: prettyCompany(slug),
    role: j.jobOpeningName ?? null,
    location: [j.location?.city, j.location?.state].filter(Boolean).join(', ') || null,
    remote: j.isRemote === 'yes' || /remote/i.test(j.locationType ?? '') ? 'remote' : null,
    ats_provider: 'bamboohr',
  })).filter((j) => !!j.url) as UpsertPayload[];
}

async function fetchAts(provider: string, slug: string): Promise<UpsertPayload[]> {
  switch (provider) {
    case 'greenhouse': return fetchGreenhouse(slug);
    case 'lever': return fetchLever(slug);
    case 'ashby': return fetchAshby(slug);
    case 'smartrecruiters': return fetchSmartRecruiters(slug);
    case 'breezy': return fetchBreezy(slug);
    case 'workable': return fetchWorkable(slug);
    case 'bamboohr': return fetchBambooHR(slug);
    default:
      throw new Error(`ATS '${provider}' has no public listings API (status: ${ATS_COMPLIANCE[provider] ?? 'unknown'}); it is an apply-time target, not an ingest source.`);
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Run every enabled provider concurrently, filter to relevant + non-blocked
 * jobs, de-duplicate by URL, and return payloads + per-source stats.
 */
export async function collectFromSources(
  cfg: SourcesConfig,
): Promise<{ payloads: UpsertPayload[]; stats: SourceStat[] }> {
  const keywords = sourceKeywords(cfg);
  const cap = cfg.maxPerSource ?? 150;
  const stats: SourceStat[] = [];
  const collected: UpsertPayload[] = [];

  const run = async (name: string, fn: () => Promise<UpsertPayload[]>): Promise<void> => {
    try {
      let jobs = await fn();
      const fetched = jobs.length;
      jobs = filterRelevantPayloads(jobs, keywords, cap);
      collected.push(...jobs);
      stats.push({ source: name, fetched, kept: jobs.length, ok: true });
    } catch (err) {
      stats.push({ source: name, fetched: 0, kept: 0, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  // Collect the work as thunks (do NOT start them yet) so a bounded pool can cap
  // how many fetches are in flight. A large ats map otherwise opens hundreds of
  // sockets at once and trips provider rate limits (429/503), silently dropping
  // sources.
  const work: Array<() => Promise<void>> = [];
  const agg = cfg.aggregators ?? {};
  if (agg.himalayas?.enabled) work.push(() => run('himalayas', () => fetchHimalayas(agg.himalayas)));
  if (agg.remoteok?.enabled) work.push(() => run('remoteok', () => fetchRemoteOK()));
  if (agg.remotive?.enabled) work.push(() => run('remotive', () => fetchRemotive(agg.remotive)));
  if (agg.arbeitnow?.enabled) work.push(() => run('arbeitnow', () => fetchArbeitnow()));
  if (agg.jobicy?.enabled) work.push(() => run('jobicy', () => fetchJobicy(agg.jobicy)));

  for (const [provider, slugs] of Object.entries(cfg.ats ?? {})) {
    if (!Array.isArray(slugs)) continue;
    for (const slug of slugs) {
      work.push(() => run(`${provider}:${slug}`, () => fetchAts(provider, slug)));
    }
  }

  // Bounded worker pool: at most CONCURRENCY fetches in flight at once. `run`
  // never rejects (it records failures into stats), so workers can't break.
  const CONCURRENCY = 6;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < work.length) {
      await work[next++]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, () => worker()));

  return { payloads: dedupePayloads(collected), stats };
}
