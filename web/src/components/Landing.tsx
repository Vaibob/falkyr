// Falkyr landing — the marketing page. Dark-first, mobile-first, motion per
// DESIGN.md §4 ("the stoop and the return": fast in, feather-soft stop).
// Copy conforms to BRAND.md: the falconer's register — calm, exact, a little
// wild. At most one falconry term per section; banned words avoided. All art
// is same-origin (web/public/hero, web/public/art). No new dependencies.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useReveal } from '../hooks/useReveal.js';
import { FalkyrHeroMark, FalkyrLogo, FalkyrMark } from './brand/FalkyrMark.js';
import { FalkyrCompanion } from './brand/FalkyrCompanion.js';
import { AuthControls } from '../auth.js';
import { TAGLINE } from '../brand.js';

/* ---------------------------------------------------------------- helpers */

function Reveal({
  children,
  className = '',
  stagger = false,
}: {
  children: ReactNode;
  className?: string;
  stagger?: boolean;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${stagger ? 'reveal-stagger' : ''} ${className}`}>
      {children}
    </div>
  );
}

/** Section kicker — deliberately quiet; gold stays scarce (DESIGN.md §2). */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#6B7488]">{children}</p>
  );
}

const NAV_LINKS = [
  ['How it hunts', '#how'],
  ['The Jesses', '#jesses'],
  ['Pricing', '#pricing'],
  ['Trust', '/trust'],
] as const;

const STEPS = [
  {
    n: '01',
    title: 'Mark the quarry',
    body: 'Overnight, Falkyr scans Greenhouse, Lever, Ashby, Workable, and the remote boards, scoring each posting against your real profile. Never LinkedIn, never Indeed.',
  },
  {
    n: '02',
    title: 'On the wing',
    body: 'For each role it cuts a genuinely different application from your real experience — de-correlated from the pile, never copy-pasted from a template.',
  },
  {
    n: '03',
    title: 'Returned to hand',
    body: 'Nothing submits itself. Every application comes back to you and waits — on your review, and your release.',
  },
] as const;

const PRICE_POINTS = [
  'Runs on the Claude subscription you already pay for — no second AI bill hiding in the price.',
  'Competitors rent a cloud model and pass you the bill. Their compute costs are why they charge $24–$80 a month.',
  'One flat price. No per-application credits, no tiers, pause any month.',
] as const;

/* ------------------------------------------------------------------- page */

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // The hero cinemagraph only plays where it earns its bytes: wide viewports,
  // no reduced-motion preference. Everyone else keeps the still (the LCP image).
  const [heroVideo, setHeroVideo] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const wide = window.matchMedia('(min-width: 768px)');
    const update = () => setHeroVideo(!motion.matches && wide.matches);
    update();
    motion.addEventListener('change', update);
    wide.addEventListener('change', update);
    return () => {
      motion.removeEventListener('change', update);
      wide.removeEventListener('change', update);
    };
  }, []);

  const navSolid = scrolled || menuOpen;

  return (
    <div className="min-h-screen bg-ink-950 text-[#EDEFF4] antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[10px] focus:bg-ink-900 focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      {/* ------------------------------------------------------------ nav */}
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-colors duration-200 ${
          navSolid
            ? 'border-b border-ink-800 bg-ink-950/80 backdrop-blur'
            : 'border-b border-transparent bg-transparent'
        }`}
      >
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 md:px-8">
          <a href="/" aria-label="falkyr — home" className="inline-flex items-center gap-2 text-[#EDEFF4]">
            {/* The living mark — its eye follows the cursor. */}
            <FalkyrCompanion size={24} />
            <span className="font-display font-semibold" style={{ fontSize: 18.7, letterSpacing: '-0.02em' }}>
              falkyr
            </span>
          </a>
          <div className="ml-auto hidden items-center gap-7 text-sm text-[#A7AFC2] sm:flex">
            {NAV_LINKS.map(([label, href]) => (
              <a key={href} href={href} className="transition-colors duration-150 hover:text-[#EDEFF4]">
                {label}
              </a>
            ))}
          </div>
          {/* Sign in / user button — nothing in local (key-less) mode. */}
          <span className="hidden sm:block">
            <AuthControls />
          </span>
          {/* Outline until scroll — the hero CTA is the one gold block in the
              first viewport (DESIGN.md §2: gold is scarce). */}
          <a
            href="/app"
            className={`hidden rounded-[10px] px-4 py-2 text-sm font-semibold transition-colors duration-150 sm:block ${
              scrolled
                ? 'bg-gold-400 text-ink-950 hover:bg-gold-300'
                : 'border border-gold-400/40 text-gold-400 hover:border-gold-400 hover:text-gold-300'
            }`}
          >
            Open the Perch
          </a>
          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="ml-auto flex h-10 w-10 items-center justify-center rounded-[10px] text-[#EDEFF4] sm:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              {menuOpen ? (
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              ) : (
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </nav>
        {menuOpen && (
          <div id="mobile-menu" className="border-t border-ink-800 bg-ink-950/95 px-5 pb-5 pt-2 backdrop-blur sm:hidden">
            {NAV_LINKS.map(([label, href]) => (
              <a
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-[10px] px-2 py-3 text-base text-[#A7AFC2] transition-colors duration-150 hover:text-[#EDEFF4]"
              >
                {label}
              </a>
            ))}
            <a
              href="/app"
              className="mt-3 block rounded-[10px] bg-gold-400 px-4 py-3 text-center text-sm font-semibold text-ink-950 transition-colors duration-150 hover:bg-gold-300"
            >
              Open the Perch
            </a>
          </div>
        )}
      </header>

      <main id="main">
        {/* --------------------------------------------------------- hero */}
        <section className="relative flex min-h-screen items-center overflow-hidden">
          {/* Cinematic art layer: falconer silhouette left (near-black,
              headline-safe), falcon lit gold at the right. The gradient keeps
              the dark left third solid for text at every width. */}
          <img
            src="/hero/falcon.webp"
            width={1920}
            height={1080}
            alt="A falconer in silhouette, arm extended toward a falcon lit by a single warm gold light, jesses hanging from its legs"
            className="absolute inset-0 h-full w-full object-cover object-[68%_center] md:object-right"
          />
          {/* The living hero: a 5s cinemagraph of the same frame — the falcon
              shifts its weight, the jesses sway, the light breathes. Desktop +
              motion-safe only; the still above is the poster and the fallback. */}
          {heroVideo && (
            <video
              className="absolute inset-0 h-full w-full object-cover object-right"
              src="/hero/falcon-loop.mp4"
              poster="/hero/falcon.webp"
              autoPlay
              muted
              loop
              playsInline
              aria-hidden
            />
          )}
          <div
            className="absolute inset-0 bg-gradient-to-r from-ink-950 from-30% via-ink-950/80 via-60% to-transparent"
            aria-hidden
          />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-950 to-transparent" aria-hidden />

          <div className="relative mx-auto w-full max-w-6xl px-5 pb-24 pt-32 md:px-8">
            <Reveal stagger className="max-w-xl">
              <div>
                <FalkyrHeroMark size={40} className="text-[#EDEFF4]" />
              </div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-[#A7AFC2]">
                A local-first job-application agent
              </p>
              {/* The tagline is the headline — BRAND.md, verbatim. */}
              <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.02] tracking-[-0.03em] md:text-6xl lg:text-7xl">
                Hunts from
                <br />
                your hand.
              </h1>
              <p className="mt-6 max-w-md text-lg leading-snug text-[#A7AFC2]">
                Falkyr is built for technical job-seekers who already pay for Claude. It studies each
                role on its own, writes a genuinely different application from your real experience,
                verifies every line against your CV — and never submits anything without your release.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <a
                  href="/app"
                  className="rounded-[10px] bg-gold-400 px-6 py-3 text-sm font-semibold text-ink-950 transition-colors duration-150 hover:bg-gold-300"
                >
                  Open the Perch
                </a>
                <a
                  href="#how"
                  className="rounded-[10px] border border-ink-700 px-6 py-3 text-sm font-medium text-[#EDEFF4] transition-colors duration-150 hover:border-ink-700 hover:bg-ink-900"
                >
                  See how it hunts
                </a>
              </div>
              <p className="mt-5 text-[13px] leading-relaxed text-[#6B7488]">
                No new AI bill — runs on your own Claude. Your CV never leaves this machine.
              </p>
            </Reveal>
          </div>
        </section>

        {/* -------------------------------------------------- how it hunts */}
        <section id="how" className="scroll-mt-20 border-t border-ink-800/40 bg-ink-900/40 py-24 md:py-32">
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <Reveal>
              <Eyebrow>How it hunts</Eyebrow>
              <h2 className="mt-3 max-w-xl font-display text-3xl font-semibold tracking-[-0.025em] md:text-[40px] md:leading-[1.15]">
                One role at a time, end to end.
              </h2>
            </Reveal>
            <Reveal stagger className="mt-14 grid gap-5 md:grid-cols-3 md:gap-6">
              {STEPS.map((s) => (
                <div
                  key={s.n}
                  className="rounded-2xl border border-ink-800 bg-ink-900 p-6 transition duration-150 hover:border-ink-700 motion-safe:hover:-translate-y-0.5 md:p-7"
                >
                  <div className="font-mono text-xs font-medium tabular-nums text-gold-400">{s.n}</div>
                  <h3 className="mt-4 font-display text-xl font-semibold">{s.title}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-[#A7AFC2]">{s.body}</p>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        {/* --------------------------------------------- monoculture story */}
        <section className="scroll-mt-20 border-t border-ink-800/40 py-28 md:py-36">
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
              <Reveal>
                <Eyebrow>Why it exists</Eyebrow>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.025em] md:text-[40px] md:leading-[1.15]">
                  The job hunt became a monoculture.
                </h2>
                {/* Canonical story, BRAND.md — near-verbatim. */}
                <p className="mt-6 text-[17px] leading-relaxed text-[#A7AFC2]">
                  Everyone runs their résumé through the same AI polishers and pushes it through the
                  same screeners — and Stanford research on algorithmic hiring found exactly what that
                  produces: identical applications get{' '}
                  <strong className="font-semibold text-gold-400">correlated rejections</strong>.
                  Getting filtered once means getting filtered everywhere. A thousand tame pigeons, all
                  flying the same line, all shot down by the same gun.
                </p>
                <p className="mt-5 text-[17px] leading-relaxed text-[#A7AFC2]">
                  Falkyr is a different animal. A falcon is not released at the whole sky — the
                  falconer marks one quarry, and the bird studies it before it ever leaves the glove.
                  For every role, Falkyr reads the job&rsquo;s actual demands and cuts a genuinely
                  different application from your real experience. It hunts from your own glove: your
                  Claude subscription, your machine — your CV never uploaded, no bot farm, no
                  credentials held.
                </p>
              </Reveal>
              <Reveal>
                <figure>
                  <div className="overflow-hidden rounded-2xl border border-ink-800">
                    <img
                      src="/art/nightscan.webp"
                      width={1200}
                      height={900}
                      loading="lazy"
                      decoding="async"
                      alt="A single warm gold line tracing across a navy night sky"
                      className="h-auto w-full object-cover"
                    />
                  </div>
                  <figcaption className="mt-4 text-[13px] leading-relaxed text-[#6B7488]">
                    The overnight scan — one line across the night. Each posting is read on its own,
                    not sprayed at by the thousand.
                  </figcaption>
                </figure>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ the jesses */}
        <section id="jesses" className="scroll-mt-20 border-t border-ink-800/40 bg-ink-900/40 py-24 md:py-32">
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
              <Reveal className="md:order-last">
                <Eyebrow>The verifier</Eyebrow>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.025em] md:text-[40px] md:leading-[1.15]">
                  The Jesses
                </h2>
                <p className="mt-6 text-[17px] leading-relaxed text-[#A7AFC2]">
                  A deterministic verifier — deliberately not an AI — checks that every line of every
                  application traces back to something true in your CV. Every skill, every date, every
                  claim.
                </p>
                <p className="mt-5 text-[17px] leading-relaxed text-[#A7AFC2]">
                  No model grading its own homework, no confidence scores. Plain code with a yes or a
                  no: if a line can&rsquo;t be traced, it gets flagged and the application waits.
                </p>
                <a
                  href="/trust"
                  className="mt-7 inline-block rounded-[4px] text-[15px] font-medium text-gold-400 transition-colors duration-150 hover:text-gold-300"
                >
                  Read the guarantees →
                </a>
              </Reveal>
              <Reveal>
                <div className="overflow-hidden rounded-2xl border border-ink-800">
                  <img
                    src="/art/jesses.webp"
                    width={1200}
                    height={900}
                    loading="lazy"
                    decoding="async"
                    alt="Leather jesses and a brass ring, lit by a single warm light against deep navy"
                    className="h-auto w-full object-cover"
                  />
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- the glove */}
        <section id="glove" className="scroll-mt-20 border-t border-ink-800/40 py-24 md:py-32">
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
              <Reveal>
                <Eyebrow>Your profile</Eyebrow>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.025em] md:text-[40px] md:leading-[1.15]">
                  The Glove
                </h2>
                <p className="mt-6 text-[17px] leading-relaxed text-[#A7AFC2]">
                  One honest reading of who you are — your CV, your voice, your real gaps — written
                  once and kept on your machine.
                </p>
                <p className="mt-5 text-[17px] leading-relaxed text-[#A7AFC2]">
                  It is the source every application is cut from. If something isn&rsquo;t in the
                  Glove, Falkyr cannot claim it; if it is, Falkyr can say it in your voice.
                </p>
              </Reveal>
              <Reveal>
                <div className="overflow-hidden rounded-2xl border border-ink-800">
                  <img
                    src="/art/glove.webp"
                    width={1200}
                    height={900}
                    loading="lazy"
                    decoding="async"
                    alt="Close-up of a falconer's leather glove in warm gold half-light"
                    className="h-auto w-full object-cover"
                  />
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- pricing */}
        <section id="pricing" className="scroll-mt-20 border-t border-ink-800/40 bg-ink-900/40 py-24 md:py-32">
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <Reveal className="mx-auto max-w-xl text-center">
              <Eyebrow>Pricing</Eyebrow>
              <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.025em] md:text-[40px] md:leading-[1.15]">
                We charge for the bird, not the brain.
              </h2>
              <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-[#A7AFC2]">
                The model that does the thinking is the Claude you already pay for. What&rsquo;s left
                to charge for is the tool — so that is all we charge for.
              </p>
            </Reveal>
            <Reveal className="mx-auto mt-12 max-w-md">
              <div className="rounded-2xl border border-ink-700 bg-ink-900 p-8">
                <div className="text-sm font-medium text-[#A7AFC2]">falkyr</div>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="font-display text-5xl font-semibold tabular-nums tracking-[-0.02em]">$11</span>
                  <span className="text-base text-[#6B7488]">/mo</span>
                </div>
                <p className="mt-2 text-[13px] text-[#6B7488]">
                  On top of the Claude subscription you already pay for.
                </p>
                <ul className="mt-7 space-y-3 text-[15px] leading-relaxed text-[#A7AFC2]">
                  {PRICE_POINTS.map((li) => (
                    <li key={li} className="flex items-start gap-3">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="mt-1 shrink-0">
                        <path d="M3.5 8.5l3 3 6-7" stroke="#6B7488" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="tabular-nums">{li}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="/app"
                  className="mt-8 block rounded-[10px] bg-gold-400 px-6 py-3 text-center text-sm font-semibold text-ink-950 transition-colors duration-150 hover:bg-gold-300"
                >
                  Open the Perch
                </a>
              </div>
              <p className="mt-5 text-center text-[13px] tabular-nums text-[#6B7488]">
                Teal $36 · Sonara $24 · AIApply $68 — <span className="text-[#A7AFC2]">Falkyr $11</span>,
                on the Claude you already have.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------- final CTA band */}
        <section className="border-t border-ink-800/40 py-24 md:py-32">
          <Reveal className="mx-auto max-w-2xl px-5 text-center md:px-8">
            <FalkyrMark size={44} className="mx-auto text-[#EDEFF4]" />
            <h2 className="mt-7 font-display text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
              One bird. One target. One clean strike.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-[#A7AFC2]">
              Set it up tonight; review what comes back in the morning. Nothing goes out until you
              release it.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="/app"
                className="rounded-[10px] bg-gold-400 px-6 py-3 text-sm font-semibold text-ink-950 transition-colors duration-150 hover:bg-gold-300"
              >
                Open the Perch
              </a>
              <a
                href="/trust"
                className="rounded-[10px] border border-ink-700 px-6 py-3 text-sm font-medium text-[#EDEFF4] transition-colors duration-150 hover:bg-ink-900"
              >
                Read the guarantees
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ---------------------------------------------------------- footer */}
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
            <a href="/trust" className="transition-colors duration-150 hover:text-[#EDEFF4]">
              Trust
            </a>
            <span>© 2026 falkyr</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
