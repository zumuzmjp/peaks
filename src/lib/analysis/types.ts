/** A single chat message from a live chat replay. */
export interface ChatMessage {
  /** Offset from the start of the stream, in seconds. */
  t: number;
  author: string;
  text: string;
}

/** Loudness measured at a fixed step (usually 1 second) in dBFS. */
export interface LoudnessSeries {
  stepSeconds: number;
  /** dBFS values, one per step. Silence is around -90, a loud stream sits near -10. */
  db: number[];
}

export type SpikeSource = "chat" | "audio";
export type PeakReason = "chat" | "audio" | "both";

export type Sensitivity = "low" | "medium" | "high";

export interface AnalysisOptions {
  /** Width of one analysis bin in seconds. Default 10. */
  binSeconds: number;
  /** Rolling baseline window in seconds. Default 600 (10 minutes). */
  baselineWindowSeconds: number;
  /** Seconds of preceding audio the local loudness level is taken from. Default 60. */
  audioBaselineSeconds: number;
  /** Resolution loudness jumps are measured at, in seconds. Default 2. */
  audioStepSeconds: number;
  /** Z-score thresholds for a bin to count as spiking. */
  chatThreshold: number;
  audioThreshold: number;
  /**
   * Chat must reach this rate (messages per minute) for a bin to count as a
   * chat spike, so three messages in a dead chat don't register. Default 24.
   */
  minChatPerMin: number;
  /** Two peaks closer than this (seconds) are merged. Default 45. */
  mergeGapSeconds: number;
  /** Maximum peaks returned. Default 40. */
  maxPeaks: number;
  /** Suggested clip length bounds in seconds. */
  minClipSeconds: number;
  maxClipSeconds: number;
}

export interface Spike {
  source: SpikeSource;
  startBin: number;
  /** Inclusive. */
  endBin: number;
  peakBin: number;
  peakZ: number;
  /** Sum of z above the threshold across the spike. */
  area: number;
}

export interface Peak {
  id: string;
  rank: number;
  /** Time of the strongest moment, seconds. */
  time: number;
  /** Detected spike window, seconds. */
  windowStart: number;
  windowEnd: number;
  /** Suggested clip in/out points, seconds. */
  suggestedIn: number;
  suggestedOut: number;
  /** 0-100. */
  score: number;
  reason: PeakReason;
  sources: SpikeSource[];
  chatZ: number;
  audioZ: number;
  /** Messages per minute at the peak and the local baseline. */
  chatRatePerMin: number;
  chatBaselinePerMin: number;
  /** Ratio of peak chat rate to baseline (1 = normal). */
  chatMultiplier: number;
  /** Loudness at the peak and the local baseline, dBFS. */
  loudnessDb: number;
  loudnessBaselineDb: number;
  loudnessDeltaDb: number;
  /** Chat messages around the peak, ordered by time. */
  chatSnippets: ChatMessage[];
  /** Most repeated words / emotes in the chat window. */
  topTerms: string[];
  /** Loudness (dBFS) per bin from windowStart - context to windowEnd + context. */
  loudnessSparkline: { startTime: number; binSeconds: number; db: number[] };
  /** Chat rate per bin over the same window as the sparkline. */
  chatSparkline: number[];
  /** Human readable one-line explanation. */
  headline: string;
}

export interface AnalysisSeries {
  binSeconds: number;
  /** Messages per minute per bin. */
  chatRate: number[];
  /** Mean dBFS per bin. */
  audioDb: number[];
  /** Loudest `audioStepSeconds` slice inside each bin, dBFS. */
  audioPeakDb: number[];
  chatZ: number[];
  audioZ: number[];
  /** Combined score per bin (unbounded, used for the timeline). */
  combined: number[];
}

export interface AnalysisStats {
  totalMessages: number;
  avgChatPerMin: number;
  peakChatPerMin: number;
  avgLoudnessDb: number;
  peakLoudnessDb: number;
  chatSpikes: number;
  audioSpikes: number;
  bothCount: number;
  chatOnlyCount: number;
  audioOnlyCount: number;
}

export interface AnalysisResult {
  durationSeconds: number;
  options: AnalysisOptions;
  series: AnalysisSeries;
  peaks: Peak[];
  stats: AnalysisStats;
}
