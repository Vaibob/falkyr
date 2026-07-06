const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400';

interface BulkToolbarProps {
  /** Whether bulk-select mode is active. */
  active: boolean;
  /** Toggle bulk-select mode on/off. */
  onToggleActive: () => void;
  /** Count of currently selected 'ready' cards. */
  selectedCount: number;
  /** How many 'ready' jobs exist (to enable "select all"). */
  readyCount: number;
  /** Select every 'ready' job. */
  onSelectAllReady: () => void;
  /** Clear the selection. */
  onClearSelection: () => void;
  /** Approve every selected job (loops POST /approve). */
  onApproveSelected: () => void;
  /** Whether an approve-selected batch is in flight. */
  approving: boolean;
  /** Progress of the current batch, e.g. "3 / 12" while running. */
  progress: { done: number; total: number } | null;
}

export default function BulkToolbar({
  active,
  onToggleActive,
  selectedCount,
  readyCount,
  onSelectAllReady,
  onClearSelection,
  onApproveSelected,
  approving,
  progress,
}: BulkToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-transparent elevate-1 px-3 py-2">
      <button
        type="button"
        onClick={onToggleActive}
        aria-pressed={active}
        className={[
          'inline-flex items-center min-h-10 rounded-md px-3 py-1.5 text-sm sm:min-h-0 font-medium transition',
          FOCUS_RING,
          active
            ? 'bg-ink-850 text-[#EDEFF4] ring-1 ring-ink-700'
            : 'text-[#A7AFC2] ring-1 ring-ink-700 hover:bg-ink-850 hover:text-[#EDEFF4]',
        ].join(' ')}
      >
        {active ? 'Selecting ready cards' : 'Bulk select'}
      </button>

      {active && (
        <>
          <span className="hidden h-4 w-px bg-ink-700 sm:block" aria-hidden />

          <span className="text-sm text-[#A7AFC2]">
            <span className="font-semibold tabular-nums text-[#EDEFF4]">{selectedCount}</span>{' '}
            selected
            <span className="text-[#6B7488]"> · {readyCount} ready</span>
          </span>

          <button
            type="button"
            onClick={onSelectAllReady}
            disabled={readyCount === 0 || selectedCount === readyCount}
            className={`min-h-10 rounded-md px-2.5 py-1 text-sm sm:min-h-0 font-medium text-[#A7AFC2] transition hover:bg-ink-850 hover:text-[#EDEFF4] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#A7AFC2] ${FOCUS_RING}`}
          >
            Select all ready
          </button>

          <button
            type="button"
            onClick={onClearSelection}
            disabled={selectedCount === 0}
            className={`min-h-10 rounded-md px-2.5 py-1 text-sm sm:min-h-0 font-medium text-[#A7AFC2] transition hover:bg-ink-850 hover:text-[#EDEFF4] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#A7AFC2] ${FOCUS_RING}`}
          >
            Clear
          </button>

          <div className="ml-auto flex items-center gap-2">
            {approving && progress && (
              <span className="text-xs tabular-nums text-[#6B7488]">
                Approving {progress.done} / {progress.total}…
              </span>
            )}
            <button
              type="button"
              onClick={onApproveSelected}
              disabled={selectedCount === 0 || approving}
              title="Set every selected Ready card to Approved (green-lights them for submission)"
              className={`inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-ink-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
            >
              {approving && (
                <svg
                  className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    opacity="0.25"
                  />
                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
                </svg>
              )}
              Approve selected
            </button>
          </div>
        </>
      )}
    </div>
  );
}
