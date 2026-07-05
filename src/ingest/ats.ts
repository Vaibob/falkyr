// Derive the ATS (applicant tracking system) provider from a job URL's host.
// Pure, dependency-free, and easily unit-testable. Returns a lowercase slug
// like 'greenhouse' | 'ashby' | 'workable' | 'lever' | ... or null if unknown.

/** Known ATS host fragments → canonical provider slug. */
const ATS_HOST_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/(^|\.)greenhouse\.io$/i, 'greenhouse'],
  [/(^|\.)boards\.greenhouse\.io$/i, 'greenhouse'],
  [/(^|\.)job-boards\.greenhouse\.io$/i, 'greenhouse'],
  [/(^|\.)ashbyhq\.com$/i, 'ashby'],
  [/(^|\.)jobs\.ashbyhq\.com$/i, 'ashby'],
  [/(^|\.)workable\.com$/i, 'workable'],
  [/(^|\.)apply\.workable\.com$/i, 'workable'],
  [/(^|\.)lever\.co$/i, 'lever'],
  [/(^|\.)jobs\.lever\.co$/i, 'lever'],
  [/(^|\.)myworkdayjobs\.com$/i, 'workday'],
  [/(^|\.)workday\.com$/i, 'workday'],
  [/(^|\.)icims\.com$/i, 'icims'],
  [/(^|\.)smartrecruiters\.com$/i, 'smartrecruiters'],
  [/(^|\.)bamboohr\.com$/i, 'bamboohr'],
  [/(^|\.)jobvite\.com$/i, 'jobvite'],
  [/(^|\.)taleo\.net$/i, 'taleo'],
  [/(^|\.)recruitee\.com$/i, 'recruitee'],
  [/(^|\.)teamtailor\.com$/i, 'teamtailor'],
  [/(^|\.)breezy\.hr$/i, 'breezy'],
  [/(^|\.)linkedin\.com$/i, 'linkedin'],
  [/(^|\.)indeed\.com$/i, 'indeed'],
];

/**
 * Derive the ATS provider slug from a URL string.
 * Falls back to the registrable-ish base host (e.g. 'example' from
 * 'jobs.example.com') when the host doesn't match a known ATS, so the value
 * is still informative. Returns null only when the URL can't be parsed.
 */
export function deriveAtsProvider(url: string): string | null {
  const host = hostFromUrl(url);
  if (!host) return null;

  for (const [pattern, provider] of ATS_HOST_PATTERNS) {
    if (pattern.test(host)) return provider;
  }

  // Unknown ATS: use the second-level domain label as a best-effort provider.
  // e.g. 'jobs.acme.com' -> 'acme', 'careers.acme.co.uk' -> 'acme'.
  const labels = host.split('.').filter(Boolean);
  if (labels.length >= 2) {
    // Handle common two-part TLDs (co.uk, com.au, ...) by skipping them.
    const twoPartTld = /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/i;
    const tail = labels.slice(-2).join('.');
    const idx = twoPartTld.test(tail) ? labels.length - 3 : labels.length - 2;
    if (idx >= 0) return labels[idx].toLowerCase();
  }
  return host.toLowerCase();
}

/** Extract the lowercase host from a URL, tolerating missing scheme. */
function hostFromUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
}
