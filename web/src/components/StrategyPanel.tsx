// Non-rejection strategy panel — rendered inside the JobDrawer on the Perch.
// Styled for the Falkyr dark ink palette (DESIGN.md §2): quiet ink surfaces,
// semantic green/amber/red washes for risk tiers, gold kept scarce (the
// drawer's action bar owns the accent).
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import type { RiskTier, RoutingSuggestion, StrategyReport } from '../types.js';

interface StrategyPanelProps {
  jobId: number;
  /** Bump to force a re-fetch (e.g. after a generation run completes). */
  refreshKey?: number;
  /** Called after an async rewrite is queued so the drawer can start polling. */
  onQueued?: () => void;
}

export default function StrategyPanel({ jobId, refreshKey, onQueued }: StrategyPanelProps) {
  const [report, setReport] = useState<StrategyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [rewriteMsg, setRewriteMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await api.strategy(jobId));
    } catch (e) {
      setReport(null);
      setError(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to load strategy',
      );
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!rewriteMsg) return;
    const t = setTimeout(() => setRewriteMsg(null), 6000);
    return () => clearTimeout(t);
  }, [rewriteMsg]);

  const onRewrite = async () => {
    setRewriting(true);
    setRewriteMsg(null);
    try {
      await api.rewrite(jobId);
      setRewriteMsg({
        kind: 'ok',
        text: 'Resume rewrite queued. Watch Live activity for completion.',
      });
      onQueued?.();
    } catch (e) {
      setRewriteMsg({
        kind: 'err',
        text: e instanceof Error ? e.message : 'Resume rewrite failed',
      });
    } finally {
      setRewriting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2 rounded-lg border border-transparent elevate-1 p-3">
        <div className="h-4 w-40 animate-pulse rounded bg-ink-800 motion-reduce:animate-none" />
        <div className="h-4 w-full animate-pulse rounded bg-ink-800 motion-reduce:animate-none" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-ink-800 motion-reduce:animate-none" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-[#E8A33D]/30 bg-[#E8A33D]/[0.06] p-3 text-sm text-[#E8A33D]">
        <p className="font-medium">Strategy unavailable.</p>
        <p className="mt-1 text-[#A7AFC2]">{error}</p>
        <button
          onClick={() => void load()}
          className="mt-2 rounded-md bg-ink-850 px-2.5 py-1 text-xs font-medium text-[#EDEFF4] ring-1 ring-ink-700 transition-colors duration-150 hover:bg-ink-800"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!report) {
    return <p className="text-sm text-[#6B7488]">No strategy computed for this job yet.</p>;
  }

  const { monoculture, routing, voice, decorrelation, summary } = report;

  return (
    <div className="space-y-4">
      {/* Summary + monoculture badge */}
      <div className="rounded-xl border border-transparent elevate-1 p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A7AFC2]">
            Monoculture risk
          </span>
          <RiskBadge tier={monoculture.tier} />
          {monoculture.vendor && (
            <span className="rounded bg-ink-850 px-2 py-0.5 font-mono text-[11px] font-medium text-[#A7AFC2] ring-1 ring-ink-800">
              {monoculture.vendor}
            </span>
          )}
        </div>
        <p className="text-sm leading-relaxed text-[#A7AFC2]">{monoculture.reason}</p>
        {summary && (
          <p className="mt-2 border-t border-ink-800 pt-2 text-sm leading-relaxed text-[#6B7488]">
            {summary}
          </p>
        )}
      </div>

      {/* Routing suggestions — route around the filter */}
      <SubSection title="Route around the filter" count={routing.length}>
        {routing.length === 0 ? (
          <Empty>No routing suggestions.</Empty>
        ) : (
          <ul className="space-y-2">
            {routing.map((r, i) => (
              <li key={`${r.channel}-${i}`} className="rounded-xl border border-transparent elevate-1 p-3.5">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${channelClasses(r.channel)}`}>
                    {channelLabel(r.channel)}
                  </span>
                  <span className="text-xs font-medium text-[#EDEFF4]">{r.action}</span>
                </div>
                {r.rationale && <p className="mt-1.5 text-xs leading-relaxed text-[#A7AFC2]">{r.rationale}</p>}
              </li>
            ))}
          </ul>
        )}
      </SubSection>

      {/* AI-detector / human-voice risk */}
      {voice && (
        <SubSection title="Human-voice risk (AI detectors)">
          <div className="rounded-xl border border-transparent elevate-1 p-4">
            <div className="mb-2 flex items-center gap-2">
              <RiskBadge tier={voice.tier} />
              <span className="text-xs font-medium text-[#A7AFC2]">
                Score{' '}
                <span className="font-semibold tabular-nums text-[#EDEFF4]">
                  {formatScore(voice.score)}
                </span>
              </span>
            </div>
            {voice.flags.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6B7488]">
                  Top flags
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {voice.flags.slice(0, 5).map((f, i) => (
                    <span
                      key={i}
                      className="rounded bg-[#E5484D]/10 px-2 py-0.5 text-[11px] font-medium text-rose-300 ring-1 ring-[#E5484D]/25"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {voice.suggestions.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6B7488]">
                  Suggestions
                </p>
                <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-[#A7AFC2]">
                  {voice.suggestions.slice(0, 5).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {voice.flags.length === 0 && voice.suggestions.length === 0 && (
              <Empty>Reads human — no detector flags.</Empty>
            )}
          </div>
        </SubSection>
      )}

      {/* De-correlation score + advice */}
      <SubSection title="De-correlation">
        <div className="rounded-xl border border-transparent elevate-1 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-[#A7AFC2]">Score</span>
            <span
              className={`rounded px-2 py-0.5 text-xs font-semibold tabular-nums ${decorrelationClasses(decorrelation.score)}`}
            >
              {formatScore(decorrelation.score)}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-[#A7AFC2]">{decorrelation.advice}</p>
          {decorrelation.similarTo.length > 0 && (
            <div className="mt-2 border-t border-ink-800 pt-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6B7488]">
                Correlated with
              </p>
              <ul className="space-y-1">
                {decorrelation.similarTo.slice(0, 5).map((s) => (
                  <li key={s.jobId} className="flex items-center gap-2 text-xs text-[#A7AFC2]">
                    <span className="truncate">{s.company ?? `Job #${s.jobId}`}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-[#6B7488]">
                      {formatScore(s.similarity)} similar
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={() => void onRewrite()}
            disabled={rewriting}
            aria-disabled={rewriting}
            className="mt-3 inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg bg-ink-850 px-3 py-2 text-sm font-medium text-[#A7AFC2] ring-1 ring-ink-700 transition-colors duration-150 enabled:hover:bg-ink-800 enabled:hover:text-[#EDEFF4] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {rewriting && (
              <svg className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
              </svg>
            )}
            Rewrite résumé (de-correlated)
          </button>

          {rewriteMsg && (
            <div
              className={[
                'mt-2 rounded-md px-2.5 py-1.5 text-xs',
                rewriteMsg.kind === 'ok'
                  ? 'bg-[#34C08B]/10 text-emerald-200 ring-1 ring-[#34C08B]/30'
                  : 'bg-[#E5484D]/10 text-rose-200 ring-1 ring-[#E5484D]/30',
              ].join(' ')}
              role="status"
            >
              {rewriteMsg.text}
            </div>
          )}
        </div>
      </SubSection>
    </div>
  );
}

/** Low/med/high pill — semantic green/amber/red washes on ink (DESIGN.md §2). */
function RiskBadge({ tier }: { tier: RiskTier }) {
  const cls: Record<RiskTier, string> = {
    low: 'bg-[#34C08B]/10 text-[#34C08B] ring-[#34C08B]/25',
    medium: 'bg-[#E8A33D]/10 text-[#E8A33D] ring-[#E8A33D]/25',
    high: 'bg-[#E5484D]/10 text-rose-300 ring-[#E5484D]/25',
  };
  const label: Record<RiskTier, string> = { low: 'Low', medium: 'Med', high: 'High' };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${cls[tier]}`}
    >
      {label[tier]}
    </span>
  );
}

function channelLabel(channel: RoutingSuggestion['channel']): string {
  switch (channel) {
    case 'portal':
      return 'Portal';
    case 'referral':
      return 'Referral';
    case 'hiring-manager':
      return 'Hiring manager';
    case 'smaller-company':
      return 'Smaller co.';
    default:
      return channel;
  }
}

function channelClasses(channel: RoutingSuggestion['channel']): string {
  switch (channel) {
    case 'referral':
      return 'bg-[#34C08B]/10 text-[#34C08B]';
    case 'hiring-manager':
      return 'bg-indigo-400/10 text-indigo-300';
    case 'smaller-company':
      return 'bg-sky-400/10 text-sky-300';
    case 'portal':
    default:
      return 'bg-ink-850 text-[#A7AFC2] ring-1 ring-ink-800';
  }
}

/** Color a de-correlation score: higher = more independent = better (green). */
function decorrelationClasses(score: number): string {
  const pct = score <= 1 ? score * 100 : score;
  if (pct >= 70) return 'bg-[#34C08B]/10 text-[#34C08B]';
  if (pct >= 40) return 'bg-[#E8A33D]/10 text-[#E8A33D]';
  return 'bg-[#E5484D]/10 text-rose-300';
}

/** Format a 0..1 or 0..100 score to a compact integer/percentage string. */
function formatScore(score: number): string {
  if (score == null || Number.isNaN(score)) return '—';
  const pct = score <= 1 ? score * 100 : score;
  return `${Math.round(pct)}`;
}

function SubSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A7AFC2]">
        {title}
        {typeof count === 'number' && (
          <span className="rounded-full bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] font-medium normal-case tracking-normal text-[#6B7488] ring-1 ring-ink-800">
            {count}
          </span>
        )}
      </h4>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[#6B7488]">{children}</p>;
}
