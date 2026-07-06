import type { Job } from '../types.js';
import { fitScoreClasses, formatFitScore } from '../stageMeta.js';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400';

interface JobCardProps {
  job: Job;
  /** Whether bulk-select mode is active (shows checkbox affordance). */
  selectable: boolean;
  /** Whether this card is currently selected in bulk mode. */
  selected: boolean;
  /** Toggle selection (only meaningful when selectable). */
  onToggleSelect: (id: number) => void;
  /** Open the detail drawer for this job. */
  onOpen: (id: number) => void;
  /** Mark this job skipped (dismiss from the board column). */
  onDismiss?: (id: number) => void;
}

function formatPostedDate(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function JobCard({
  job,
  selectable,
  selected,
  onToggleSelect,
  onOpen,
  onDismiss,
}: JobCardProps) {
  const posted = formatPostedDate(job.created_at);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(job.id)}
      onKeyDown={(e) => {
        // Only act on keys aimed at the card itself, not the checkbox inside it.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(job.id);
        }
      }}
      className={[
        'group relative cursor-pointer rounded-xl p-3',
        'transition-[transform,background-color,box-shadow,border-color] duration-[120ms] ease-settle',
        'hover:-translate-y-0.5 hover:elevate-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        FOCUS_RING,
        selected
          ? 'border border-gold-400/60 bg-gold-400/10'
          : 'border border-transparent elevate-1',
      ].join(' ')}
    >
      {onDismiss && (
        <button
          type="button"
          title="Skip this job"
          aria-label={`Skip ${job.company ?? 'job'} ${job.role ?? ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(job.id);
          }}
          className={[
            'absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-lg',
            'text-[#6B7488] opacity-0 transition-[opacity,background-color,color] duration-150',
            'group-hover:opacity-100 group-focus-within:opacity-100',
            'hover:bg-ink-850 hover:text-[#EDEFF4]',
            FOCUS_RING,
          ].join(' ')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}

      <div className="flex items-start gap-2">
        {selectable && (
          <label
            className="-my-2 -ml-2 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected}
              aria-label={`Select ${job.company ?? 'job'} ${job.role ?? ''}`}
              onChange={() => onToggleSelect(job.id)}
              className={`h-[18px] w-[18px] cursor-pointer rounded border-ink-700 bg-ink-850 accent-gold-400 ${FOCUS_RING}`}
            />
          </label>
        )}

        <div className="min-w-0 flex-1 pr-4">
          <div className="truncate text-xs text-[#A7AFC2]">{job.company ?? 'Unknown company'}</div>
          <div className="mt-0.5 truncate text-sm font-semibold text-[#EDEFF4]">
            {job.role ?? 'Untitled role'}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[#6B7488]">
            {job.location && <span className="truncate">{job.location}</span>}
            {job.remote && (
              <span className="rounded bg-ink-850 px-1.5 py-0.5 text-[#A7AFC2] ring-1 ring-ink-800">
                {job.remote}
              </span>
            )}
            {posted && (
              <span className="rounded bg-ink-850/80 px-1.5 py-0.5 tabular-nums">{posted}</span>
            )}
            <span
              title={`Fit score${job.fit_score == null ? ' unavailable' : ''}`}
              className={[
                'ml-auto rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                fitScoreClasses(job.fit_score),
              ].join(' ')}
            >
              {formatFitScore(job.fit_score)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
