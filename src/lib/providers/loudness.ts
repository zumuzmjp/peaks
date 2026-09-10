import type { LoudnessSeries } from "../analysis/types";
import { run } from "./exec";
import { ProviderError, type ProgressFn } from "./types";

/** Loudness below this is treated as silence. */
export const SILENCE_DB = -90;

/**
 * Parses one ffmpeg `ebur128` log line. Momentary loudness (a 400 ms window,
 * reported every 100 ms) is what reacts to a shout or a sudden sound.
 */
const EBUR_LINE = /t:\s*([\d.]+)\s+TARGET:\S+\s+LUFS\s+M:\s*(-?[\d.]+|-inf|nan)/;

export function parseEbur128Line(line: string): { t: number; momentary: number } | null {
  const m = EBUR_LINE.exec(line);
  if (!m) return null;
  const t = Number(m[1]);
  const raw = m[2];
  const momentary = raw === "-inf" || raw === "nan" ? SILENCE_DB : Number(raw);
  if (!Number.isFinite(t)) return null;
  return { t, momentary: Math.max(SILENCE_DB, momentary) };
}

/**
 * Accumulates momentary loudness samples into a 1-second series, averaging
 * in the power domain so a short loud burst survives the averaging.
 */
export class LoudnessAccumulator {
  private power: number[] = [];
  private counts: number[] = [];

  add(t: number, db: number): void {
    const s = Math.floor(t);
    if (s < 0) return;
    while (this.power.length <= s) {
      this.power.push(0);
      this.counts.push(0);
    }
    this.power[s] += Math.pow(10, db / 10);
    this.counts[s] += 1;
  }

  get seconds(): number {
    return this.power.length;
  }

  toSeries(durationSeconds?: number): LoudnessSeries {
    const n = durationSeconds ? Math.max(this.power.length, Math.ceil(durationSeconds)) : this.power.length;
    const db = new Array<number>(n);
    let last = SILENCE_DB;
    for (let i = 0; i < n; i++) {
      const c = this.counts[i] ?? 0;
      if (c > 0) last = Math.max(SILENCE_DB, 10 * Math.log10(this.power[i] / c));
      db[i] = Math.round(last * 10) / 10;
    }
    return { stepSeconds: 1, db };
  }
}

/**
 * Runs ffmpeg's EBU R128 meter over an audio file and returns a 1-second
 * loudness series. Progress is reported from the meter's own timestamps.
 */
export async function measureLoudness(
  ffmpegPath: string,
  audioPath: string,
  durationSeconds: number,
  onProgress: ProgressFn,
  signal?: AbortSignal
): Promise<LoudnessSeries> {
  const acc = new LoudnessAccumulator();
  let lastReport = -1;
  const onLine = (line: string) => {
    const sample = parseEbur128Line(line);
    if (!sample) return;
    acc.add(sample.t, sample.momentary);
    if (durationSeconds > 0) {
      const pct = Math.min(99, Math.floor((sample.t / durationSeconds) * 100));
      if (pct !== lastReport && pct % 2 === 0) {
        lastReport = pct;
        onProgress(pct, `Measuring loudness… ${pct}%`);
      }
    }
  };
  await run(ffmpegPath, {
    args: ["-hide_banner", "-nostats", "-nostdin", "-i", audioPath, "-vn", "-af", "ebur128=peak=none", "-f", "null", "-"],
    signal,
    onStderr: onLine,
    onStdout: onLine,
  });
  if (acc.seconds === 0) {
    throw new ProviderError("ffmpeg produced no loudness samples.", "The audio download may be empty or corrupted.");
  }
  return acc.toSeries(durationSeconds);
}
