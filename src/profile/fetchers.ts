// Stage-2 fetchers for the Glove: deterministic, no AI. What these render is
// shown to the user VERBATIM and fed to distill VERBATIM — "you see exactly
// what Falkyr read" holds by construction. Raw fetched text never grounds
// anything (see src/profile/glove.ts).

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const UA = 'Falkyr/0.1 (+local job-search assistant)';
const GITHUB_API = 'https://api.github.com';
const PORTFOLIO_CAP = 20_000; // chars after tag-strip
const README_CAP = 6_000; // chars per repo README excerpt
const FETCH_TIMEOUT_MS = 20_000;

export class FetchGuardError extends Error {}

// ---------------------------------------------------------------------------
// SSRF guard — the portfolio URL is user input pointed at our own server-side
// fetch. Reject anything that could reach loopback/private/link-local ranges,
// both as a literal address and after DNS resolution; re-guard every redirect.
// ---------------------------------------------------------------------------

function isPrivateV4(ip: string): boolean {
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return true; // malformed -> reject
  return (
    o[0] === 0 ||
    o[0] === 10 ||
    o[0] === 127 ||
    (o[0] === 100 && o[1] >= 64 && o[1] <= 127) || // CGNAT
    (o[0] === 169 && o[1] === 254) || // link-local / cloud metadata
    (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
    (o[0] === 192 && o[1] === 168)
  );
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  return (
    v === '::' ||
    v === '::1' ||
    v.startsWith('fc') || // ULA fc00::/7
    v.startsWith('fd') ||
    v.startsWith('fe8') || // link-local fe80::/10
    v.startsWith('fe9') ||
    v.startsWith('fea') ||
    v.startsWith('feb') ||
    v.startsWith('::ffff:') // v4-mapped — re-check the embedded v4
      ? v.startsWith('::ffff:')
        ? isPrivateV4(v.slice(7))
        : true
      : false
  );
}

function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateV4(ip);
  if (family === 6) return isPrivateV6(ip);
  return true; // not an IP -> caller resolves via DNS first
}

/** Throw FetchGuardError unless the URL is public http(s). Returns the parsed URL. */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchGuardError('not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchGuardError('only http(s) URLs are fetched');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new FetchGuardError('local hosts are never fetched');
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new FetchGuardError('private/loopback addresses are never fetched');
    return url;
  }
  let resolved: { address: string }[];
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    throw new FetchGuardError(`could not resolve host ${host}`);
  }
  if (resolved.length === 0 || resolved.some((r) => isPrivateAddress(r.address))) {
    throw new FetchGuardError('host resolves to a private/loopback address');
  }
  return url;
}

/** Fetch with timeout + manual redirects (each hop re-guarded), text response. */
async function guardedFetchText(
  raw: string,
  accept: string,
  maxHops = 3,
): Promise<{ text: string; contentType: string }> {
  let current = raw;
  for (let hop = 0; hop <= maxHops; hop++) {
    const url = await assertPublicHttpUrl(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: accept },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new FetchGuardError(`redirect without location (HTTP ${res.status})`);
        current = new URL(loc, url).toString();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return { text: await res.text(), contentType: res.headers.get('content-type') ?? '' };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new FetchGuardError(`too many redirects (>${maxHops})`);
}

// ---------------------------------------------------------------------------
// GitHub — public REST, unauthenticated (60 req/hr): ≤7 requests total.
// ---------------------------------------------------------------------------

interface GithubRepo {
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  topics?: string[];
  pushed_at: string;
  fork: boolean;
  html_url: string;
  default_branch: string;
  full_name: string;
}

async function githubJson<T>(path: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${GITHUB_API}${path}`, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.status === 404) throw new Error('github: no such user');
    if (res.status === 403 || res.status === 429) {
      const reset = res.headers.get('x-ratelimit-reset');
      const until = reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : 'later';
      throw new Error(`github: rate-limited (60 unauthenticated requests/hour) — retry after ${until}`);
    }
    if (!res.ok) throw new Error(`github: HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deterministic markdown rendering of a GitHub account: profile line, top
 * repos by stars (recent first among ties), README excerpts for the top 5.
 * ≤7 HTTP requests (1 user + 1 repo list + 5 READMEs).
 */
export async function fetchGithubMarkdown(username: string): Promise<string> {
  const u = username.trim().replace(/^@/, '');
  if (!/^[a-zA-Z0-9-]{1,39}$/.test(u)) throw new Error('github: invalid username');

  const user = await githubJson<{ name: string | null; bio: string | null; public_repos: number }>(
    `/users/${u}`,
  );
  const repos = await githubJson<GithubRepo[]>(
    `/users/${u}/repos?per_page=100&sort=pushed`,
  );

  const own = repos.filter((r) => !r.fork);
  own.sort((a, b) => b.stargazers_count - a.stargazers_count || +new Date(b.pushed_at) - +new Date(a.pushed_at));
  const top = own.slice(0, 20);

  const lines: string[] = [
    `# GitHub: ${u}${user.name ? ` (${user.name})` : ''}`,
    user.bio ? `> ${user.bio}` : '',
    `${user.public_repos} public repos; showing top ${top.length} (by stars, then recency).`,
    '',
  ];

  for (const r of top) {
    const bits = [
      r.language ?? undefined,
      r.stargazers_count > 0 ? `★${r.stargazers_count}` : undefined,
      r.topics?.length ? r.topics.slice(0, 6).join(', ') : undefined,
      `pushed ${r.pushed_at.slice(0, 10)}`,
    ].filter(Boolean);
    lines.push(`- **${r.name}** — ${r.description ?? 'no description'} (${bits.join(' · ')})`);
  }

  // README excerpts for the top 5 (raw media type; ignore failures per-repo).
  for (const r of top.slice(0, 5)) {
    try {
      const { text } = await guardedFetchText(
        `https://raw.githubusercontent.com/${r.full_name}/${r.default_branch}/README.md`,
        'text/plain',
      );
      const excerpt = text.trim().slice(0, README_CAP);
      if (excerpt) {
        lines.push('', `## ${r.name} README (first ${Math.min(text.trim().length, README_CAP)} chars)`, excerpt);
      }
    } catch {
      /* no README or unreadable — skip silently; the repo line above remains */
    }
  }

  return lines.filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n');
}

// ---------------------------------------------------------------------------
// Portfolio — fetch one page, strip to text, cap visibly.
// ---------------------------------------------------------------------------

/** Crude but deterministic HTML → text: drop script/style, strip tags, tidy. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** Fetch a portfolio page as readable text (SSRF-guarded, capped visibly). */
export async function fetchPortfolioText(url: string): Promise<string> {
  const { text, contentType } = await guardedFetchText(url, 'text/html,text/plain;q=0.9');
  const isHtml = contentType.includes('html') || /^\s*</.test(text);
  const readable = isHtml ? htmlToText(text) : text.trim();
  if (!readable) throw new Error('portfolio: page had no readable text');
  if (readable.length > PORTFOLIO_CAP) {
    return `${readable.slice(0, PORTFOLIO_CAP)}\n\n[truncated at ${PORTFOLIO_CAP.toLocaleString()} characters — Falkyr reads exactly the text above]`;
  }
  return readable;
}
