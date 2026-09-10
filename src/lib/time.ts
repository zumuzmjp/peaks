/** Formats seconds as h:mm:ss (or m:ss when under an hour and `compact` is set). */
export function formatTimestamp(seconds: number, opts: { compact?: boolean } = {}): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h === 0 && opts.compact) return `${m}:${ss}`;
  return `${h}:${mm}:${ss}`;
}

/** Formats a duration like "3h 12m" or "45m 10s". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Formats seconds as a Twitch style offset "1h02m03s". */
export function formatOffsetParam(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
}

/** Formats a clip length like "0:42". */
export function formatClipLength(seconds: number): string {
  return formatTimestamp(seconds, { compact: true });
}
