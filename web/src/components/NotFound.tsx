// 404 — unknown path (DESIGN.md §5 polish checklist). Quiet ink page, one
// gold action, no drama. Served by the SPA fallback for any route the tiny
// router doesn't know.
import { FalkyrLogo, FalkyrMark } from './brand/FalkyrMark.js';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-[#EDEFF4] antialiased">
      <header className="border-b border-ink-800/70">
        <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center px-5 py-3.5 md:px-8">
          <a href="/" aria-label="falkyr — home" className="text-[#EDEFF4]">
            <FalkyrLogo size={24} />
          </a>
        </nav>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-20">
        <div className="max-w-md text-center">
          <FalkyrMark size={40} className="mx-auto text-ink-700" />
          <p className="mt-6 font-mono text-xs font-medium tabular-nums text-[#6B7488]">404</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.025em] md:text-4xl">
            Nothing at this address.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[#A7AFC2]">
            The page you&rsquo;re after doesn&rsquo;t exist — the link may be old, or mistyped.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/"
              className="rounded-[10px] bg-gold-400 px-5 py-2.5 text-sm font-semibold text-ink-950 transition-colors duration-150 hover:bg-gold-300"
            >
              Back to the start
            </a>
            <a
              href="/app"
              className="rounded-[10px] border border-ink-700 px-5 py-2.5 text-sm font-medium text-[#EDEFF4] transition-colors duration-150 hover:bg-ink-900"
            >
              Open the Perch
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
