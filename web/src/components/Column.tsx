import type { Job, Stage } from '../types.js';
import { STAGE_META } from '../stageMeta.js';
import JobCard from './JobCard.js';

interface ColumnProps {
  stage: Stage;
  jobs: Job[];
  selectable: boolean;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onOpen: (id: number) => void;
}

export default function Column({
  stage,
  jobs,
  selectable,
  selectedIds,
  onToggleSelect,
  onOpen,
}: ColumnProps) {
  const meta = STAGE_META[stage];

  return (
    <section className="flex w-72 shrink-0 flex-col rounded-xl bg-ink-900/40">
      <header className="px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.headerAccent}`} aria-hidden />
          <h2 className="text-[13px] font-semibold text-[#A7AFC2]">{meta.label}</h2>
          <span className="ml-auto rounded-full bg-ink-850 px-2 py-0.5 text-xs font-medium tabular-nums text-[#6B7488] ring-1 ring-ink-800">
            {jobs.length}
          </span>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3 pt-1">
        {jobs.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-[#6B7488]">
            {stage === 'discovered' ? 'No quarry marked yet.' : 'Nothing here.'}
          </p>
        ) : (
          jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              selectable={selectable}
              selected={selectedIds.has(job.id)}
              onToggleSelect={onToggleSelect}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </section>
  );
}
