import type { Peak, PeakReason } from "./analysis/types";

export type SortKey = "score" | "time" | "chat" | "audio";

export interface PeakFilters {
  reasons: Record<PeakReason, boolean>;
  minScore: number;
  /** Seconds; null = no bound. */
  from: number | null;
  to: number | null;
  query: string;
  sort: SortKey;
}

export const DEFAULT_FILTERS: PeakFilters = {
  reasons: { both: true, chat: true, audio: true },
  minScore: 0,
  from: null,
  to: null,
  query: "",
  sort: "score",
};

/** Applies the sidebar filters to the peak list and sorts the result. */
export function applyFilters(peaks: Peak[], filters: PeakFilters): Peak[] {
  const q = filters.query.trim().toLowerCase();
  const out = peaks.filter((p) => {
    if (!filters.reasons[p.reason]) return false;
    if (p.score < filters.minScore) return false;
    if (filters.from !== null && p.time < filters.from) return false;
    if (filters.to !== null && p.time > filters.to) return false;
    if (q) {
      const hay = [p.headline, ...p.topTerms, ...p.chatSnippets.map((m) => m.text)].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const cmp: Record<SortKey, (a: Peak, b: Peak) => number> = {
    score: (a, b) => b.score - a.score || a.time - b.time,
    time: (a, b) => a.time - b.time,
    chat: (a, b) => b.chatZ - a.chatZ || b.score - a.score,
    audio: (a, b) => b.audioZ - a.audioZ || b.score - a.score,
  };
  return out.sort(cmp[filters.sort]);
}

/** Parses "1:02:03", "62:03", "3723" or "1h2m3s" into seconds. */
export function parseTimeInput(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^\d+(:\d{1,2}){1,2}$/.test(v)) {
    const parts = v.split(":").map(Number);
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  const m = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/.exec(v);
  if (m && m[0]) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return null;
}
