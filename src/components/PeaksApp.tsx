"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PeakReason } from "@/lib/analysis/types";
import { applyFilters, DEFAULT_FILTERS, type PeakFilters } from "@/lib/filters";
import type { AnalyzeRequest } from "@/lib/jobs/types";
import { formatTimestamp } from "@/lib/time";
import { useJob } from "@/hooks/useJob";
import { ExportMenu } from "./ExportMenu";
import { Filters } from "./Filters";
import { PeakDetail } from "./PeakDetail";
import { PeakList } from "./PeakList";
import { ProgressPanel } from "./ProgressPanel";
import { StatsBar } from "./StatsBar";
import { Timeline } from "./Timeline";
import { Button, Logo, Panel, useCopy } from "./ui";
import { UrlForm } from "./UrlForm";

export function PeaksApp() {
  const router = useRouter();
  const params = useSearchParams();
  const initialJob = params.get("job");
  const { phase, job, error, submit, cancel, reset } = useJob(initialJob);
  const [liveEnabled, setLiveEnabled] = useState<boolean | null>(null);
  const [filters, setFilters] = useState<PeakFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<AnalyzeRequest | null>(null);
  const copy = useCopy();

  useEffect(() => {
    fetch("/api/analyze")
      .then((r) => r.json())
      .then((d: { liveEnabled?: boolean }) => setLiveEnabled(d.liveEnabled ?? false))
      .catch(() => setLiveEnabled(false));
  }, []);

  const initialRequest = useMemo<Partial<AnalyzeRequest>>(() => {
    const url = params.get("url") ?? "";
    const mode = params.get("mode") === "live" ? "live" : params.get("demo") !== null || !url ? "demo" : "live";
    const s = params.get("sensitivity");
    return { url, mode, sensitivity: s === "low" || s === "high" ? s : "medium" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result = phase === "done" ? job?.result ?? null : null;
  const filtered = useMemo(() => (result ? applyFilters(result.peaks, filters) : []), [result, filters]);
  const counts = useMemo(() => {
    const c: Record<PeakReason, number> = { both: 0, chat: 0, audio: 0 };
    for (const p of result?.peaks ?? []) c[p.reason]++;
    return c;
  }, [result]);
  const selected = filtered.find((p) => p.id === selectedId) ?? null;
  const selectedIndex = selected ? filtered.indexOf(selected) : -1;

  useEffect(() => {
    if (result && filtered.length && !filtered.some((p) => p.id === selectedId)) setSelectedId(filtered[0].id);
  }, [result, filtered, selectedId]);

  const onSubmit = useCallback(
    async (request: AnalyzeRequest) => {
      setLastRequest(request);
      setFilters(DEFAULT_FILTERS);
      setSelectedId(null);
      const id = await submit(request);
      if (id) router.replace(`/app?job=${id}`, { scroll: false });
    },
    [submit, router]
  );

  const step = useCallback(
    (delta: number) => {
      if (!filtered.length) return;
      const next = Math.max(0, Math.min(filtered.length - 1, (selectedIndex < 0 ? 0 : selectedIndex) + delta));
      setSelectedId(filtered[next].id);
    },
    [filtered, selectedIndex]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        step(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "c" && selected) {
        void copy(`${formatTimestamp(selected.suggestedIn)} - ${formatTimestamp(selected.suggestedOut)}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, selected, copy]);

  const busy = phase === "submitting" || phase === "running";
  const request = job?.request ?? lastRequest;
  const exportCtx = { source: job?.source ?? null, title: job?.meta?.title, channel: job?.meta?.channel, url: request?.url };
  const baseName = job?.meta ? `peaks-${job.meta.platform}-${job.meta.id}` : "peaks";

  return (
    <div className="mx-auto grid min-h-screen w-full max-w-7xl gap-5 px-4 py-5 sm:px-6">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" className="text-ink hover:opacity-80">
          <Logo />
        </Link>
        <nav className="flex items-center gap-3 text-xs text-muted">
          {liveEnabled === false && <span className="rounded-md border border-line px-2 py-1">Demo only on this server</span>}
          <a href="https://github.com/zumuzmjp/peaks" target="_blank" rel="noreferrer" className="hover:text-ink">GitHub ↗</a>
        </nav>
      </header>

      <Panel className="p-4 sm:p-5">
        <UrlForm busy={busy} liveEnabled={liveEnabled} initial={initialRequest} onSubmit={onSubmit} />
      </Panel>

      {(phase === "submitting" || phase === "running" || phase === "cancelled") && <ProgressPanel job={job} phase={phase} onCancel={cancel} />}

      {phase === "error" && (
        <Panel className="animate-rise border-danger/40">
          <div className="grid gap-2 p-4">
            <div className="text-sm font-medium text-danger">Analysis failed</div>
            <p className="text-sm text-ink">{error ?? job?.error?.message ?? "Unknown error"}</p>
            {job?.error?.hint && <p className="text-xs text-muted">{job.error.hint}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={reset}>Dismiss</Button>
              {request && request.mode === "live" && (
                <Button size="sm" variant="ghost" onClick={() => onSubmit({ ...request, mode: "demo" })}>Run the demo instead</Button>
              )}
            </div>
          </div>
        </Panel>
      )}

      {result && job && (
        <div className="grid gap-5 animate-rise">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-ink">{job.meta?.title ?? "Analysis"}</h1>
              <p className="truncate text-xs text-muted">
                {job.meta?.channel && <span className="text-ink">{job.meta.channel}</span>}
                {job.meta?.channel && " · "}
                {job.source?.canonicalUrl ?? request?.url}
                {" · "}
                sensitivity {job.request.sensitivity}
                {job.request.mode === "demo" && " · demo data"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {request && (
                <Button size="sm" variant="ghost" onClick={() => onSubmit({ ...request, sensitivity: request.sensitivity === "high" ? "low" : request.sensitivity === "medium" ? "high" : "medium" })} title="Re-run with a different sensitivity">
                  Re-run: {request.sensitivity === "high" ? "low" : request.sensitivity === "medium" ? "high" : "medium"}
                </Button>
              )}
              <ExportMenu result={result} peaks={filtered} ctx={exportCtx} baseName={baseName} />
            </div>
          </div>

          {job.warnings.length > 0 && (
            <ul className="grid gap-1 text-xs text-muted">
              {job.warnings.map((w) => (
                <li key={w} className="rounded-md border border-line bg-panel px-3 py-1.5">{w}</li>
              ))}
            </ul>
          )}

          <StatsBar result={result} />

          <Panel title="Timeline" aside={<span className="text-xs text-muted">{filtered.length} peaks shown</span>}>
            <div className="p-4 pt-3">
              <Timeline
                result={result}
                peaks={filtered}
                selectedId={selectedId}
                onSelect={setSelectedId}
                range={{ from: filters.from, to: filters.to }}
                onRange={(from, to) => setFilters((f) => ({ ...f, from, to }))}
              />
            </div>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1.25fr)]">
            <Panel title="Filters" className="h-fit">
              <Filters filters={filters} onChange={setFilters} counts={counts} shown={filtered.length} total={result.peaks.length} />
            </Panel>
            <Panel title="Peaks" className="overflow-hidden">
              <PeakList peaks={filtered} selectedId={selectedId} onSelect={setSelectedId} />
            </Panel>
            <Panel title="Detail" className="h-fit lg:sticky lg:top-5">
              {selected ? (
                <PeakDetail
                  peak={selected}
                  source={job.source}
                  durationSeconds={result.durationSeconds}
                  onPrev={() => step(-1)}
                  onNext={() => step(1)}
                  hasPrev={selectedIndex > 0}
                  hasNext={selectedIndex >= 0 && selectedIndex < filtered.length - 1}
                />
              ) : (
                <div className="p-8 text-center text-sm text-muted">Select a peak to see details.</div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {phase === "idle" && (
        <div className="grid gap-3 text-sm text-muted sm:grid-cols-3">
          {[
            ["1. Paste", "A finished YouTube live stream or Twitch VOD. Or leave it empty and run the demo."],
            ["2. Analyse", "PEAKS bins the chat replay and the audio loudness, then finds spikes against a rolling baseline."],
            ["3. Clip", "Ranked moments with in/out points, chat context, deep links, and CSV/JSON export."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-xl border border-line bg-panel p-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink">{t}</div>
              <p className="text-xs leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
