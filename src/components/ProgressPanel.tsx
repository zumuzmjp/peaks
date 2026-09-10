"use client";

import type { JobView, StageState } from "@/lib/jobs/types";
import { Button, Panel } from "./ui";

function StageIcon({ status }: { status: StageState["status"] }) {
  const base = "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]";
  switch (status) {
    case "done":
      return <span className={`${base} border-both bg-[var(--both-soft)] text-both`}>✓</span>;
    case "skipped":
      return <span className={`${base} border-line text-faint`}>–</span>;
    case "error":
      return <span className={`${base} border-danger text-danger`}>!</span>;
    case "active":
      return <span className={`${base} animate-peaks-pulse border-ink bg-ink`} />;
    default:
      return <span className={`${base} border-line`} />;
  }
}

export function ProgressPanel({ job, phase, onCancel }: { job: JobView | null; phase: string; onCancel: () => void }) {
  const percent = job?.percent ?? 0;
  const stages = job?.stages ?? [];
  const running = phase === "running" || phase === "submitting";
  return (
    <Panel className="animate-rise" title="Analysing" aside={running ? <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button> : null}>
      <div className="grid gap-4 p-4">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink">{job?.message ?? "Submitting…"}</span>
            <span className="tabular text-muted">{percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <ol className="grid gap-2 sm:grid-cols-2">
          {stages.map((s) => (
            <li key={s.key} className={`flex items-center gap-3 rounded-lg border border-line px-3 py-2 ${s.status === "active" ? "bg-panel-2" : ""}`}>
              <StageIcon status={s.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className={s.status === "pending" ? "text-muted" : "text-ink"}>{s.label}</span>
                  {s.status === "active" && <span className="tabular text-xs text-muted">{s.percent}%</span>}
                </div>
                {s.detail && <div className="truncate text-xs text-muted">{s.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
        {job?.meta && (
          <p className="truncate text-xs text-muted">
            {job.meta.channel && <span className="text-ink">{job.meta.channel}</span>}
            {job.meta.channel && " · "}
            {job.meta.title}
          </p>
        )}
      </div>
    </Panel>
  );
}
