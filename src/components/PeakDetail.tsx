"use client";

import { useEffect, useState } from "react";
import type { Peak } from "@/lib/analysis/types";
import { formatClipLength, formatTimestamp } from "@/lib/time";
import { linkAtTime, type ParsedSource } from "@/lib/url";
import { Sparkline } from "./Sparkline";
import { Button, Kbd, ReasonBadge, ScoreBadge, useCopy } from "./ui";

interface Props {
  peak: Peak;
  source: ParsedSource | null;
  durationSeconds: number;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

function Metric({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-line bg-elevated px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="tabular text-base font-semibold" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function PeakDetail({ peak, source, durationSeconds, onPrev, onNext, hasPrev, hasNext }: Props) {
  const copy = useCopy();
  const [copied, setCopied] = useState<string | null>(null);
  const [clipIn, setClipIn] = useState(peak.suggestedIn);
  const [clipOut, setClipOut] = useState(peak.suggestedOut);

  useEffect(() => {
    setClipIn(peak.suggestedIn);
    setClipOut(peak.suggestedOut);
  }, [peak]);

  const flash = async (key: string, text: string) => {
    if (await copy(text)) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    }
  };
  const nudge = (which: "in" | "out", delta: number) => {
    if (which === "in") setClipIn((v) => Math.max(0, Math.min(clipOut - 5, v + delta)));
    else setClipOut((v) => Math.min(durationSeconds, Math.max(clipIn + 5, v + delta)));
  };
  const link = source ? linkAtTime(source, clipIn) : null;
  const clipText = `${formatTimestamp(clipIn)} - ${formatTimestamp(clipOut)}`;

  return (
    <div className="grid gap-4 p-4 animate-rise" key={peak.id}>
      <div className="flex items-start gap-3">
        <ScoreBadge score={peak.score} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-xl font-semibold text-ink">{formatTimestamp(peak.time)}</span>
            <ReasonBadge reason={peak.reason} />
            <span className="text-xs text-faint">rank #{peak.rank}</span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted">{peak.headline}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={onPrev} disabled={!hasPrev} title="Previous (↑ / k)">↑</Button>
          <Button size="sm" variant="ghost" onClick={onNext} disabled={!hasNext} title="Next (↓ / j)">↓</Button>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-elevated p-2">
        <Sparkline
          chat={peak.chatSparkline}
          db={peak.loudnessSparkline.db}
          binSeconds={peak.loudnessSparkline.binSeconds}
          startTime={peak.loudnessSparkline.startTime}
          markerTime={peak.time}
          clipIn={clipIn}
          clipOut={clipOut}
        />
        <div className="flex justify-between px-1 text-[10px] tabular text-faint">
          <span>{formatTimestamp(peak.loudnessSparkline.startTime)}</span>
          <span>{formatTimestamp(peak.loudnessSparkline.startTime + peak.loudnessSparkline.db.length * peak.loudnessSparkline.binSeconds)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Chat rate" value={`${Math.round(peak.chatRatePerMin)}/min`} sub={`baseline ${Math.round(peak.chatBaselinePerMin)}/min`} color="var(--chat)" />
        <Metric label="Chat surge" value={peak.chatMultiplier >= 99 ? "∞" : `${peak.chatMultiplier.toFixed(1)}×`} sub={`z ${peak.chatZ.toFixed(1)}`} color="var(--chat)" />
        <Metric label="Loudness" value={`${peak.loudnessDb.toFixed(1)} dB`} sub={`baseline ${peak.loudnessBaselineDb.toFixed(1)} dB`} color="var(--audio)" />
        <Metric label="Audio jump" value={`${peak.loudnessDeltaDb >= 0 ? "+" : ""}${peak.loudnessDeltaDb.toFixed(1)} dB`} sub={`z ${peak.audioZ.toFixed(1)}`} color="var(--audio)" />
      </div>

      <div className="grid gap-2 rounded-lg border border-line bg-elevated p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Suggested clip</span>
          <span className="tabular text-xs text-muted">{formatClipLength(clipOut - clipIn)} long</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["in", "out"] as const).map((which) => {
            const value = which === "in" ? clipIn : clipOut;
            return (
              <div key={which} className="flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1">
                <span className="w-7 text-[11px] uppercase text-muted">{which}</span>
                <span className="tabular flex-1 text-sm text-ink">{formatTimestamp(value)}</span>
                {[-5, -1, 1, 5].map((d) => (
                  <button key={d} onClick={() => nudge(which, d)} className="rounded px-1.5 py-0.5 font-mono text-[11px] text-muted hover:bg-panel-2 hover:text-ink" title={`${d > 0 ? "+" : ""}${d}s`}>
                    {d > 0 ? `+${d}` : d}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => flash("range", clipText)}>{copied === "range" ? "Copied" : "Copy in/out"}</Button>
          <Button size="sm" onClick={() => flash("time", formatTimestamp(peak.time))}>{copied === "time" ? "Copied" : "Copy timestamp"}</Button>
          {link && (
            <>
              <Button size="sm" onClick={() => flash("link", link)}>{copied === "link" ? "Copied" : "Copy link"}</Button>
              <a href={link} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-lg border border-line bg-panel px-3 text-xs font-medium text-ink hover:border-line-strong hover:bg-panel-2">
                Open at {formatTimestamp(clipIn, { compact: true })} ↗
              </a>
            </>
          )}
          {(clipIn !== peak.suggestedIn || clipOut !== peak.suggestedOut) && (
            <Button size="sm" variant="ghost" onClick={() => { setClipIn(peak.suggestedIn); setClipOut(peak.suggestedOut); }}>Reset</Button>
          )}
        </div>
      </div>

      {peak.topTerms.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] uppercase tracking-wider text-muted">Chat was saying</span>
          {peak.topTerms.map((t) => (
            <span key={t} className="rounded-md border border-line bg-panel-2 px-2 py-0.5 font-mono text-xs text-ink">{t}</span>
          ))}
        </div>
      )}

      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">Chat around the moment</div>
        {peak.chatSnippets.length === 0 ? (
          <p className="text-xs text-faint">No chat messages in this window.</p>
        ) : (
          <ul className="scrollbar-thin grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-line bg-elevated p-2 text-xs">
            {peak.chatSnippets.map((m, i) => (
              <li key={i} className="flex gap-2 leading-relaxed">
                <span className="tabular w-14 shrink-0 text-faint">{formatTimestamp(m.t, { compact: true })}</span>
                <span className="shrink-0 font-medium text-chat">{m.author}</span>
                <span className="min-w-0 break-words text-ink">{m.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-faint">
        <Kbd>j</Kbd> / <Kbd>k</Kbd> next / previous · <Kbd>c</Kbd> copy in/out
      </p>
    </div>
  );
}
