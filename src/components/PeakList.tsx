"use client";

import { useEffect, useRef } from "react";
import type { Peak } from "@/lib/analysis/types";
import { formatClipLength, formatTimestamp } from "@/lib/time";
import { ReasonBadge, ScoreBadge } from "./ui";

export function PeakList({ peaks, selectedId, onSelect }: { peaks: Peak[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-peak="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (peaks.length === 0) {
    return <div className="p-8 text-center text-sm text-muted">No peaks match these filters.</div>;
  }
  return (
    <ol ref={listRef} className="scrollbar-thin max-h-[70vh] divide-y divide-line overflow-y-auto">
      {peaks.map((p) => {
        const selected = p.id === selectedId;
        return (
          <li key={p.id} data-peak={p.id}>
            <button
              onClick={() => onSelect(p.id)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-panel-2 ${selected ? "bg-panel-2" : ""}`}
              aria-current={selected ? "true" : undefined}
            >
              <ScoreBadge score={p.score} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="tabular text-sm font-medium text-ink">{formatTimestamp(p.time)}</span>
                  <ReasonBadge reason={p.reason} compact />
                  <span className="text-xs text-faint">#{p.rank}</span>
                  <span className="ml-auto tabular text-xs text-muted">clip {formatClipLength(p.suggestedOut - p.suggestedIn)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{p.headline}</p>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
