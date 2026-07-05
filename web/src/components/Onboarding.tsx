// The Perch is gated behind onboarding: a signed-in user connects their Claude,
// then fits the Glove (releases a peer card), and only then hunts. This panel
// renders in place of the board until both are done, so a fresh user is never
// dropped onto a stale board or able to scan against the wrong keywords.
import { FalkyrMark } from './brand/FalkyrMark.js';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400';

interface Step {
  key: string;
  title: string;
  blurb: string;
  href: string;
  cta: string;
}

const STEPS: Step[] = [
  {
    key: 'claude',
    title: 'Connect your Claude',
    blurb: 'Falkyr does its thinking on the Claude subscription you already pay for — authorize it once.',
    href: '/connect',
    cta: 'Connect your Claude',
  },
  {
    key: 'glove',
    title: 'Fit the Glove',
    blurb: 'Bring your résumé and let Falkyr distill your peer card — the one honest reading it hunts from.',
    href: '/glove',
    cta: 'Build your peer card',
  },
  {
    key: 'hunt',
    title: 'Hunt',
    blurb: 'Scan the boards for roles matched to your card, and tailor a grounded application to each.',
    href: '',
    cta: '',
  },
];

/** `active` is the index of the first incomplete step (0 = Claude, 1 = Glove). */
export default function Onboarding({ active }: { active: 0 | 1 }) {
  return (
    <div className="flex h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="text-center">
          <FalkyrMark size={40} className="mx-auto text-ink-700" />
          <h2 className="mt-4 font-display text-2xl font-semibold text-[#EDEFF4]">
            Two steps before the first hunt.
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#A7AFC2]">
            Falkyr flies on your own Claude and hunts from your own peer card. Set both up once and
            the Perch is yours.
          </p>
        </div>

        <ol className="mt-8 space-y-3">
          {STEPS.map((step, i) => {
            const done = i < active;
            const current = i === active;
            return (
              <li
                key={step.key}
                className={[
                  'rounded-2xl border p-5 transition',
                  current
                    ? 'border-gold-400/40 bg-gold-400/5'
                    : 'border-ink-800 bg-ink-900/60',
                ].join(' ')}
              >
                <div className="flex items-start gap-4">
                  <span
                    className={[
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
                      done
                        ? 'bg-emerald-400/15 text-emerald-300'
                        : current
                          ? 'bg-gold-400 text-ink-950'
                          : 'bg-ink-850 text-[#6B7488]',
                    ].join(' ')}
                    aria-hidden
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`font-display font-semibold ${current || done ? 'text-[#EDEFF4]' : 'text-[#6B7488]'}`}
                    >
                      {step.title}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-[#A7AFC2]">{step.blurb}</p>
                    {current && step.href && (
                      <a
                        href={step.href}
                        className={`mt-3 inline-block rounded-[10px] bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-gold-300 ${FOCUS_RING}`}
                      >
                        {step.cta}
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
