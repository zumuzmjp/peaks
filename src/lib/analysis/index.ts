import type {
  AnalysisOptions,
  AnalysisResult,
  ChatMessage,
  LoudnessSeries,
  Sensitivity,
} from "./types";
import { binChatRate, binLoudness, mean, onsetZ, robustZ, smooth } from "./series";
import { detectSpikes, dropSustainedSpikes } from "./spikes";
import { combinedScore, rankPeaks } from "./rank";

export * from "./types";
export { detectSpikes, clusterSpikes, dropSustainedSpikes } from "./spikes";
export { robustZ, onsetZ, rollingMedian, trailingMedian, binChatRate, binLoudness } from "./series";
export { combinedScore, scaleScore, rankPeaks } from "./rank";

export const DEFAULT_OPTIONS: AnalysisOptions = {
  binSeconds: 10,
  baselineWindowSeconds: 600,
  audioBaselineSeconds: 60,
  audioStepSeconds: 2,
  chatThreshold: 2.5,
  audioThreshold: 2.2,
  minChatPerMin: 24,
  mergeGapSeconds: 45,
  maxPeaks: 40,
  minClipSeconds: 20,
  maxClipSeconds: 60,
};

/** Threshold presets exposed in the UI. */
export function optionsForSensitivity(level: Sensitivity, base: Partial<AnalysisOptions> = {}): AnalysisOptions {
  const presets: Record<Sensitivity, Partial<AnalysisOptions>> = {
    low: { chatThreshold: 3.5, audioThreshold: 3.0, maxPeaks: 25 },
    medium: { chatThreshold: 2.5, audioThreshold: 2.2, maxPeaks: 40 },
    high: { chatThreshold: 1.8, audioThreshold: 1.6, maxPeaks: 60 },
  };
  return { ...DEFAULT_OPTIONS, ...presets[level], ...base };
}

export interface AnalyzeInput {
  durationSeconds: number;
  chat: ChatMessage[];
  loudness: LoudnessSeries;
  options?: Partial<AnalysisOptions>;
}

/**
 * Full pipeline: bin both signals, compute robust z-scores against a rolling
 * baseline, detect spikes in each, then cluster and rank them into peaks.
 */
export function analyze(input: AnalyzeInput): AnalysisResult {
  const options: AnalysisOptions = { ...DEFAULT_OPTIONS, ...input.options };
  const { durationSeconds } = input;
  const bin = options.binSeconds;
  const windowBins = Math.max(5, Math.round(options.baselineWindowSeconds / bin));

  const messages = input.chat.slice().sort((a, b) => a.t - b.t);

  const chatRate = binChatRate(messages, durationSeconds, bin);
  const audioDb = binLoudness(input.loudness, durationSeconds, bin);

  // Chat counts are noisy; a light smoothing pass keeps single-bin flukes
  // from registering while preserving real bursts (which span several bins).
  const chatSmoothed = smooth(chatRate, 1);

  const chat = robustZ(chatSmoothed, {
    windowBins,
    scaleFloorFraction: 0.2,
    // At least ~3 msg/min of spread so near-silent chats don't trigger on one message.
    scaleFloorAbsolute: 3,
  });
  // Loudness shifts level between stream phases (menus, gameplay, breaks),
  // so each slice is compared with the level just before it rather than a
  // long centred baseline, which would blur real jumps into the phase mix.
  // Jumps are measured on short slices (screams last seconds, not tens of
  // seconds) and each bin keeps its loudest slice.
  const step = Math.min(bin, Math.max(input.loudness.stepSeconds, options.audioStepSeconds));
  const fineDb = binLoudness(input.loudness, durationSeconds, step);
  const fine = onsetZ(fineDb, {
    baselineBins: Math.max(3, Math.round(options.audioBaselineSeconds / step)),
    scaleWindowBins: Math.max(5, Math.round(options.baselineWindowSeconds / step)),
    // Loudness routinely wobbles by a dB or so; ignore anything smaller. The
    // cap keeps a noisy mix (gunfire, music) from hiding a genuine +7 dB jump.
    scaleFloorAbsolute: 1.5,
    scaleCapAbsolute: 3,
  });
  const audio = maxPerBin(fine, fineDb, audioDb.length, step, bin);

  const combined = chat.z.map((cz, i) =>
    combinedScore(chatSmoothed[i] >= options.minChatPerMin ? cz : Math.min(cz, options.chatThreshold), audio.z[i], options.chatThreshold, options.audioThreshold)
  );

  // A z-score alone can't tell a burst from three messages in a dead chat;
  // bins below the absolute rate floor are held under the threshold.
  const chatZGated = chat.z.map((z, i) => (chatSmoothed[i] >= options.minChatPerMin ? z : Math.min(z, options.chatThreshold)));
  const chatSpikes = detectSpikes(chatZGated, "chat", { threshold: options.chatThreshold, mergeGapBins: 1 });
  const audioSpikes = dropSustainedSpikes(
    detectSpikes(audio.z, "audio", { threshold: options.audioThreshold, mergeGapBins: 1 }),
    audio.peakDb
  );

  const peaks = rankPeaks({
    durationSeconds,
    options,
    chatRate,
    chatBaseline: chat.baseline,
    audioDb,
    audioPeakDb: audio.peakDb,
    audioBaseline: audio.baseline,
    chatZ: chat.z,
    audioZ: audio.z,
    combined,
    spikes: [...chatSpikes, ...audioSpikes],
    messages,
  });

  const stats = {
    totalMessages: messages.length,
    avgChatPerMin: round(mean(chatRate), 1),
    peakChatPerMin: round(Math.max(0, ...chatRate), 1),
    avgLoudnessDb: round(mean(audioDb), 1),
    peakLoudnessDb: round(Math.max(-120, ...audioDb), 1),
    chatSpikes: chatSpikes.length,
    audioSpikes: audioSpikes.length,
    bothCount: peaks.filter((p) => p.reason === "both").length,
    chatOnlyCount: peaks.filter((p) => p.reason === "chat").length,
    audioOnlyCount: peaks.filter((p) => p.reason === "audio").length,
  };

  return {
    durationSeconds,
    options,
    series: {
      binSeconds: bin,
      chatRate: chatRate.map((v) => round(v, 1)),
      audioDb: audioDb.map((v) => round(v, 1)),
      audioPeakDb: audio.peakDb.map((v) => round(v, 1)),
      chatZ: chat.z.map((v) => round(v, 2)),
      audioZ: audio.z.map((v) => round(v, 2)),
      combined: combined.map((v) => round(v, 2)),
    },
    peaks,
    stats,
  };
}

/**
 * Collapses fine-resolution audio z-scores to one value per analysis bin: the
 * loudest slice wins, and the baseline reported for the bin is the level that
 * slice was compared against.
 */
function maxPerBin(
  fine: { z: number[]; baseline: number[] },
  fineDb: number[],
  bins: number,
  step: number,
  bin: number
): { z: number[]; baseline: number[]; peakDb: number[] } {
  const z = new Array<number>(bins).fill(-Infinity);
  const baseline = new Array<number>(bins).fill(0);
  const peakDb = new Array<number>(bins).fill(-Infinity);
  for (let i = 0; i < fine.z.length; i++) {
    const b = Math.min(bins - 1, Math.floor((i * step) / bin));
    if (fine.z[i] > z[b]) {
      z[b] = fine.z[i];
      baseline[b] = fine.baseline[i];
    }
    if (fineDb[i] > peakDb[b]) peakDb[b] = fineDb[i];
  }
  let lastBaseline = fine.baseline[0] ?? -60;
  let lastPeak = fineDb[0] ?? -60;
  for (let b = 0; b < bins; b++) {
    if (z[b] === -Infinity) {
      z[b] = 0;
      baseline[b] = lastBaseline;
      peakDb[b] = lastPeak;
    }
    lastBaseline = baseline[b];
    lastPeak = peakDb[b];
  }
  return { z, baseline, peakDb };
}

function round(v: number, digits: number): number {
  if (!isFinite(v)) return 0;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
