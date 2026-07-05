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
}

export default function JobCard({
  job,
  selectable,
  selected,
  onToggleSelect,
  onOpen,
}: JobCardProps) {
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
        'group relative cursor-pointer rounded-lg border p-3',
        'transition-[transform,border-color,background-color] duration-[120ms] ease-settle',
        'hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        FOCUS_RING,
        selected
          ? 'border-gold-400/60 bg-gold-400/10'
          : 'border-ink-800 bg-ink-900 hover:border-ink-700 hover:bg-ink-850',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        {selectable && (
          <label
            className="-my-2 -ml-2 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center"
            // Stop the click from bubbling to the card's onOpen handler
            // (covers the whole 40px touch target, not just the box).
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

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[#EDEFF4]">
                {job.role ?? 'Untitled role'}
              </div>
              <div className="truncate text-xs text-[#A7AFC2]">
                {job.company ?? 'Unknown company'}
              </div>
            </div>
            <span
              title={`Fit score${job.fit_score == null ? ' unavailable' : ''}`}
              className={[
                'shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                fitScoreClasses(job.fit_score),
              ].join(' ')}
            >
              {formatFitScore(job.fit_score)}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[#6B7488]">
            {job.location && <span className="truncate">{job.location}</span>}
            {job.remote && (
              <span className="rounded bg-ink-850 px-1.5 py-0.5 text-[#A7AFC2] ring-1 ring-ink-800">
                {job.remote}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
