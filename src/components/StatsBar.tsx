import type { AnalysisResult } from "@/lib/analysis/types";
import { formatDuration } from "@/lib/time";

export function StatsBar({ result }: { result: AnalysisResult }) {
  const { stats } = result;
  const items: Array<{ label: string; value: string; color?: string }> = [
    { label: "Duration", value: formatDuration(result.durationSeconds) },
    { label: "Messages", value: stats.totalMessages.toLocaleString() },
    { label: "Avg chat", value: `${Math.round(stats.avgChatPerMin)}/min`, color: "var(--chat)" },
    { label: "Peak chat", value: `${Math.round(stats.peakChatPerMin)}/min`, color: "var(--chat)" },
    { label: "Avg loudness", value: `${stats.avgLoudnessDb.toFixed(0)} dB`, color: "var(--audio)" },
    { label: "Peaks", value: `${result.peaks.length}` },
    { label: "Chat + audio", value: `${stats.bothCount}`, color: "var(--both)" },
  ];
  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4 lg:grid-cols-7">
      {items.map((it) => (
        <div key={it.label} className="bg-panel px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wider text-muted">{it.label}</dt>
          <dd className="tabular text-sm font-semibold" style={{ color: it.color }}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
