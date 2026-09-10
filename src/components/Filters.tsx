"use client";

import { useEffect, useState } from "react";
import type { PeakReason } from "@/lib/analysis/types";
import { DEFAULT_FILTERS, parseTimeInput, type PeakFilters, type SortKey } from "@/lib/filters";
import { formatTimestamp } from "@/lib/time";
import { REASON_COLOR, REASON_LABEL } from "./ui";

interface Props {
  filters: PeakFilters;
  onChange: (next: PeakFilters) => void;
  counts: Record<PeakReason, number>;
  shown: number;
  total: number;
}

function TimeInput({ value, onCommit, placeholder }: { value: number | null; onCommit: (v: number | null) => void; placeholder: string }) {
  const [text, setText] = useState(value === null ? "" : formatTimestamp(value));
  useEffect(() => setText(value === null ? "" : formatTimestamp(value)), [value]);
  const commit = () => {
    const parsed = parseTimeInput(text);
    if (text.trim() === "") onCommit(null);
    else if (parsed !== null) onCommit(parsed);
    else setText(value === null ? "" : formatTimestamp(value));
  };
  return (
    <input
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="h-8 w-full rounded-md border border-line bg-elevated px-2 font-mono text-xs text-ink placeholder:text-faint"
      aria-label={placeholder}
    />
  );
}

export function Filters({ filters, onChange, counts, shown, total }: Props) {
  const set = (patch: Partial<PeakFilters>) => onChange({ ...filters, ...patch });
  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS);
  return (
    <div className="grid gap-4 p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          Showing <span className="text-ink">{shown}</span> of {total}
        </span>
        {!isDefault && (
          <button className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => onChange(DEFAULT_FILTERS)}>
            Reset
          </button>
        )}
      </div>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">Search chat</span>
        <input
          value={filters.query}
          onChange={(e) => set({ query: e.target.value })}
          placeholder="KEKW, clutch, !enter…"
          className="h-9 rounded-md border border-line bg-elevated px-2.5 text-sm text-ink placeholder:text-faint"
        />
      </label>

      <fieldset className="grid gap-1.5">
        <legend className="text-xs font-medium uppercase tracking-wider text-muted">Signal</legend>
        <div className="grid gap-1">
          {(["both", "chat", "audio"] as PeakReason[]).map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-panel-2">
              <input type="checkbox" checked={filters.reasons[r]} onChange={(e) => set({ reasons: { ...filters.reasons, [r]: e.target.checked } })} className="accent-white" />
              <span className="h-2 w-2 rounded-full" style={{ background: REASON_COLOR[r] }} />
              <span className="flex-1">{REASON_LABEL[r]}</span>
              <span className="tabular text-xs text-muted">{counts[r]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="grid gap-1.5">
        <span className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-muted">
          Min score <span className="tabular text-ink">{filters.minScore}</span>
        </span>
        <input type="range" min={0} max={100} step={5} value={filters.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })} />
      </label>

      <fieldset className="grid gap-1.5">
        <legend className="text-xs font-medium uppercase tracking-wider text-muted">Time range</legend>
        <div className="grid grid-cols-2 gap-2">
          <TimeInput value={filters.from} onCommit={(v) => set({ from: v })} placeholder="from 0:00:00" />
          <TimeInput value={filters.to} onCommit={(v) => set({ to: v })} placeholder="to end" />
        </div>
      </fieldset>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">Sort by</span>
        <select value={filters.sort} onChange={(e) => set({ sort: e.target.value as SortKey })} className="h-9 rounded-md border border-line bg-elevated px-2 text-sm text-ink">
          <option value="score">Score (best first)</option>
          <option value="time">Time (chronological)</option>
          <option value="chat">Chat intensity</option>
          <option value="audio">Audio intensity</option>
        </select>
      </label>
    </div>
  );
}
