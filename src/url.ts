// Canonical job-URL normalization. Two jobs of the same posting must produce the
// SAME url string, or dedup (the UNIQUE url column) silently stores duplicates —
// which also corrupts the de-correlation score (the same job counted twice).
//
// This runs at every ingest chokepoint (live providers + career-ops import) so
// forms that differ only cosmetically — trailing slash, host case, utm_* params,
// or Workable's /jobs/view/{code} vs canonical /{account}/j/{code} — collapse to
// one. Best-effort: unparseable input is returned trimmed, never thrown.

/** Normalize a job URL to a single canonical string for storage + dedup. */
export function canonicalizeUrl(raw: string): string {
  const t = (raw ?? '').trim();
  if (!t) return t;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return t;
  }
  const host = u.hostname.toLowerCase().replace(/\.+$/, ''); // lowercase + strip trailing dot

  let path = u.pathname;
  // Workable: the widget API hands back the slug-LESS shortlink
  // (apply.workable.com/j/{code}); the older career-ops scan used
  // /{account}/jobs/view/{code}. The canonical human posting URL is
  // /{account}/j/{code} — rewrite the /jobs/view/ form to it so both converge.
  if (host === 'apply.workable.com') {
    const m = path.match(/^\/([^/]+)\/jobs\/view\/([^/]+)\/?$/i);
    if (m) path = `/${m[1]}/j/${m[2]}`;
  }
  path = path.replace(/\/+$/, '') || '/'; // drop trailing slash (keep root)

  // Keep query params EXCEPT unambiguous tracking (utm_*). We deliberately do
  // NOT strip gh_jid / job-id params — some external career pages need them.
  const keep = [...u.searchParams.entries()].filter(([k]) => !/^utm_/i.test(k));
  const qs = keep.length ? '?' + keep.map(([k, v]) => `${k}=${v}`).join('&') : '';

  return `${u.protocol}//${host}${path}${qs}`;
}
