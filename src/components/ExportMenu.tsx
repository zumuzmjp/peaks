"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisResult, Peak } from "@/lib/analysis/types";
import { peaksToCsv, peaksToJson, peaksToText, type ExportContext } from "@/lib/export";
import { Button, useCopy } from "./ui";

function download(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function ExportMenu({ result, peaks, ctx, baseName }: { result: AnalysisResult; peaks: Peak[]; ctx: ExportContext; baseName: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = useCopy();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const name = baseName.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "peaks";
  const items = [
    { label: `CSV (${peaks.length} peaks)`, action: () => download(`${name}.csv`, peaksToCsv(peaks, ctx), "text/csv") },
    { label: `JSON (${peaks.length} peaks)`, action: () => download(`${name}.json`, peaksToJson(result, peaks, ctx), "application/json") },
    {
      label: copied ? "Copied to clipboard" : "Copy as text list",
      action: async () => {
        if (await copy(peaksToText(peaks, ctx))) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      },
    },
  ];

  return (
    <div ref={ref} className="relative">
      <Button size="sm" onClick={() => setOpen((o) => !o)} disabled={peaks.length === 0} aria-haspopup="menu" aria-expanded={open}>
        Export ▾
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-elevated shadow-panel">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              onClick={() => {
                void it.action();
                if (!it.label.startsWith("Copy")) setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-panel-2"
            >
              {it.label}
            </button>
          ))}
          <div className="border-t border-line px-3 py-1.5 text-[11px] text-faint">Exports respect the current filters.</div>
        </div>
      )}
    </div>
  );
}
