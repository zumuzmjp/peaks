"use client";

import { useMemo, useRef, useState } from "react";
import type { AnalysisResult, Peak } from "@/lib/analysis/types";
import { formatTimestamp } from "@/lib/time";
import { REASON_COLOR } from "./ui";

interface Props {
  result: AnalysisResult;
  peaks: Peak[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  range: { from: number | null; to: number | null };
  onRange: (from: number | null, to: number | null) => void;
}

/** Full-stream overview: chat rate area, loudness line, one marker per peak. Drag to set a time range. */
export function Timeline({ result, peaks, selectedId, onSelect, range, onRange }: Props) {
  const width = 1000;
  const height = 150;
  const padTop = 10;
  const padBottom = 18;
  const innerH = height - padTop - padBottom;
  const { series, durationSeconds } = result;
  const n = series.chatRate.length;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);

  const geometry = useMemo(() => {
    const maxChat = Math.max(1, ...series.chatRate);
    const dbVals = series.audioDb.filter((v) => v > -80);
    const dbMin = Math.min(...dbVals, -40);
    const dbMax = Math.max(...dbVals, -10) + 1;
    const xAt = (i: number) => (i / n) * width;
    const yChat = (v: number) => padTop + innerH - (v / maxChat) * innerH;
    const yDb = (v: number) => padTop + innerH - ((Math.max(dbMin, v) - dbMin) / (dbMax - dbMin)) * innerH;
    let area = `M0,${padTop + innerH}`;
    for (let i = 0; i < n; i++) area += ` L${xAt(i).toFixed(1)},${yChat(series.chatRate[i]).toFixed(1)}`;
    area += ` L${width},${padTop + innerH} Z`;
    const line = series.audioDb.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yDb(v).toFixed(1)}`).join(" ");
    return { area, line };
  }, [series, n, innerH]);

  const tx = (t: number) => (t / durationSeconds) * width;
  const tickEvery = durationSeconds > 4 * 3600 ? 3600 : durationSeconds > 90 * 60 ? 1800 : durationSeconds > 20 * 60 ? 600 : 120;
  const ticks: number[] = [];
  for (let t = 0; t <= durationSeconds; t += tickEvery) ticks.push(t);

  const timeFromEvent = (e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return frac * durationSeconds;
  };

  const selected = peaks.find((p) => p.id === selectedId);
  const hoverPeak = hover !== null ? peaks.reduce<Peak | null>((best, p) => (Math.abs(p.time - hover) < durationSeconds * 0.008 && (!best || Math.abs(p.time - hover) < Math.abs(best.time - hover)) ? p : best), null) : null;

  return (
    <div className="relative select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full cursor-crosshair"
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const t = timeFromEvent(e);
          setHover(t);
          if (drag) setDrag({ ...drag, end: t });
        }}
        onMouseLeave={() => {
          setHover(null);
          if (drag) setDrag(null);
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const t = timeFromEvent(e);
          setDrag({ start: t, end: t });
        }}
        onMouseUp={(e) => {
          const t = timeFromEvent(e);
          if (drag && Math.abs(drag.start - t) > durationSeconds * 0.01) {
            onRange(Math.round(Math.min(drag.start, t)), Math.round(Math.max(drag.start, t)));
          } else if (hoverPeak) {
            onSelect(hoverPeak.id);
          } else if (range.from !== null || range.to !== null) {
            onRange(null, null);
          }
          setDrag(null);
        }}
      >
        {/* Range shading */}
        {(range.from !== null || range.to !== null) && (
          <>
            <rect x={0} y={0} width={tx(range.from ?? 0)} height={height} fill="rgba(0,0,0,0.45)" />
            <rect x={tx(range.to ?? durationSeconds)} y={0} width={width - tx(range.to ?? durationSeconds)} height={height} fill="rgba(0,0,0,0.45)" />
          </>
        )}
        {drag && Math.abs(drag.end - drag.start) > 0 && (
          <rect x={tx(Math.min(drag.start, drag.end))} y={0} width={tx(Math.abs(drag.end - drag.start))} height={height} fill="rgba(255,255,255,0.08)" />
        )}
        <path d={geometry.area} fill="var(--chat)" opacity={0.28} />
        <path d={geometry.line} fill="none" stroke="var(--audio)" strokeWidth={1} opacity={0.85} vectorEffect="non-scaling-stroke" />
        {/* Peak markers */}
        {peaks.map((p) => {
          const isSel = p.id === selectedId;
          const h = 8 + (p.score / 100) * (innerH - 8);
          return (
            <g key={p.id} onClick={() => onSelect(p.id)} className="cursor-pointer">
              <line x1={tx(p.time)} x2={tx(p.time)} y1={padTop + innerH - h} y2={padTop + innerH} stroke={REASON_COLOR[p.reason]} strokeWidth={isSel ? 3 : 1.5} opacity={isSel ? 1 : 0.85} vectorEffect="non-scaling-stroke" />
              <circle cx={tx(p.time)} cy={padTop + innerH - h} r={isSel ? 5 : 3.2} fill={REASON_COLOR[p.reason]} stroke={isSel ? "var(--text)" : "none"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {selected && (
          <rect x={tx(selected.suggestedIn)} y={padTop} width={Math.max(2, tx(selected.suggestedOut) - tx(selected.suggestedIn))} height={innerH} fill="rgba(255,255,255,0.12)" stroke="var(--text)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        )}
        {hover !== null && <line x1={tx(hover)} x2={tx(hover)} y1={0} y2={padTop + innerH} stroke="var(--text)" strokeOpacity={0.4} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        {/* Axis */}
        <line x1={0} x2={width} y1={padTop + innerH} y2={padTop + innerH} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={tx(t)} x2={tx(t)} y1={padTop + innerH} y2={padTop + innerH + 4} stroke="var(--border-strong)" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
      {/* HTML tick labels keep their aspect ratio (SVG text would stretch). */}
      <div className="pointer-events-none relative h-4 w-full text-[10px] text-faint">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 tabular" style={{ left: `${(t / durationSeconds) * 100}%` }}>
            {formatTimestamp(t, { compact: true })}
          </span>
        ))}
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute top-2 rounded-md border border-line bg-elevated px-2 py-1 text-xs shadow" style={{ left: `calc(${(hover / durationSeconds) * 100}% + 8px)`, transform: hover > durationSeconds * 0.8 ? "translateX(calc(-100% - 16px))" : undefined }}>
          <div className="tabular text-ink">{formatTimestamp(hover)}</div>
          {hoverPeak ? (
            <div className="max-w-64 truncate text-muted">
              #{hoverPeak.rank} · {hoverPeak.score} · {hoverPeak.headline}
            </div>
          ) : (
            <div className="text-muted">
              chat {Math.round(series.chatRate[Math.min(n - 1, Math.floor(hover / series.binSeconds))])}/min · {series.audioDb[Math.min(n - 1, Math.floor(hover / series.binSeconds))].toFixed(0)} dB
            </div>
          )}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-chat opacity-60" /> chat rate</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 bg-audio" /> loudness</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-both" /> peak markers · click to open</span>
        <span className="ml-auto">drag to set a time range{range.from !== null || range.to !== null ? " · click empty space to clear" : ""}</span>
      </div>
    </div>
  );
}
