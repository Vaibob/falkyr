// Monoculture classifier + routing. PURE HEURISTICS — no LLM, no network, no DB.
//
// Grounding: "Algorithmic Monocultures in Hiring" (Bommasani, Bana, Creel,
// Jurafsky, Liang; FAccT 2026; arXiv:2605.27371). ~90% of US employers screen
// with algorithms, and a handful of shared vendors dominate (HireVue ~60% of
// the Fortune 100; pymetrics). When many roles route through the SAME vendor,
// identical inputs produce correlated outcomes — applying to N such roles is
// closer to one decision repeated N times than N independent chances. This
// module estimates how "monocultured" a given job's screening path is, and
// suggests channels that route AROUND the shared filter (referrals, direct-to-
// hiring-manager, smaller companies). Advisory only.
import type { Job } from '../types.js';
import type { MonocultureRisk, RoutingSuggestion, RiskTier } from './types.js';

/**
 * A recognizable screening vendor and the tier of monoculture risk it implies.
 * `match` fragments are checked (lowercased, substring) against BOTH the job's
 * declared `ats_provider` and its URL host — vendors surface in either place.
 */
interface VendorRule {
  /** Canonical, human-readable vendor name used in the report. */
  vendor: string;
  /** Lowercased substrings that identify this vendor in host or ats_provider. */
  match: string[];
  tier: RiskTier;
  /** One-line, monoculture-specific rationale (vendor name is prepended). */
  note: string;
}

/**
 * HIGH tier — shared algorithmic screeners / mega-ATS whose scoring models are
 * reused across huge numbers of employers. These concentrate the most
 * correlation risk: the same model gates thousands of postings, so a single
 * "no" pattern replays everywhere it is deployed.
 */
const HIGH_VENDORS: VendorRule[] = [
  {
    vendor: 'HireVue',
    match: ['hirevue'],
    tier: 'high',
    note: 'a shared algorithmic video/assessment screener used across ~60% of the Fortune 100 — one model gates many employers, so rejections correlate.',
  },
  {
    vendor: 'pymetrics',
    match: ['pymetrics'],
    tier: 'high',
    note: 'a shared game-based algorithmic assessment reused across many employers — identical inputs draw correlated (not independent) outcomes.',
  },
  {
    vendor: 'Workday',
    match: ['workday', 'myworkdayjobs'],
    tier: 'high',
    note: 'a mega-ATS whose shared screening/knockout models gate a huge share of large-employer postings — your application flows through the same filter as everyone else.',
  },
  {
    vendor: 'iCIMS',
    match: ['icims'],
    tier: 'high',
    note: 'a mega-ATS with shared algorithmic screening deployed across many enterprises — a repeated model, not an independent reviewer.',
  },
  {
    vendor: 'Taleo',
    match: ['taleo'],
    tier: 'high',
    note: 'a legacy enterprise mega-ATS (Oracle) whose keyword/knockout rules gate many large employers uniformly — correlated screening outcomes.',
  },
  {
    vendor: 'Oracle Recruiting',
    match: ['oracle', 'oraclecloud'],
    tier: 'high',
    note: 'an enterprise mega-ATS whose shared recruiting/screening models gate many large employers — one filter repeated across postings.',
  },
  {
    vendor: 'SAP SuccessFactors',
    match: ['successfactors', 'sapsf'],
    tier: 'high',
    note: 'an enterprise mega-ATS whose shared screening rules gate many large employers uniformly — a repeated decision, not an independent one.',
  },
  {
    vendor: 'IBM BrassRing',
    match: ['brassring', 'kenexa'],
    tier: 'high',
    note: 'a legacy enterprise mega-ATS whose shared keyword/knockout screening gates many large employers — correlated across postings.',
  },
];

/**
 * MEDIUM tier — widely-used ATS that apply keyword filters and knockout
 * questions but tend to be configured per-company and reviewed by that
 * company's recruiters. Real filtering, but less globally-shared than HIGH.
 */
const MEDIUM_VENDORS: VendorRule[] = [
  {
    vendor: 'Greenhouse',
    match: ['greenhouse', 'grnh.se'],
    tier: 'medium',
    note: 'a widely-used ATS with per-company keyword filters and knockout questions — screening is real but configured (and reviewed) per employer.',
  },
  {
    vendor: 'Lever',
    match: ['lever.co', 'lever'],
    tier: 'medium',
    note: 'a widely-used ATS with keyword/knockout filtering configured per employer — some shared filtering, but reviewed by that company.',
  },
  {
    vendor: 'Workable',
    match: ['workable'],
    tier: 'medium',
    note: 'a widely-used ATS with keyword filtering and AI ranking configured per employer — moderate, per-company screening.',
  },
  {
    vendor: 'SmartRecruiters',
    match: ['smartrecruiters'],
    tier: 'medium',
    note: 'a widely-used ATS with keyword filters and knockout questions configured per employer — moderate, per-company screening.',
  },
  {
    vendor: 'Jobvite',
    match: ['jobvite'],
    tier: 'medium',
    note: 'a widely-used ATS with keyword filtering configured per employer — moderate, per-company screening.',
  },
];

/**
 * LOW tier — small/modern ATS whose screening is light and per-company, and
 * aggregator sources (the role likely also lives on a native page). Little
 * shared-model correlation risk; a tailored application is usually enough.
 */
const LOW_VENDORS: VendorRule[] = [
  {
    vendor: 'Ashby',
    match: ['ashby', 'ashbyhq'],
    tier: 'low',
    note: 'a modern, small-footprint ATS with light per-company screening — low shared-model correlation.',
  },
  {
    vendor: 'BreezyHR',
    match: ['breezy'],
    tier: 'low',
    note: 'a small-footprint ATS with light per-company screening — low shared-model correlation.',
  },
];

/** Aggregator/job-board hosts — sourced here, screening happens elsewhere. */
const AGGREGATOR_HOSTS = [
  'linkedin',
  'indeed',
  'ziprecruiter',
  'glassdoor',
  'wellfound',
  'angel.co',
  'angellist',
  'ycombinator',
  'weworkremotely',
  'remoteok',
  'remotive',
  'builtin',
  'dice',
  'monster',
  'simplyhired',
  'google.com/search',
  'jobs.google',
];

/** Lowercase the URL host; returns '' if the URL is unparseable. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/** True if any needle is a substring of haystack (both assumed lowercased). */
function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/**
 * Classify how monocultured a job's screening path is by inspecting its URL
 * host and declared ATS provider. HIGH/MEDIUM/LOW vendor tables are checked in
 * that order (most-correlated first); aggregator sources fall to LOW; anything
 * unrecognized is treated as a company-native page (LOW).
 */
export function classifyMonoculture(job: Job): MonocultureRisk {
  const host = hostOf(job.url);
  const ats = (job.ats_provider ?? '').toLowerCase();
  // Combined haystack: a vendor may appear in either the host or the provider.
  const hay = `${host} ${ats}`;

  for (const rule of [...HIGH_VENDORS, ...MEDIUM_VENDORS, ...LOW_VENDORS]) {
    if (includesAny(hay, rule.match)) {
      return {
        tier: rule.tier,
        vendor: rule.vendor,
        reason: `${rule.vendor}: ${rule.note}`,
      };
    }
  }

  // Aggregator-sourced: the posting was discovered on a board; actual screening
  // is unknown and likely happens on a native page. Treat as LOW here.
  const source = (job.source ?? '').toLowerCase();
  if (includesAny(hay, AGGREGATOR_HOSTS) || includesAny(source, AGGREGATOR_HOSTS)) {
    return {
      tier: 'low',
      vendor: null,
      reason:
        'Aggregator/job-board source: no shared mega-vendor screener detected on the application path, so correlation risk is low — but confirm where the apply link actually routes.',
    };
  }

  // Company-native page / unrecognized small ATS: low shared-model correlation.
  return {
    tier: 'low',
    vendor: null,
    reason:
      'Company-native page or small ATS: no shared algorithmic mega-screener detected, so this application reads closer to an independent draw — a tailored, human-sounding application is the main lever.',
  };
}

/**
 * Suggest application channels given the monoculture risk. The higher the
 * shared-model correlation, the harder we push to route AROUND the filter
 * (referrals, hiring managers, smaller companies) rather than through it.
 * Referral suggestions are RESEARCH ONLY — we never auto-apply via LinkedIn.
 */
export function routingFor(job: Job, risk: MonocultureRisk): RoutingSuggestion[] {
  const company = job.company?.trim() || 'the company';
  const vendorPhrase = risk.vendor ? `${risk.vendor}'s shared screener` : 'the shared filter';

  if (risk.tier === 'high') {
    return [
      {
        channel: 'referral',
        rationale: `A referral routes your application around ${vendorPhrase}, turning a correlated draw into a human-reviewed one.`,
        action: `Find a ${company} employee on LinkedIn to ask for a referral (research only — do NOT auto-apply via LinkedIn); message them with one specific, relevant project as the hook.`,
      },
      {
        channel: 'hiring-manager',
        rationale: `Reaching the hiring manager directly bypasses ${vendorPhrase} entirely — the monoculture only has power over applications that flow through it.`,
        action: `Identify the hiring manager or team lead for the ${job.role?.trim() || 'role'} at ${company} and send a short, specific note (with a demo/GitHub link) instead of relying on the portal alone.`,
      },
      {
        channel: 'smaller-company',
        rationale: `Smaller companies and startups rarely run ${risk.vendor ?? 'a mega-vendor'}; the same effort gets you an independent chance instead of one more repeated bet.`,
        action: `Add 2-3 comparable roles at smaller companies/startups NOT on the mega-vendors, so your applications de-correlate across the portfolio.`,
      },
    ];
  }

  if (risk.tier === 'medium') {
    return [
      {
        channel: 'referral',
        rationale: `Even with per-company screening, a referral surfaces you above the keyword filter and adds an independent human read.`,
        action: `Find a ${company} employee on LinkedIn for a referral (research only — never auto-apply via LinkedIn), leading with the most role-relevant project.`,
      },
      {
        channel: 'portal',
        rationale: `${risk.vendor ?? 'This ATS'} filters on keywords, so a tailored portal application (matched to the JD's real terms, grounded in true experience) clears the filter honestly.`,
        action: `Apply through the portal with a version tailored to ${company}: mirror the JD's actual keywords, lead with the most relevant project, and quantify impact — no fabrication.`,
      },
    ];
  }

  // LOW
  return [
    {
      channel: 'portal',
      rationale: `No shared mega-screener detected, so a tailored, human-sounding portal application is the primary lever here.`,
      action: `Apply through the portal with a version tailored to the ${job.role?.trim() || 'role'} at ${company}: specific lived detail, natural sentence variation, impact-led bullets.`,
    },
    {
      channel: 'referral',
      rationale: `Optional: a warm intro still helps, but it's a bonus rather than a workaround here.`,
      action: `If you already know someone at ${company}, ask for a warm intro — otherwise the tailored portal application is sufficient.`,
    },
  ];
}
