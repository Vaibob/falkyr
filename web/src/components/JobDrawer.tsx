import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import type { Answer, JobDetail, JobEvent, GroundingReport } from '../types.js';
import { api, ApiError } from '../api.js';
import { STAGE_META, formatFitScore } from '../stageMeta.js';
import StrategyPanel from './StrategyPanel.js';
import { FalkyrMark } from './brand/FalkyrMark.js';

interface JobDrawerProps {
  jobId: number;
  onClose: () => void;
  onJobChanged: () => void;
}

type ActionKey = 'generate' | 'approve' | 'fill' | 'submit' | 'stage';

/**
 * Drawer entrance — 200ms, var(--ease-stoop): fast in, feather-soft stop.
 * Mobile (<768px) is a full-screen sheet rising from the bottom edge; desktop
 * slides in from the right. Neutralized under prefers-reduced-motion here and
 * by the global reduced-motion block in index.css.
 */
const DRAWER_CSS = `
@keyframes falkyr-drawer-in { from { opacity: 0; transform: translateX(32px); } to { opacity: 1; transform: none; } }
@keyframes falkyr-sheet-up { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
@keyframes falkyr-scrim-in { from { opacity: 0; } to { opacity: 1; } }
.falkyr-drawer { animation: falkyr-sheet-up 200ms var(--ease-stoop) both; }
@media (min-width: 768px) { .falkyr-drawer { animation-name: falkyr-drawer-in; } }
.falkyr-scrim { animation: falkyr-scrim-in 200ms ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .falkyr-drawer, .falkyr-scrim { animation: none; }
}
`;

/** Event type/detail patterns that mean a run has finished (stop live polling). */
const TERMINAL = /apply\.(stopped|submitted|done|error|blocked_host)|generation complete|rewrite complete|generate\.(error|paused)|rewrite\.(error|paused)/i;
function isTerminal(ev: JobEvent): boolean {
  return TERMINAL.test(`${ev.type ?? ''} ${ev.detail ?? ''}`);
}
function maxEventId(d: JobDetail | null): number {
  return d?.events.reduce((m, e) => Math.max(m, e.id), 0) ?? 0;
}

export default function JobDrawer({ jobId, onClose, onJobChanged }: JobDrawerProps) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ActionKey | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  // Live activity: while true, poll the job's events every ~1.3s until a
  // terminal event appears past the baseline captured when the run started.
  const [live, setLive] = useState(false);
  const [liveBaseline, setLiveBaseline] = useState(0);
  // Non-fabrication report for the tailored CV + a hard-flag acknowledgment.
  const [verify, setVerify] = useState<GroundingReport | null>(null);
  const [verifyAck, setVerifyAck] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLive(false);
    try {
      setDetail(await api.getJob(jobId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load job');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  /** Silent refetch (no loading spinner) — used by polling and after actions. */
  const refresh = useCallback(async (): Promise<JobDetail | null> => {
    try {
      const d = await api.getJob(jobId);
      setDetail(d);
      return d;
    } catch {
      return null;
    }
  }, [jobId]);

  const startLivePolling = useCallback(() => {
    setLiveBaseline(maxEventId(detail));
    setLive(true);
    void refresh();
  }, [detail, refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-fetch the non-fabrication report whenever the tailored CV changes
  // (new cv answer id) so the verdict is visible without anyone calling a tool.
  const cvAnswerId = detail?.answers.reduce((m, a) => (a.kind === 'cv' ? Math.max(m, a.id) : m), 0) ?? 0;
  useEffect(() => {
    if (!cvAnswerId) {
      setVerify(null);
      setVerifyAck(false);
      return;
    }
    let cancelled = false;
    api
      .verify(jobId)
      .then((r) => {
        if (!cancelled) {
          setVerify(r.report);
          setVerifyAck(false);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [jobId, cvAnswerId]);

  // Live polling loop.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const startedAt = Date.now();
    const tick = async () => {
      const d = await refresh();
      if (cancelled) return;
      const fresh = (d?.events ?? []).filter((e) => e.id > liveBaseline);
      const terminal = fresh.find(isTerminal);
      if (terminal) {
        setLive(false);
        // Surface pauses/errors prominently — the whole point of QW3 is the user
        // NOTICES a Claude-limit pause instead of silently getting a template.
        const t = `${terminal.type ?? ''} ${terminal.detail ?? ''}`;
        if (/paused/i.test(t)) {
          setToast({ kind: 'err', msg: terminal.detail ?? 'Paused: Claude usage limit — retry when it resets.' });
        } else if (/\.error/i.test(t)) {
          setToast({ kind: 'err', msg: terminal.detail ?? 'The run failed — see the activity log.' });
        }
        onJobChanged();
        return;
      }
      // Safety cap must exceed runClaude's 180s timeout (+ spawn/queue overhead)
      // so a slow-but-live generation never looks dead before its event lands.
      if (Date.now() - startedAt > 210_000) setLive(false);
    };
    void tick();
    const iv = setInterval(() => void tick(), 1300);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [live, liveBaseline, refresh, onJobChanged]);

  // Dialog focus management (DESIGN.md §5: full keyboard path through the
  // drawer). On open, move focus into the dialog; on unmount, hand it back.
  const drawerRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawerRef.current?.focus();
    return () => opener?.focus();
  }, []);

  // Close on Escape; keep Tab cycling inside the dialog while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = drawerRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (active && !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  const STEP_TARGETS = ['drawer-step-generate', 'drawer-step-review', 'drawer-step-approve', 'drawer-step-submit'] as const;

  const scrollToStep = (stepIndex: number) => {
    const id = STEP_TARGETS[stepIndex];
    const root = scrollRef.current;
    const el = id && root ? root.querySelector<HTMLElement>(`#${id}`) : null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const runAction = async (
    key: ActionKey,
    fn: () => Promise<unknown>,
    okMsg: string,
    opts?: { live?: boolean },
  ) => {
    setBusy(key);
    setToast(null);
    const baseline = maxEventId(detail);
    try {
      await fn();
      setToast({ kind: 'ok', msg: okMsg });
      await refresh();
      onJobChanged();
      if (opts?.live) {
        setLiveBaseline(baseline);
        setLive(true);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setToast({
          kind: 'err',
          msg: 'Blocked by approval gate: this job must be Approved before it can be submitted.',
        });
      } else {
        setToast({ kind: 'err', msg: e instanceof Error ? e.message : 'Action failed' });
      }
    } finally {
      setBusy(null);
    }
  };

  const job = detail?.job ?? null;
  const answers = detail?.answers ?? [];
  const hasAnswers = answers.length > 0;
  const isApproved = job?.stage === 'approved';
  const isApplied =
    !!job && ['applied', 'responded', 'interview', 'offer'].includes(job.stage);
  const stageMeta = job ? STAGE_META[job.stage] : null;
  // A tailored CV with an honest-gap term must be acknowledged before Approve.
  const hardFlagged = !!verify && verify.findings.some((f) => f.hardFlags.length > 0);

  // Stepper: Generate → Review → Approve → Submit. currentStep = next action.
  const currentStep = !job ? 0 : !hasAnswers ? 0 : isApplied ? 4 : isApproved ? 3 : 1;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <style>{DRAWER_CSS}</style>
      <div
        className="falkyr-scrim absolute inset-0 bg-ink-950/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Job details"
        className="falkyr-drawer relative flex h-full w-full flex-col bg-ink-900 text-[#EDEFF4] outline-none md:max-w-xl md:border-l md:border-ink-800 md:shadow-2xl md:shadow-black/40"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-ink-800 px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] md:pt-4">
          <div className="min-w-0">
            {loading ? (
              <div className="h-6 w-48 animate-pulse rounded bg-ink-800" />
            ) : job ? (
              <>
                <h2 className="truncate font-display text-lg font-semibold tracking-[-0.01em] text-[#EDEFF4]">
                  {job.role ?? 'Untitled role'}
                </h2>
                <p className="truncate text-sm text-[#A7AFC2]">
                  {job.company ?? 'Unknown company'}
                  {job.location ? ` · ${job.location}` : ''}
                </p>
              </>
            ) : (
              <h2 className="font-display text-lg font-semibold text-[#EDEFF4]">Job</h2>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-my-1 rounded-lg p-2.5 text-[#6B7488] transition-colors duration-150 hover:bg-ink-850 hover:text-[#EDEFF4]"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Meta row */}
        {job && stageMeta && (
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 px-5 py-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-850 px-2.5 py-0.5 text-[11px] font-medium text-[#A7AFC2] ring-1 ring-ink-800">
              <span className={`h-1.5 w-1.5 rounded-full ${stageMeta.headerAccent}`} aria-hidden />
              {stageMeta.label}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-850 px-2.5 py-0.5 text-[11px] font-medium text-[#A7AFC2] ring-1 ring-ink-800">
              <span className={`h-1.5 w-1.5 rounded-full ${fitDotClass(job.fit_score)}`} aria-hidden />
              Fit <span className="font-mono tabular-nums text-[#EDEFF4]">{formatFitScore(job.fit_score)}</span>
            </span>
            {job.remote && (
              <span className="rounded bg-ink-850 px-2 py-0.5 text-[11px] text-[#A7AFC2] ring-1 ring-ink-800">{job.remote}</span>
            )}
            {job.ats_provider && (
              <span className="rounded bg-ink-850 px-2 py-0.5 font-mono text-[11px] text-[#A7AFC2] ring-1 ring-ink-800">{job.ats_provider}</span>
            )}
            {job.url && (
              <a
                href={job.url}
                target="_blank"
                rel="noreferrer noopener"
                className="ml-auto text-xs font-medium text-[#A7AFC2] underline decoration-ink-700 underline-offset-2 transition-colors duration-150 hover:text-[#EDEFF4] hover:decoration-[#6B7488]"
              >
                Open posting ↗
              </a>
            )}
          </div>
        )}

        {/* Stepper */}
        {job && <Stepper current={currentStep} onStepClick={scrollToStep} />}

        {/* Body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {loading ? (
            <div className="space-y-3">
              <div className="h-4 w-full animate-pulse rounded bg-ink-800" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-ink-800" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-ink-800" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-[#E5484D]/30 bg-[#E5484D]/[0.06] p-4 text-sm text-rose-200">
              <p className="font-medium">Couldn’t load this job.</p>
              <p className="mt-1 text-rose-200/80">{error}</p>
              <button
                onClick={() => void load()}
                className="mt-3 rounded-md bg-[#E5484D] px-3 py-1.5 text-xs font-semibold text-ink-950 transition-colors duration-150 hover:bg-[#EC5B60]"
              >
                Retry
              </button>
            </div>
          ) : detail ? (
            <DrawerContent detail={detail} live={live} verify={verify} onRewriteQueued={startLivePolling} />
          ) : null}
        </div>

        {toast && (
          <div
            className={[
              'mx-5 mb-2 rounded-md px-3 py-2 text-sm',
              toast.kind === 'ok'
                ? 'bg-[#34C08B]/10 text-emerald-200 ring-1 ring-[#34C08B]/30'
                : 'bg-[#E5484D]/10 text-rose-200 ring-1 ring-[#E5484D]/30',
            ].join(' ')}
            role="status"
          >
            {toast.msg}
          </div>
        )}

        {/* SAFETY NOTE: this action bar never weakens the submit gate. Submit
            renders only for Approved jobs AND stays disabled unless isApproved
            (defense-in-depth); the server independently 409s a submit on any
            non-approved job and still requires JOBPILOT_ALLOW_SUBMIT. Autofill
            is always mode='fill' — it stops at the submit button. */}
        <div className="sticky bottom-0 z-10 border-t border-transparent bg-ink-950/80 px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4 shadow-[0_-8px_32px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          <div className="flex flex-col gap-3">
            <div className="flex w-full items-center gap-2">
              <div className="min-w-0 flex-1">
                {currentStep === 0 && (
                  <ActionButton
                    label="1. Generate Materials"
                    title="Generate tailored form answers, cover letter, and CV for this job"
                    variant="primary"
                    busy={busy === 'generate'}
                    disabled={busy !== null || !job || live}
                    onClick={() =>
                      runAction('generate', () => api.generate(jobId), 'Generation started.', { live: true })
                    }
                  />
                )}
                {currentStep === 1 && (
                  <div className="flex flex-col gap-2">
                    <ActionButton
                      label="2. Approve Job"
                      title="Green-light this job for submission (sets stage to Approved)"
                      variant="primary"
                      busy={busy === 'approve'}
                      disabled={busy !== null || !job || isApproved || !hasAnswers || (hardFlagged && !verifyAck)}
                      onClick={() => runAction('approve', () => api.approve(jobId), 'Job approved.')}
                    />
                    {/* Fill is safe at any stage (never submits) — keep it available
                        BEFORE approval so the human can eyeball the filled form first. */}
                    <ActionButton
                      label="Autofill Form (stop before submit)"
                      title="Fill the application form and STOP at the submit button — review before approving"
                      variant="neutral"
                      busy={busy === 'fill'}
                      disabled={busy !== null || !job || live}
                      onClick={() =>
                        runAction('fill', () => api.apply(jobId, 'fill'), 'Autofill started.', { live: true })
                      }
                    />
                  </div>
                )}
                {currentStep === 3 && (
                  <div className="flex flex-col gap-2">
                    <ActionButton
                      label="4. Submit Application"
                      title="Submit the application (enabled only for Approved jobs)"
                      variant="primary"
                      busy={busy === 'submit'}
                      disabled={busy !== null || !job || !isApproved || live}
                      onClick={() =>
                        runAction('submit', () => api.apply(jobId, 'submit'), 'Submission started.', { live: true })
                      }
                    />
                    <ActionButton
                      label="Autofill Form (stop before submit)"
                      title="Fill the application form and STOP at the submit button"
                      variant="neutral"
                      busy={busy === 'fill'}
                      disabled={busy !== null || !job || live}
                      onClick={() =>
                        runAction('fill', () => api.apply(jobId, 'fill'), 'Autofill started.', { live: true })
                      }
                    />
                  </div>
                )}
                {currentStep === 4 && (
                  <div className="w-full py-2 text-center text-sm font-medium text-[#34C08B]">
                    ✓ Application submitted
                  </div>
                )}
              </div>

              {job && currentStep !== 4 && (
                <div ref={moreRef} className="relative shrink-0 self-start">
                  <button
                    type="button"
                    aria-label="More actions"
                    aria-expanded={moreOpen}
                    aria-haspopup="menu"
                    disabled={busy !== null || live}
                    onClick={() => setMoreOpen((v) => !v)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-850 text-[#A7AFC2] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors hover:bg-ink-800 hover:text-[#EDEFF4] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                      <circle cx="9" cy="4.5" r="1.25" fill="currentColor" />
                      <circle cx="9" cy="9" r="1.25" fill="currentColor" />
                      <circle cx="9" cy="13.5" r="1.25" fill="currentColor" />
                    </svg>
                  </button>
                  {moreOpen && (
                    <div
                      role="menu"
                      className="absolute bottom-full right-0 z-20 mb-2 min-w-[11rem] rounded-xl border border-transparent elevate-2 py-1 shadow-2xl"
                    >
                      {(
                        [
                          ['skipped', 'Skip this job'],
                          ['rejected', 'Mark rejected'],
                          ['applied', 'Mark applied'],
                        ] as const
                      ).map(([stage, label]) => (
                        <button
                          key={stage}
                          type="button"
                          role="menuitem"
                          disabled={busy !== null}
                          onClick={() => {
                            setMoreOpen(false);
                            void runAction('stage', () => api.setStage(jobId, stage), `Marked ${stage}.`);
                          }}
                          className="block w-full px-3 py-2 text-left text-sm text-[#A7AFC2] transition-colors hover:bg-ink-850 hover:text-[#EDEFF4] disabled:opacity-40"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {hardFlagged && !isApproved && (
              <label className="flex items-start gap-2 rounded-md bg-[#E5484D]/10 px-2.5 py-1.5 text-xs text-rose-200 ring-1 ring-[#E5484D]/30">
                <input
                  type="checkbox"
                  checked={verifyAck}
                  onChange={(e) => setVerifyAck(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[#E5484D]"
                />
                <span>
                  The verifier flagged an honest-gap term in the tailored CV. I reviewed the flagged
                  lines and confirm they're accurate before approving.
                </span>
              </label>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Horizontal Generate → Review → Approve → Submit progress indicator. */
function Stepper({ current, onStepClick }: { current: number; onStepClick?: (step: number) => void }) {
  const steps = ['Generate', 'Review', 'Approve', 'Submit'];
  return (
    <div className="flex items-center gap-1 border-b border-transparent px-5 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        const clickable = !!onStepClick;
        return (
          <div key={label} className="flex flex-1 items-center gap-1.5">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onStepClick?.(i)}
              title={clickable ? `Jump to ${label}` : undefined}
              className={[
                'flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-0.5 py-0.5 text-left transition-colors',
                clickable ? 'hover:bg-ink-850/60' : 'cursor-default',
              ].join(' ')}
            >
              <span
                className={[
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                  state === 'done'
                    ? 'bg-ink-700 text-[#EDEFF4]'
                    : state === 'active'
                      ? 'bg-[#EDEFF4] text-ink-950'
                      : 'bg-ink-850 text-[#6B7488] ring-1 ring-ink-700',
                ].join(' ')}
              >
                {state === 'done' ? '✓' : i + 1}
              </span>
              <span
                className={[
                  'truncate text-xs font-medium',
                  state === 'active' ? 'text-[#EDEFF4]' : state === 'done' ? 'text-[#A7AFC2]' : 'text-[#6B7488]',
                ].join(' ')}
              >
                {label}
              </span>
            </button>
            {i < steps.length - 1 && (
              <span className={`ml-1 h-px w-2 shrink-0 ${i < current ? 'bg-ink-700' : 'bg-ink-800'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DrawerContent({
  detail,
  live,
  verify,
  onRewriteQueued,
}: {
  detail: JobDetail;
  live: boolean;
  verify: GroundingReport | null;
  onRewriteQueued: () => void;
}) {
  const { job, answers, events } = detail;
  const form = answers.filter((a) => a.kind === 'form');
  const cover = answers.filter((a) => a.kind === 'cover');
  const cv = answers.filter((a) => a.kind === 'cv');

  return (
    <div className="divide-y divide-transparent [&>section]:shadow-[0_1px_0_rgba(255,255,255,0.04)]">
      <Section id="drawer-step-generate" title="Non-rejection strategy">
        <StrategyPanel
          jobId={job.id}
          refreshKey={answers.reduce((m, a) => Math.max(m, a.id), 0)}
          onQueued={onRewriteQueued}
        />
      </Section>

      <Section title="JD summary">
        {job.jd_text ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#A7AFC2]">
            {truncate(job.jd_text, 1200)}
          </p>
        ) : (
          <Empty>No job description captured yet.</Empty>
        )}
      </Section>

      {/* The one falconry moment in the drawer: the tailored application is
          back on the glove-side of the gate, waiting for the human. */}
      {job.stage === 'ready' && (
        <div className="flex items-center justify-between gap-3 py-5">
          <div>
            <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-[#EDEFF4]">
              Returned to hand
            </h3>
            <p className="mt-0.5 text-xs text-[#6B7488]">review before release</p>
          </div>
          <FalkyrMark size={22} className="shrink-0 text-ink-700" />
        </div>
      )}

      <Section id="drawer-step-review" title="Form answers" count={form.length}>
        {form.length === 0 ? (
          <Empty>No form answers yet — run Generate.</Empty>
        ) : (
          <ul className="space-y-3">
            {form.map((a) => (
              <li key={a.id} className="rounded-lg border border-transparent elevate-1 p-3">
                {a.question && <p className="text-xs font-medium text-[#6B7488]">{a.question}</p>}
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[#EDEFF4]">{a.answer ?? ''}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Cover letter" count={cover.length}>
        {cover.length === 0 ? <Empty>No cover letter generated yet.</Empty> : <AnswerBlocks items={cover} />}
      </Section>

      <Section id="drawer-step-approve" title="Tailored CV" count={cv.length}>
        {cv.length === 0 ? (
          <Empty>No CV generated yet.</Empty>
        ) : (
          <>
            <VerifyChip report={verify} />
            <AnswerBlocks items={cv} />
          </>
        )}
      </Section>

      <section id="drawer-step-submit" className="scroll-mt-4 py-5 first:pt-0 last:pb-0">
        <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A7AFC2]">
          Live activity
          <span className="rounded-full bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] font-medium normal-case tracking-normal text-[#6B7488] ring-1 ring-ink-800">
            {events.length}
          </span>
          {live && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-ink-850 px-2 py-0.5 font-mono text-[10px] font-medium text-[#34C08B] ring-1 ring-ink-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34C08B]" />
              Live
            </span>
          )}
        </h3>
        {events.length === 0 ? (
          <Empty>No activity yet. Actions stream here field-by-field.</Empty>
        ) : (
          <ul className="space-y-1.5">
            {events
              .slice()
              .reverse()
              .map((ev, idx) => (
                <li
                  key={ev.id}
                  className={[
                    'flex items-baseline gap-2 rounded px-1.5 py-1 text-xs',
                    idx === 0 && live ? 'bg-ink-850' : '',
                  ].join(' ')}
                >
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-medium ${eventTypeClasses(ev.type)}`}>
                    {ev.type ?? 'event'}
                  </span>
                  {ev.detail && <span className="text-[#A7AFC2]">{ev.detail}</span>}
                  <span className="ml-auto shrink-0 tabular-nums text-[11px] text-[#6B7488]">{formatWhen(ev.created_at)}</span>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Color the event-type chip by semantics (green/amber/red on dark washes). */
function eventTypeClasses(type: string | null): string {
  const t = type ?? '';
  if (/verify\.clean/.test(t)) return 'bg-[#34C08B]/10 text-[#34C08B]';
  if (/verify\.flagged|paused/.test(t)) return 'bg-[#E8A33D]/10 text-[#E8A33D]';
  if (/blocked|error|refused/.test(t)) return 'bg-[#E5484D]/10 text-rose-300';
  if (/submitted|done/.test(t)) return 'bg-[#34C08B]/10 text-[#34C08B]';
  if (/field|filled|nav|cv/.test(t)) return 'bg-ink-800 text-[#A7AFC2]';
  if (/stopped/.test(t)) return 'bg-[#E8A33D]/10 text-[#E8A33D]';
  return 'bg-ink-850 text-[#6B7488]';
}

/** Fit-score tier dot — same thresholds as the board's fitScoreClasses. */
function fitDotClass(score: number | null): string {
  if (score == null) return 'bg-ink-700';
  const pct = score <= 1 ? score * 100 : score;
  if (pct >= 80) return 'bg-[#34C08B]';
  if (pct >= 60) return 'bg-lime-400';
  if (pct >= 40) return 'bg-[#E8A33D]';
  return 'bg-[#E5484D]';
}

/** The non-fabrication verdict for the tailored CV — the trust moat made visible. */
function VerifyChip({ report }: { report: GroundingReport | null }) {
  if (!report) return null;
  const hard = report.findings.some((f) => f.hardFlags.length > 0);
  const tone = report.clean
    ? { box: 'bg-[#34C08B]/[0.06] ring-[#34C08B]/25', head: 'text-[#34C08B]', label: 'Grounding verified' }
    : hard
      ? { box: 'bg-[#E5484D]/[0.06] ring-[#E5484D]/25', head: 'text-rose-300', label: 'Fabrication risk' }
      : { box: 'bg-[#E8A33D]/[0.06] ring-[#E8A33D]/25', head: 'text-[#E8A33D]', label: 'Review flagged lines' };
  return (
    <div className={`mb-3 rounded-lg px-3 py-2.5 text-xs ring-1 ${tone.box}`}>
      <p className="text-[#A7AFC2]">
        <span className={`font-semibold ${tone.head}`}>{tone.label}</span>
        {' — '}
        {report.summary}
      </p>
      {report.findings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {report.findings.slice(0, 8).map((f, i) => (
            <li key={i} className="flex items-baseline gap-1.5 font-mono text-[11px] leading-snug text-[#A7AFC2]">
              <span
                className={`inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full ${
                  f.hardFlags.length ? 'bg-[#E5484D]' : 'bg-[#E8A33D]'
                }`}
                aria-hidden
              />
              <span>
                {f.line.slice(0, 90)}
                {f.hardFlags.length
                  ? ` — honest-gap: ${f.hardFlags.join(', ')}`
                  : f.unmatchedNumbers.length
                    ? ` — numbers not in your sources: ${f.unmatchedNumbers.join(', ')}`
                    : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[10px] text-[#6B7488]">
        Deterministic advisory tripwire — a human confirms before sending, not a proof.
      </p>
    </div>
  );
}

function AnswerBlocks({ items }: { items: Answer[] }) {
  return (
    <div className="space-y-3">
      {items.map((a) => (
        <div key={a.id} className="rounded-lg border border-transparent elevate-1 p-3">
          {a.question && <p className="mb-1 text-xs font-medium text-[#6B7488]">{a.question}</p>}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#EDEFF4]">{a.answer ?? ''}</p>
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  count,
  id,
  children,
}: {
  title: string;
  count?: number;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 py-5 first:pt-0 last:pb-0">
      <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A7AFC2]">
        {title}
        {typeof count === 'number' && (
          <span className="rounded-full bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] font-medium normal-case tracking-normal text-[#6B7488] ring-1 ring-ink-800">
            {count}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[#6B7488]">{children}</p>;
}

interface ActionButtonProps {
  label: string;
  title: string;
  variant: 'neutral' | 'primary' | 'submit';
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}

function ActionButton({ label, title, variant, busy, disabled, onClick }: ActionButtonProps) {
  const base =
    'inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm transition-[transform,background-color] duration-150 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0';
  const variants: Record<ActionButtonProps['variant'], string> = {
    neutral:
      'bg-ink-850 font-medium text-[#A7AFC2] border border-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] enabled:hover:bg-ink-800 enabled:hover:text-[#EDEFF4] disabled:opacity-40',
    primary:
      'bg-gold-400 font-semibold text-ink-950 shadow-[0_4px_12px_rgba(232,163,61,0.25)] enabled:hover:bg-gold-300 disabled:bg-ink-850 disabled:text-[#6B7488] disabled:shadow-none',
    submit:
      'bg-[#E5484D] font-semibold text-ink-950 shadow-[0_4px_12px_rgba(229,72,77,0.25)] enabled:hover:bg-[#EC5B60] disabled:bg-ink-850 disabled:text-[#6B7488] disabled:shadow-none',
  };
  return (
    <button
      type="button"
      title={title || undefined}
      onClick={onClick}
      disabled={disabled || busy}
      aria-disabled={disabled || busy}
      className={`${base} ${variants[variant]}`}
    >
      {busy && (
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
          <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
        </svg>
      )}
      {label}
    </button>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + '…';
}

function formatWhen(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
