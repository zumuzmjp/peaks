import type { AnalysisResult, Peak } from "./analysis/types";
import { formatTimestamp } from "./time";
import { linkAtTime, type ParsedSource } from "./url";

export interface ExportContext {
  source?: ParsedSource | null;
  title?: string;
  channel?: string;
  url?: string;
}

function csvCell(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  "rank",
  "score",
  "reason",
  "time",
  "time_seconds",
  "clip_in",
  "clip_in_seconds",
  "clip_out",
  "clip_out_seconds",
  "clip_length_seconds",
  "chat_msg_per_min",
  "chat_baseline_per_min",
  "chat_multiplier",
  "loudness_db",
  "loudness_delta_db",
  "top_terms",
  "headline",
  "link",
] as const;

export function peakToRow(p: Peak, ctx: ExportContext): Record<(typeof CSV_COLUMNS)[number], string | number> {
  return {
    rank: p.rank,
    score: p.score,
    reason: p.reason,
    time: formatTimestamp(p.time),
    time_seconds: Math.round(p.time),
    clip_in: formatTimestamp(p.suggestedIn),
    clip_in_seconds: p.suggestedIn,
    clip_out: formatTimestamp(p.suggestedOut),
    clip_out_seconds: p.suggestedOut,
    clip_length_seconds: p.suggestedOut - p.suggestedIn,
    chat_msg_per_min: p.chatRatePerMin,
    chat_baseline_per_min: p.chatBaselinePerMin,
    chat_multiplier: p.chatMultiplier,
    loudness_db: p.loudnessDb,
    loudness_delta_db: p.loudnessDeltaDb,
    top_terms: p.topTerms.join(" "),
    headline: p.headline,
    link: ctx.source ? linkAtTime(ctx.source, p.suggestedIn) : "",
  };
}

/** Peaks as CSV, one row per peak, with a header row. */
export function peaksToCsv(peaks: Peak[], ctx: ExportContext = {}): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const p of peaks) {
    const row = peakToRow(p, ctx);
    lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Full JSON export: source, options, stats and the peaks (without the raw series). */
export function peaksToJson(result: AnalysisResult, peaks: Peak[], ctx: ExportContext = {}): string {
  return JSON.stringify(
    {
      generator: "PEAKS",
      exportedAt: new Date().toISOString(),
      source: {
        url: ctx.url ?? ctx.source?.canonicalUrl ?? null,
        platform: ctx.source?.platform ?? null,
        title: ctx.title ?? null,
        channel: ctx.channel ?? null,
        durationSeconds: result.durationSeconds,
      },
      options: result.options,
      stats: result.stats,
      peaks: peaks.map((p) => ({
        ...p,
        timeFormatted: formatTimestamp(p.time),
        clipInFormatted: formatTimestamp(p.suggestedIn),
        clipOutFormatted: formatTimestamp(p.suggestedOut),
        link: ctx.source ? linkAtTime(ctx.source, p.suggestedIn) : null,
      })),
    },
    null,
    2
  );
}

/** Short text list for pasting into notes or a chat. */
export function peaksToText(peaks: Peak[], ctx: ExportContext = {}): string {
  return peaks
    .map((p) => {
      const link = ctx.source ? ` ${linkAtTime(ctx.source, p.suggestedIn)}` : "";
      return `#${p.rank} [${p.score}] ${formatTimestamp(p.time)} (${formatTimestamp(p.suggestedIn)}–${formatTimestamp(p.suggestedOut)}) ${p.reason.toUpperCase()} — ${p.headline}${link}`;
    })
    .join("\n");
}
