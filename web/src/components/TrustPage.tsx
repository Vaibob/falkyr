// The mews — doors open. The public trust page (/trust).
//
// In falconry the mews is where the bird actually lives; opening its doors is
// the opposite of marketing. This page turns Falkyr's ethics plumbing into
// VISIBLE, auditable claims — each one names the exact file + mechanism so it
// can be checked, not taken on faith.
//
// IMPORTANT (honesty): every claim here is a PROMISE. If Phase-2 auto-submit
// or any future change weakens one, update this page in the same commit.
// The claim texts below are audited against the source — do not edit them
// without re-reading the named file.

import type { ReactNode } from 'react';
import { useReveal } from '../hooks/useReveal.js';
import { FalkyrLogo } from './brand/FalkyrMark.js';
import { TAGLINE } from '../brand.js';

interface Claim {
  n: number;
  title: string;
  promise: string;
  mechanism: string;
  file: string;
}

const CLAIMS: Claim[] = [
  {
    n: 1,
    title: 'The fabrication check is deterministic — not another AI',
    promise:
      'Every tailored résumé is checked, line by line, that each claim traces to your real CV. Numbers you never had, and honest-gap terms (PhD, top-tier papers, frontier distributed RL, robotics), are flagged before you can approve.',
    mechanism:
      'A ~130-line pure function — no LLM, no network. Its own comment says it best: “a verifier that must catch hallucination should itself be deterministic — never another LLM that could rationalize the fabrication.”',
    file: 'src/verify/grounding.ts',
  },
  {
    n: 2,
    title: 'Exactly one function can submit — and it re-checks two keys',
    promise:
      'Nothing is ever submitted on your behalf unless you approved that specific job AND you set a machine-level opt-in. There is no “submit all”, no force flag, no override.',
    mechanism:
      'One clickSubmit() re-checks job.stage === "approved" AND env JOBPILOT_ALLOW_SUBMIT === "true" at the moment of action. Default mode fills the form and STOPS at the button.',
    file: 'src/apply/autofill.ts',
  },
  {
    n: 3,
    title: 'LinkedIn & Indeed are permanently blocked',
    promise:
      'Falkyr never sources from, opens, fills, or submits on LinkedIn or Indeed — the platforms that ban automation and get people’s accounts nuked.',
    mechanism:
      'A code-level host block (BLOCKED_APPLY_HOSTS) enforced in BOTH ingest and the apply engine, with trailing-dot normalization so “linkedin.com.” can’t sneak past. Not a setting — a constant.',
    file: 'src/config.ts',
  },
  {
    n: 4,
    title: 'Demographic & work-authorization questions are never auto-answered',
    promise:
      'EEO/demographic questions are auto-declined (or left blank). Work-authorization and visa-sponsorship questions are left for YOU with a “⚠ needs you” flag. Falkyr never guesses a yes/no that could misrepresent you.',
    mechanism:
      'The typed-control filler classifies each question and refuses to answer the sensitive ones — it can only decline or flag, never fabricate a stance.',
    file: 'src/apply/fields.ts',
  },
  {
    n: 5,
    title: 'Your Claude, your machine, your CV — nothing is uploaded',
    promise:
      'The AI runs on YOUR Claude Code subscription, on YOUR machine. Your CV and generated materials live in a local database. We never hold your Anthropic credentials.',
    mechanism:
      'Falkyr is driven by your own Claude Code via an MCP server. The API binds to loopback (127.0.0.1) with a Host-header guard, so it isn’t reachable as a network service. There is no cloud upload path in this tool.',
    file: 'src/mcp/server.ts · src/server/app.ts',
  },
];

const WILL_NOT = [
  {
    title: 'No LinkedIn or Indeed automation',
    body: 'Both platforms ban automation and suspend accounts for it. Falkyr never opens, fills, or submits there — the block is a constant in the code, not a setting you could flip.',
  },
  {
    title: 'No blind submit',
    body: 'Default mode fills the form and stops at the button. Sending anything requires your approval of that specific job plus an explicit machine-level opt-in. There is no “submit all”.',
  },
  {
    title: 'No fabrication',
    body: 'The Jesses — a deterministic verifier, deliberately not an AI — refuses any line that does not trace back to your real CV. A flagged claim cannot be approved past it.',
  },
  {
    title: 'No credentials held',
    body: 'Your Claude subscription stays yours; we never see or store its login. Your CV and every generated document live in a local database on your machine.',
  },
];

/** Scroll-reveal wrapper (CSS .reveal + useReveal hook — no motion library). */
function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${className}`}>
      {children}
    </div>
  );
}

/** Barred-circle glyph for the “will not do” list. Decorative; inherits color. */
function NoGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="mt-0.5 shrink-0">
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.4 15.1 15.1 5.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function TrustPage() {
  const claimsRef = useReveal<HTMLOListElement>();

  return (
    <div className="min-h-screen bg-ink-950 text-[#EDEFF4] antialiased">
      {/* ---- Header ---- */}
      <header className="sticky top-0 z-30 border-b border-ink-800/70 bg-ink-950/80 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <a href="/" aria-label="Falkyr home" className="text-[#EDEFF4]">
            <FalkyrLogo size={24} />
          </a>
          <a
            href="/"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-[#A7AFC2] ring-1 ring-ink-700 transition duration-[120ms] hover:bg-ink-850 hover:text-[#EDEFF4]"
          >
            ← Back
          </a>
        </nav>
      </header>

      <main>
      {/* ---- Hero: the mews, doors open ---- */}
      <section className="relative overflow-hidden">
        {/* Quiet editorial macro of the jesses (same-origin webp), anchored right
            and dimmed so the headline sits on solid ink at every width. */}
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-40"
          style={{
            backgroundImage: 'url(/art/jesses.webp)',
            maskImage: 'linear-gradient(to right, transparent 30%, black 75%)',
            WebkitMaskImage: 'linear-gradient(to right, transparent 30%, black 75%)',
          }}
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/85 to-ink-950/40" aria-hidden />

        <div className="relative mx-auto max-w-3xl px-5 py-20 md:py-28">
          <p className="text-xs font-semibold uppercase tracking-widest text-gold-400">Trust &amp; Safety</p>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-[-0.025em] md:text-5xl">
            The mews — doors open.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#A7AFC2]">
            A falconer who claims his bird never misses is lying. So this page publishes exactly
            what Falkyr does — and what it will never do. None of it is marketing: every promise
            below is a mechanism in the code, named down to the file, so it can be checked rather
            than taken on faith.
          </p>
        </div>
      </section>

      {/* ---- The five auditable claims ---- */}
      <section className="border-t border-ink-800/70 py-16 md:py-20" aria-labelledby="claims-heading">
        <div className="mx-auto max-w-3xl px-5">
          <Reveal>
            <h2 id="claims-heading" className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
              Five promises you can check in the code
            </h2>
            <p className="mt-3 max-w-xl text-[#A7AFC2]">
              Each card names the exact file. Open it in your editor — the mechanisms are short,
              and they are the whole argument.
            </p>
          </Reveal>

          <ol ref={claimsRef} className="reveal reveal-stagger mt-10 space-y-5">
            {CLAIMS.map((c) => (
              <li
                key={c.n}
                className="rounded-2xl border border-ink-800 bg-ink-900 p-6 transition duration-[120ms] ease-settle hover:border-ink-700 motion-safe:hover:-translate-y-0.5"
              >
                <div className="flex items-baseline gap-4">
                  <span className="font-mono text-xs tabular-nums text-[#6B7488]">
                    {String(c.n).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-display text-lg font-semibold leading-snug">{c.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#A7AFC2]">{c.promise}</p>
                    <p className="mt-3 text-sm leading-relaxed text-[#6B7488]">
                      <span className="font-semibold text-[#A7AFC2]">How: </span>
                      {c.mechanism}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <code className="rounded bg-ink-850 px-2 py-1 font-mono text-[11px] text-[#A7AFC2] ring-1 ring-ink-700">
                        {c.file}
                      </code>
                      <a
                        href="#how-to-verify"
                        aria-label={`How to verify: ${c.title}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-gold-400 transition duration-[120ms] hover:text-gold-300"
                      >
                        verify in code <span aria-hidden>→</span>
                      </a>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---- What Falkyr will not do ---- */}
      <section className="border-t border-ink-800/70 py-16 md:py-20" aria-labelledby="willnot-heading">
        <div className="mx-auto max-w-3xl px-5">
          <Reveal>
            <h2 id="willnot-heading" className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
              What Falkyr will not do
            </h2>
            <p className="mt-3 max-w-xl text-[#A7AFC2]">
              Named as prominently as what it does — because the refusals are the product too.
            </p>
          </Reveal>
          <Reveal className="mt-10 grid gap-5 sm:grid-cols-2">
            {WILL_NOT.map((w) => (
              <div key={w.title} className="flex items-start gap-3 rounded-2xl border border-ink-800 bg-ink-900 p-5">
                <span className="text-[#6B7488]">
                  <NoGlyph />
                </span>
                <div>
                  <h3 className="font-display text-base font-semibold">{w.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[#A7AFC2]">{w.body}</p>
                </div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ---- Keeping this page honest ---- */}
      <section className="border-t border-ink-800/70 py-16 md:py-20" aria-labelledby="how-to-verify">
        <div className="mx-auto max-w-3xl px-5">
          <Reveal className="rounded-2xl border border-ink-700 bg-ink-900 p-6 md:p-8">
            <h2 id="how-to-verify" className="font-display text-xl font-semibold tracking-tight">
              How to verify — and how this page stays honest
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#A7AFC2]">
              Every path above is relative to the root of the Falkyr source. Your install is the
              audit copy: open any of those files in your editor and read the mechanism yourself —
              the longest is a few minutes of careful reading.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[#A7AFC2]">
              These are promises, not decorations. Auto-submit — letting Falkyr click “submit” for
              you — is <span className="font-semibold text-[#EDEFF4]">off by design</span> today:
              it requires the per-job approval plus the explicit machine opt-in described above.
              Until then, every application waits, returned to hand, for you to release it. If any
              of this ever changes, this page changes with it, in the same commit.
            </p>
          </Reveal>
        </div>
      </section>
      </main>

      {/* ---- Footer (consistent with the landing) ---- */}
      <footer className="border-t border-ink-800 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-5 md:flex-row md:px-8">
          <div className="flex flex-col items-center gap-2 md:items-start">
            <a href="/" aria-label="falkyr — home" className="text-[#EDEFF4]">
              <FalkyrLogo size={22} />
            </a>
            <span className="text-[13px] text-[#6B7488]">{TAGLINE}</span>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-ink-700 px-3.5 py-1.5 text-xs tabular-nums text-[#A7AFC2]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#34C08B]" aria-hidden />
            Local mode — 0 documents uploaded
          </span>
          <div className="flex items-center gap-6 text-sm text-[#6B7488]">
            <a href="/app" className="transition-colors duration-150 hover:text-[#EDEFF4]">
              Open the Perch
            </a>
            <a href="/" className="transition-colors duration-150 hover:text-[#EDEFF4]">
              Home
            </a>
            <span>© 2026 falkyr</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
