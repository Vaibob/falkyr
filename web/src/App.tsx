import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Job, Stage } from './types.js';
import { STAGES } from './types.js';
import { api } from './api.js';
import Column from './components/Column.js';
import JobCard from './components/JobCard.js';
import JobDrawer from './components/JobDrawer.js';
import BulkToolbar from './components/BulkToolbar.js';
import { FalkyrMark } from './components/brand/FalkyrMark.js';
import { FalkyrCompanion } from './components/brand/FalkyrCompanion.js';
import { AuthControls } from './auth.js';
import { STAGE_META } from './stageMeta.js';

/** Stages surfaced as at-a-glance counts in the summary bar. */
const SUMMARY_STAGES: Stage[] = ['discovered', 'evaluated', 'drafted', 'ready', 'approved', 'applied', 'interview', 'offer'];

/** Shared gold focus ring — visible :focus-visible on every interactive element. */
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400';

/**
 * The Perch — Falkyr's board.
 *
 * SAFETY NOTE: This UI never bypasses the per-job approval gate.
 * - The card "Submit" button is disabled unless the job is in the 'approved' stage.
 * - "Approve selected" loops individual POST /approve calls; it does NOT submit and
 *   does NOT touch any un-approved job's submit path. Submission is still per-job,
 *   manual, and server-gated (the API 409s a submit on a non-approved job).
 */
export default function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openJobId, setOpenJobId] = useState<number | null>(null);

  // Bulk-select state (only 'ready' cards are selectable, matching the workflow gate).
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [approving, setApproving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [scanning, setScanning] = useState(false);

  // Mobile (<768px) view: one stage at a time via tabs. Presentation-only state;
  // null means "not chosen yet" and falls back to the first stage with jobs.
  const [activeTab, setActiveTab] = useState<Stage | null>(null);

  const loadJobs = useCallback(async () => {
    setError(null);
    try {
      const all = await api.listJobs();
      setJobs(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  // Auto-dismiss banner.
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(t);
  }, [banner]);

  // Group jobs by stage for the columns.
  const jobsByStage = useMemo(() => {
    const map = new Map<Stage, Job[]>();
    for (const s of STAGES) map.set(s, []);
    for (const job of jobs) {
      const bucket = map.get(job.stage);
      if (bucket) bucket.push(job);
      else map.set(job.stage, [job]); // tolerate unknown stages defensively
    }
    // Sort each bucket by fit_score desc (nulls last) so best matches float up.
    for (const bucket of map.values()) {
      bucket.sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1));
    }
    return map;
  }, [jobs]);

  const readyJobs = useMemo(() => jobs.filter((j) => j.stage === 'ready'), [jobs]);
  const readyCount = readyJobs.length;

  // Mobile tab default: the first stage that actually has jobs.
  const firstStageWithJobs = useMemo(
    () => STAGES.find((s) => (jobsByStage.get(s) ?? []).length > 0) ?? STAGES[0],
    [jobsByStage],
  );
  const mobileStage: Stage = activeTab ?? firstStageWithJobs;
  const mobileJobs = jobsByStage.get(mobileStage) ?? [];

  // Presentation only: entering bulk mode surfaces the Ready stage on mobile tabs,
  // since only 'ready' cards are selectable.
  useEffect(() => {
    if (bulkMode) setActiveTab('ready');
  }, [bulkMode]);

  // Keep the selection valid: drop ids that are no longer 'ready' (e.g. after approve/refresh).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const readyIds = new Set(readyJobs.map((j) => j.id));
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (readyIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [readyJobs]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllReady = useCallback(() => {
    setSelectedIds(new Set(readyJobs.map((j) => j.id)));
  }, [readyJobs]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const toggleBulkMode = useCallback(() => {
    setBulkMode((on) => {
      if (on) setSelectedIds(new Set()); // clear when leaving bulk mode
      return !on;
    });
  }, []);

  // "Approve selected": loop per-job POST /approve. Never submits.
  const approveSelected = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setApproving(true);
    setBanner(null);
    setProgress({ done: 0, total: ids.length });

    let ok = 0;
    const failures: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      try {
        await api.approve(ids[i]);
        ok++;
      } catch {
        failures.push(ids[i]);
      }
      setProgress({ done: i + 1, total: ids.length });
    }

    await loadJobs();
    setApproving(false);
    setProgress(null);
    setSelectedIds(new Set());

    if (failures.length === 0) {
      setBanner({ kind: 'ok', msg: `Approved ${ok} job${ok === 1 ? '' : 's'}.` });
    } else {
      setBanner({
        kind: 'err',
        msg: `Approved ${ok}, but ${failures.length} failed (ids: ${failures.join(', ')}).`,
      });
    }
  }, [selectedIds, loadJobs]);

  // Run the multi-source scan (POST /api/scan, ~30s) and reload the board.
  const runScan = useCallback(async () => {
    setScanning(true);
    setBanner(null);
    try {
      const r = await api.scan();
      setBanner({
        kind: 'ok',
        msg: `Scan complete — ${r.totalKept} relevant kept, ${r.upserted} upserted, ${r.totalJobs} total.`,
      });
      await loadJobs();
    } catch (e) {
      setBanner({ kind: 'err', msg: e instanceof Error ? e.message : 'Scan failed' });
    } finally {
      setScanning(false);
    }
  }, [loadJobs]);

  return (
    <div className="flex h-screen flex-col bg-ink-950 text-[#EDEFF4]">
      {/* Top bar */}
      <header className="flex items-center gap-2 border-b border-ink-700 bg-ink-950 px-3 py-3 text-[#EDEFF4] sm:gap-3 sm:px-5">
        <div className="flex items-baseline gap-3">
          <h1 className="leading-none">
            {/* The living Falkyr — the eye tracks the cursor; it pulses while a
                scan is on the wing. Wordmark hides on narrow screens. */}
            <span className="inline-flex items-center gap-2">
              <FalkyrCompanion size={26} hunting={scanning} />
              <span
                className="hidden font-display font-semibold sm:inline"
                style={{ fontSize: 20, letterSpacing: '-0.02em' }}
              >
                falkyr
              </span>
            </span>
          </h1>
          <p className="hidden text-[11px] font-medium text-[#6B7488] md:block">the Perch</p>
        </div>
        <span className="ml-1 whitespace-nowrap rounded-full bg-ink-850 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[#A7AFC2] ring-1 ring-ink-700">
          {jobs.length} job{jobs.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={() => void runScan()}
          disabled={scanning}
          className={`ml-auto rounded-md bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition hover:bg-gold-300 disabled:opacity-60 ${FOCUS_RING}`}
          title="Scan all configured sources for new jobs (LinkedIn/Indeed never scanned)"
        >
          {scanning ? 'Scanning…' : 'Scan'}
        </button>
        <button
          onClick={() => void loadJobs()}
          className={`rounded-md px-3 py-1.5 text-sm font-medium text-[#A7AFC2] ring-1 ring-ink-700 transition hover:bg-ink-850 hover:text-[#EDEFF4] ${FOCUS_RING}`}
          title="Refresh from the server"
        >
          Refresh
        </button>
        <a
          href="/trust"
          className={`rounded-md px-2.5 py-1.5 text-sm font-medium text-[#A7AFC2] transition hover:bg-ink-850 hover:text-[#EDEFF4] ${FOCUS_RING}`}
          title="Trust & Safety — the guarantees, and where to verify them in the code"
        >
          Trust
        </a>
        {/* Clerk user button — renders nothing in local (key-less) mode. */}
        <AuthControls />
      </header>

      {/* At-a-glance stage summary — desktop only; the mobile stage tabs
          already carry the same labels + counts (no duplicate navigation). */}
      {!loading && !error && jobs.length > 0 && (
        <div className="hidden flex-wrap items-center gap-2 border-b border-ink-800 bg-ink-950 px-5 py-2.5 md:flex">
          {SUMMARY_STAGES.map((s) => {
            const n = (jobsByStage.get(s) ?? []).length;
            const m = STAGE_META[s];
            return (
              <span
                key={s}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink-800 bg-ink-900 px-2.5 py-1 text-xs font-medium text-[#A7AFC2]"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${m.headerAccent}`} aria-hidden />
                {m.label}
                <span className="font-semibold tabular-nums text-[#EDEFF4]">{n}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Bulk toolbar */}
      <div className="border-b border-ink-800 bg-ink-950 px-5 py-2">
        <BulkToolbar
          active={bulkMode}
          onToggleActive={toggleBulkMode}
          selectedCount={selectedIds.size}
          readyCount={readyCount}
          onSelectAllReady={selectAllReady}
          onClearSelection={clearSelection}
          onApproveSelected={() => void approveSelected()}
          approving={approving}
          progress={progress}
        />
        {banner && (
          <div
            role="status"
            className={[
              'mt-2 rounded-md px-3 py-2 text-sm',
              banner.kind === 'ok'
                ? 'bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/25'
                : 'bg-red-400/10 text-red-300 ring-1 ring-red-400/25',
            ].join(' ')}
          >
            {banner.msg}
          </div>
        )}
      </div>

      {/* Board */}
      <main className="flex-1 overflow-hidden">
        {loading ? (
          <div className="h-full overflow-hidden" role="status" aria-label="Loading the board">
            {/* Desktop skeleton columns */}
            <div className="hidden h-full gap-3 px-5 py-4 md:flex">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-ink-900/40 p-2">
                  <div className="mx-1 mt-1 h-4 w-24 animate-pulse rounded bg-ink-850 motion-reduce:animate-none" />
                  <div className="h-20 animate-pulse rounded-lg bg-ink-900 motion-reduce:animate-none" />
                  <div className="h-20 animate-pulse rounded-lg bg-ink-900 motion-reduce:animate-none" />
                  <div className="h-20 animate-pulse rounded-lg bg-ink-900 motion-reduce:animate-none" />
                </div>
              ))}
            </div>
            {/* Mobile skeleton list */}
            <div className="flex flex-col gap-2 px-4 py-3 md:hidden">
              <div className="h-9 animate-pulse rounded bg-ink-900 motion-reduce:animate-none" />
              <div className="h-20 animate-pulse rounded-lg bg-ink-900 motion-reduce:animate-none" />
              <div className="h-20 animate-pulse rounded-lg bg-ink-900 motion-reduce:animate-none" />
              <div className="h-20 animate-pulse rounded-lg bg-ink-900 motion-reduce:animate-none" />
            </div>
            <span className="sr-only">Loading the board…</span>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="max-w-md rounded-xl border border-ink-700 bg-ink-900 p-6 text-center">
              <p className="font-semibold text-[#EDEFF4]">Couldn’t reach the local server.</p>
              <p className="mt-1 text-sm text-red-300">{error}</p>
              <p className="mt-2 text-xs text-[#6B7488]">
                Is the server running on port 3001? Try{' '}
                <code className="rounded bg-ink-850 px-1 py-0.5 text-[#A7AFC2]">npm run server</code>.
              </p>
              <button
                onClick={() => void loadJobs()}
                className={`mt-4 rounded-md bg-ink-850 px-4 py-2 text-sm font-medium text-[#EDEFF4] ring-1 ring-ink-700 transition hover:bg-ink-800 ${FOCUS_RING}`}
              >
                Retry
              </button>
            </div>
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="max-w-md rounded-xl border border-ink-800 bg-ink-900 p-8 text-center">
              <FalkyrMark size={40} className="mx-auto text-ink-700" />
              <p className="mt-4 font-display text-lg font-semibold text-[#EDEFF4]">
                Nothing on the wing yet.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[#A7AFC2]">
                Run your first scan across Greenhouse, Lever, Ashby, Workable and the remote
                boards. LinkedIn and Indeed are never touched.
              </p>
              <button
                onClick={() => void runScan()}
                disabled={scanning}
                className={`mt-5 rounded-md bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-gold-300 disabled:opacity-60 ${FOCUS_RING}`}
              >
                {scanning ? 'Scanning…' : 'Run your first scan'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop (md+): Kanban columns */}
            <div className="hidden h-full gap-3 overflow-x-auto px-5 py-4 md:flex">
              {STAGES.map((stage) => (
                <Column
                  key={stage}
                  stage={stage}
                  jobs={jobsByStage.get(stage) ?? []}
                  // Only 'ready' cards participate in bulk selection.
                  selectable={bulkMode && stage === 'ready'}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onOpen={setOpenJobId}
                />
              ))}
            </div>

            {/* Mobile (<md): stage tabs + vertical card list */}
            <div className="flex h-full flex-col md:hidden">
              <div
                role="tablist"
                aria-label="Stages"
                className="flex shrink-0 gap-1 overflow-x-auto border-b border-ink-800 px-2"
              >
                {STAGES.map((s) => {
                  const n = (jobsByStage.get(s) ?? []).length;
                  const isActive = s === mobileStage;
                  return (
                    <button
                      key={s}
                      id={`stage-tab-${s}`}
                      role="tab"
                      aria-selected={isActive}
                      aria-controls="stage-panel"
                      onClick={() => setActiveTab(s)}
                      className={[
                        'shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition',
                        FOCUS_RING,
                        isActive
                          ? 'border-gold-400 text-[#EDEFF4]'
                          : 'border-transparent text-[#6B7488] hover:text-[#A7AFC2]',
                      ].join(' ')}
                    >
                      {STAGE_META[s].label}{' '}
                      <span className="tabular-nums">{n}</span>
                    </button>
                  );
                })}
              </div>
              <div
                id="stage-panel"
                role="tabpanel"
                aria-labelledby={`stage-tab-${mobileStage}`}
                className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3"
              >
                {mobileJobs.length === 0 ? (
                  <p className="py-10 text-center text-sm text-[#6B7488]">
                    {mobileStage === 'discovered' ? 'No quarry marked yet.' : 'Nothing here.'}
                  </p>
                ) : (
                  mobileJobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      // Only 'ready' cards participate in bulk selection.
                      selectable={bulkMode && mobileStage === 'ready'}
                      selected={selectedIds.has(job.id)}
                      onToggleSelect={toggleSelect}
                      onOpen={setOpenJobId}
                    />
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* Local-first footer — the moat, stated plainly. */}
      <footer className="flex items-center gap-2 border-t border-ink-800 bg-ink-950 px-5 py-1.5 text-[11px] text-[#6B7488]">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-0.5 font-medium text-emerald-300 ring-1 ring-emerald-400/20">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
          Local mode — 0 documents uploaded
        </span>
        <span>Runs on your Claude, on your machine.</span>
        <a
          href="/trust"
          className={`ml-auto rounded font-medium text-gold-400 transition hover:text-gold-300 ${FOCUS_RING}`}
        >
          Trust &amp; Safety →
        </a>
      </footer>

      {/* Detail drawer */}
      {openJobId != null && (
        <JobDrawer
          jobId={openJobId}
          onClose={() => setOpenJobId(null)}
          onJobChanged={() => void loadJobs()}
        />
      )}
    </div>
  );
}
