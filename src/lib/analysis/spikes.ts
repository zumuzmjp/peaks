import type { Spike, SpikeSource } from "./types";

export interface DetectSpikesOptions {
  threshold: number;
  /** Bins within this gap of each other are merged into one spike. Default 1. */
  mergeGapBins?: number;
  /** Minimum spike length in bins. Default 1. */
  minBins?: number;
}

/**
 * Finds contiguous runs of bins whose z-score exceeds `threshold`.
 * Runs separated by at most `mergeGapBins` bins are merged.
 */
export function detectSpikes(z: number[], source: SpikeSource, opts: DetectSpikesOptions): Spike[] {
  const threshold = opts.threshold;
  const gap = opts.mergeGapBins ?? 1;
  const minBins = opts.minBins ?? 1;
  const raw: Spike[] = [];

  let i = 0;
  while (i < z.length) {
    if (z[i] > threshold) {
      const start = i;
      let end = i;
      let peakBin = i;
      let peakZ = z[i];
      let area = z[i] - threshold;
      let j = i + 1;
      while (j < z.length && z[j] > threshold) {
        if (z[j] > peakZ) {
          peakZ = z[j];
          peakBin = j;
        }
        area += z[j] - threshold;
        end = j;
        j++;
      }
      raw.push({ source, startBin: start, endBin: end, peakBin, peakZ, area });
      i = j;
    } else {
      i++;
    }
  }

  // Merge runs separated by small gaps.
  const merged: Spike[] = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    if (prev && s.startBin - prev.endBin - 1 <= gap) {
      prev.endBin = s.endBin;
      prev.area += s.area;
      if (s.peakZ > prev.peakZ) {
        prev.peakZ = s.peakZ;
        prev.peakBin = s.peakBin;
      }
    } else {
      merged.push({ ...s });
    }
  }

  return merged.filter((s) => s.endBin - s.startBin + 1 >= minBins);
}

/**
 * Groups spikes from any source whose windows overlap or fall within
 * `gapBins` of each other. Returns clusters sorted by start.
 */
export function clusterSpikes(spikes: Spike[], gapBins: number): Spike[][] {
  const sorted = spikes.slice().sort((a, b) => a.startBin - b.startBin);
  const clusters: Spike[][] = [];
  let current: Spike[] = [];
  let currentEnd = -Infinity;
  for (const s of sorted) {
    if (current.length === 0 || s.startBin - currentEnd - 1 <= gapBins) {
      current.push(s);
      currentEnd = Math.max(currentEnd, s.endBin);
    } else {
      clusters.push(current);
      current = [s];
      currentEnd = s.endBin;
    }
  }
  if (current.length) clusters.push(current);
  return clusters;
}

/**
 * Drops audio spikes that are really level changes: when the signal stays
 * elevated well after the spike ends (a game starting, music turned up), the
 * moment is not a transient reaction and should not be clipped.
 */
export function dropSustainedSpikes(
  spikes: Spike[],
  values: number[],
  opts: { lookBins?: number; sustainedFraction?: number } = {}
): Spike[] {
  const look = opts.lookBins ?? 5;
  const fraction = opts.sustainedFraction ?? 0.6;
  const med = (arr: number[]) => {
    if (arr.length === 0) return NaN;
    const s = arr.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return spikes.filter((s) => {
    const pre = med(values.slice(Math.max(0, s.startBin - look - 1), Math.max(0, s.startBin - 1)));
    const post = med(values.slice(s.endBin + 2, s.endBin + 2 + look));
    if (!isFinite(pre) || !isFinite(post)) return true;
    let height = -Infinity;
    for (let b = s.startBin; b <= s.endBin; b++) height = Math.max(height, values[b] - pre);
    if (height <= 0) return true;
    return post - pre < fraction * height;
  });
}
