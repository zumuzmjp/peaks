import type { ChatMessage, LoudnessSeries } from "./types";

/** Number of bins needed to cover `durationSeconds` at `binSeconds` per bin. */
export function binCount(durationSeconds: number, binSeconds: number): number {
  return Math.max(1, Math.ceil(durationSeconds / binSeconds));
}

/** Bins chat messages into messages-per-minute per bin. */
export function binChatRate(
  messages: ChatMessage[],
  durationSeconds: number,
  binSeconds: number
): number[] {
  const n = binCount(durationSeconds, binSeconds);
  const counts = new Array<number>(n).fill(0);
  for (const m of messages) {
    if (m.t < 0 || m.t >= durationSeconds) continue;
    counts[Math.min(n - 1, Math.floor(m.t / binSeconds))] += 1;
  }
  const perMin = 60 / binSeconds;
  return counts.map((c) => c * perMin);
}

/**
 * Bins a loudness series into mean dBFS per bin. Averaging happens in the
 * power domain so a single loud second is not drowned out by silence.
 */
export function binLoudness(
  series: LoudnessSeries,
  durationSeconds: number,
  binSeconds: number
): number[] {
  const n = binCount(durationSeconds, binSeconds);
  const power = new Array<number>(n).fill(0);
  const counts = new Array<number>(n).fill(0);
  for (let i = 0; i < series.db.length; i++) {
    const t = i * series.stepSeconds;
    if (t >= durationSeconds) break;
    const b = Math.min(n - 1, Math.floor(t / binSeconds));
    power[b] += Math.pow(10, series.db[i] / 10);
    counts[b] += 1;
  }
  const out = new Array<number>(n);
  let last = -60;
  for (let b = 0; b < n; b++) {
    if (counts[b] > 0) {
      last = 10 * Math.log10(power[b] / counts[b]);
      out[b] = last;
    } else {
      out[b] = last;
    }
  }
  return out;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Rolling median over a centred window of `windowBins` bins. Uses a sorted
 * window with binary-search insert/remove; fast enough for tens of thousands
 * of bins with windows of a few hundred.
 */
export function rollingMedian(values: number[], windowBins: number): number[] {
  const n = values.length;
  if (n === 0) return [];
  const half = Math.max(1, Math.floor(windowBins / 2));
  const out = new Array<number>(n);
  const window: number[] = [];

  const insert = (v: number) => {
    let lo = 0;
    let hi = window.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (window[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    window.splice(lo, 0, v);
  };
  const remove = (v: number) => {
    let lo = 0;
    let hi = window.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (window[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    if (window[lo] === v) window.splice(lo, 1);
  };

  let left = 0;
  let right = -1;
  for (let i = 0; i < n; i++) {
    const wantLeft = Math.max(0, i - half);
    const wantRight = Math.min(n - 1, i + half);
    while (right < wantRight) insert(values[++right]);
    while (left < wantLeft) remove(values[left++]);
    out[i] = median(window);
  }
  return out;
}

/** Rolling median absolute deviation given a precomputed rolling baseline. */
export function rollingMad(values: number[], baseline: number[], windowBins: number): number[] {
  const dev = values.map((v, i) => Math.abs(v - baseline[i]));
  return rollingMedian(dev, windowBins);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / (values.length - 1));
}

/** Simple centred moving average, used to smooth noisy series. */
export function smooth(values: number[], radiusBins: number): number[] {
  if (radiusBins <= 0) return values.slice();
  const n = values.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - radiusBins); j <= Math.min(n - 1, i + radiusBins); j++) {
      s += values[j];
      c++;
    }
    out[i] = s / c;
  }
  return out;
}

export interface RobustZOptions {
  windowBins: number;
  /**
   * Floor applied to the scale estimate as a fraction of the global standard
   * deviation, so very flat stretches don't produce absurd z-scores.
   */
  scaleFloorFraction?: number;
  /** Absolute floor for the scale estimate. */
  scaleFloorAbsolute?: number;
  /**
   * Per-bin floor derived from the local baseline, e.g. the Poisson noise of
   * a count series (sqrt of the expected count) so a steady quiet chat isn't
   * over-sensitive.
   */
  scaleFloorForBaseline?: (baseline: number) => number;
}

/**
 * Robust z-score: (value - rolling median) / (1.4826 * rolling MAD).
 * The MAD is floored so quiet stretches don't explode.
 */
export function robustZ(values: number[], opts: RobustZOptions): {
  z: number[];
  baseline: number[];
  scale: number[];
} {
  const baseline = rollingMedian(values, opts.windowBins);
  const mad = rollingMad(values, baseline, opts.windowBins);
  const globalSd = stddev(values);
  const floor = Math.max(
    opts.scaleFloorAbsolute ?? 0,
    globalSd * (opts.scaleFloorFraction ?? 0.25),
    1e-6
  );
  const perBin = opts.scaleFloorForBaseline;
  const scale = mad.map((m, i) => Math.max(m * 1.4826, floor, perBin ? perBin(baseline[i]) : 0));
  const z = values.map((v, i) => (v - baseline[i]) / scale[i]);
  return { z, baseline, scale };
}

/**
 * Median of the `windowBins` values strictly before each index (the current
 * value is excluded). The first value is its own baseline.
 */
export function trailingMedian(values: number[], windowBins: number): number[] {
  const n = values.length;
  const out = new Array<number>(n);
  const w = Math.max(1, windowBins);
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - w);
    if (from === i) {
      out[i] = values[i];
      continue;
    }
    const window = values.slice(from, i).sort((a, b) => a - b);
    out[i] = median(window);
  }
  return out;
}

export interface OnsetZOptions {
  /** Bins of history the local level is estimated from. */
  baselineBins: number;
  /** Window (bins) over which the typical deviation from that level is measured. */
  scaleWindowBins: number;
  /** Absolute floor for the scale estimate. */
  scaleFloorAbsolute?: number;
  /** Absolute cap for the scale estimate, so a noisy signal cannot hide a large jump. */
  scaleCapAbsolute?: number;
  /**
   * Values at or below this level are treated as "nothing there" (silence);
   * a jump out of it is a start, not a moment, and scores zero.
   */
  floorValue?: number;
}

/**
 * Onset z-score for signals like loudness that shift level between stream
 * phases: each value is compared with the median of the bins just before it,
 * and the deviation is scaled by a rolling robust estimate of how much the
 * signal normally departs from that local level. A jump registers the moment
 * it happens; a slow drift does not.
 */
export function onsetZ(values: number[], opts: OnsetZOptions): {
  z: number[];
  baseline: number[];
  scale: number[];
} {
  const baseline = trailingMedian(values, opts.baselineBins);
  const residual = values.map((v, i) => v - baseline[i]);
  const mad = rollingMedian(residual.map((r) => Math.abs(r)), opts.scaleWindowBins);
  const floor = Math.max(opts.scaleFloorAbsolute ?? 0, 1e-6);
  const capValue = opts.scaleCapAbsolute ?? Infinity;
  const scale = mad.map((m) => Math.min(capValue, Math.max(m * 1.4826, floor)));
  const warmup = Math.min(values.length, Math.max(1, Math.round(opts.baselineBins / 2)));
  const floorValue = opts.floorValue ?? -Infinity;
  // Any silence inside the baseline window makes the comparison meaningless.
  let lastSilent = -Infinity;
  const z = residual.map((r, i) => {
    if (values[i] <= floorValue) lastSilent = i;
    const unreliable = i < warmup || i - lastSilent <= opts.baselineBins || baseline[i] <= floorValue;
    return unreliable ? 0 : r / scale[i];
  });
  return { z, baseline, scale };
}
