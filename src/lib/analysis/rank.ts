import type { AnalysisOptions, ChatMessage, Peak, PeakReason, Spike, SpikeSource } from "./types";
import { clusterSpikes } from "./spikes";
import { pickSnippets, topTerms } from "./text";

const Z_CAP = 10;
/** Audio jump must land within this many bins of the chat onset to count as the same moment. */
const NEAR_BINS = 3;
const SCORE_SCALE = 5.5;

function cap(z: number): number {
  return Math.max(0, Math.min(Z_CAP, z));
}

/**
 * Combined per-bin score. Chat and audio z-scores are capped and summed, and
 * bins where both sources are elevated get a synergy bonus, because moments
 * that both the audience and the streamer react to are the safest clips.
 */
export function combinedScore(chatZ: number, audioZ: number, chatThreshold: number, audioThreshold: number): number {
  const c = cap(chatZ);
  const a = cap(audioZ);
  const both = chatZ > chatThreshold && audioZ > audioThreshold;
  const synergy = both ? Math.min(c, a) * 0.6 : 0;
  return c * 1.0 + a * 0.85 + synergy;
}

/** Maps an unbounded combined score to 0-100 with diminishing returns. */
export function scaleScore(combined: number): number {
  const s = 100 * (1 - Math.exp(-combined / SCORE_SCALE));
  return Math.round(Math.max(0, Math.min(100, s)));
}

export function reasonFor(sources: SpikeSource[]): PeakReason {
  const hasChat = sources.includes("chat");
  const hasAudio = sources.includes("audio");
  if (hasChat && hasAudio) return "both";
  return hasChat ? "chat" : "audio";
}

function formatMultiplier(x: number): string {
  if (!isFinite(x) || x <= 0) return "";
  return x >= 10 ? `${Math.round(x)}×` : `${x.toFixed(1)}×`;
}

export function buildHeadline(p: {
  reason: PeakReason;
  chatMultiplier: number;
  chatRatePerMin: number;
  loudnessDeltaDb: number;
  topTerms: string[];
}): string {
  const chatPart =
    p.chatMultiplier >= 1.5
      ? p.chatMultiplier >= 20
        ? `Chat went from quiet to ${Math.round(p.chatRatePerMin)} msg/min`
        : `Chat surged ${formatMultiplier(p.chatMultiplier)} above baseline (${Math.round(p.chatRatePerMin)} msg/min)`
      : null;
  const audioPart =
    p.loudnessDeltaDb >= 2 ? `audio jumped +${p.loudnessDeltaDb.toFixed(1)} dB` : null;
  const terms = p.topTerms.length ? ` — chat: ${p.topTerms.slice(0, 3).join(", ")}` : "";

  if (p.reason === "both") {
    return `${chatPart ?? "Chat spiked"} while ${audioPart ?? "the streamer got loud"}${terms}`;
  }
  if (p.reason === "chat") {
    return `${chatPart ?? "Chat spiked"} with no matching audio spike${terms}`;
  }
  return `${audioPart ? audioPart[0].toUpperCase() + audioPart.slice(1) : "Audio spiked"} with chat near baseline${terms}`;
}

export interface RankInput {
  durationSeconds: number;
  options: AnalysisOptions;
  chatRate: number[];
  chatBaseline: number[];
  /** Mean loudness per bin (timeline) and the loudest slice per bin (jump size). */
  audioDb: number[];
  audioPeakDb: number[];
  audioBaseline: number[];
  chatZ: number[];
  audioZ: number[];
  combined: number[];
  spikes: Spike[];
  /** Messages sorted by time. */
  messages: ChatMessage[];
}

function messagesBetween(sorted: ChatMessage[], from: number, to: number): ChatMessage[] {
  // Binary search for the first message >= from.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].t < from) lo = mid + 1;
    else hi = mid;
  }
  const out: ChatMessage[] = [];
  for (let i = lo; i < sorted.length && sorted[i].t <= to; i++) out.push(sorted[i]);
  return out;
}

/**
 * Clusters chat and audio spikes into peaks, scores them, and attaches the
 * context an editor needs (chat snippets, loudness sparkline, in/out points).
 */
export function rankPeaks(input: RankInput): Peak[] {
  const { options, durationSeconds } = input;
  const bin = options.binSeconds;
  const gapBins = Math.max(0, Math.round(options.mergeGapSeconds / bin) - 1);
  const clusters = clusterSpikes(input.spikes, gapBins);

  const peaks: Peak[] = clusters.map((cluster, idx) => {
    const startBin = Math.min(...cluster.map((s) => s.startBin));
    const endBin = Math.max(...cluster.map((s) => s.endBin));

    // Strongest moment inside the cluster by combined score.
    let peakBin = startBin;
    let best = -Infinity;
    for (let b = startBin; b <= endBin; b++) {
      if (input.combined[b] > best) {
        best = input.combined[b];
        peakBin = b;
      }
    }

    // Anchor on the onset of the reaction rather than its maximum: chat
    // keeps climbing for a while after the moment, audio reacts instantly.
    const strongest = (source: SpikeSource): Spike | undefined =>
      cluster
        .filter((s) => s.source === source)
        .sort((a, b) => b.peakZ - a.peakZ || a.startBin - b.startBin)[0];
    let chatSpike = strongest("chat");
    let audioSpike = strongest("audio");

    // Two different moments can share a cluster when they fall within the
    // merge gap. Only call it "both" when the audio jump sits at the chat
    // onset; otherwise keep the stronger reaction relative to its threshold.
    if (chatSpike && audioSpike) {
      const near = Math.abs(audioSpike.peakBin - chatSpike.startBin) <= NEAR_BINS;
      if (!near) {
        const chatStrength = chatSpike.peakZ / options.chatThreshold;
        const audioStrength = audioSpike.peakZ / options.audioThreshold;
        if (chatStrength >= audioStrength) audioSpike = undefined;
        else chatSpike = undefined;
      }
    }
    const sources = [chatSpike && "chat", audioSpike && "audio"].filter(Boolean).sort() as SpikeSource[];
    const reason = reasonFor(sources);

    const chatOnsetBin = chatSpike ? chatSpike.startBin : Infinity;
    const audioPeakBin = audioSpike ? audioSpike.peakBin : Infinity;
    const anchorBin = Math.max(0, Math.min(chatOnsetBin, audioPeakBin));
    const time = anchorBin * bin + bin / 2;

    const windowStart = startBin * bin;
    const windowEnd = Math.min(durationSeconds, (endBin + 1) * bin);

    // Suggested clip: lead in before the reaction, run out after it settles.
    const preroll = reason === "audio" ? 8 : 12;
    let suggestedIn = Math.max(0, time - preroll);
    let suggestedOut = Math.min(durationSeconds, Math.max(windowEnd + 6, time + 15));
    if (suggestedOut - suggestedIn > options.maxClipSeconds) {
      // Keep the moment roughly a third of the way in.
      suggestedIn = Math.max(0, time - options.maxClipSeconds * 0.35);
      suggestedOut = Math.min(durationSeconds, suggestedIn + options.maxClipSeconds);
    }
    if (suggestedOut - suggestedIn < options.minClipSeconds) {
      const missing = options.minClipSeconds - (suggestedOut - suggestedIn);
      suggestedIn = Math.max(0, suggestedIn - missing / 2);
      suggestedOut = Math.min(durationSeconds, suggestedIn + options.minClipSeconds);
    }

    // Report chat at the strongest chat bin of the moment, not wherever the
    // combined score happened to peak.
    const chatBin = chatSpike ? chatSpike.peakBin : peakBin;
    const chatRatePerMin = input.chatRate[chatBin];
    const chatBaselinePerMin = input.chatBaseline[chatBin];
    const chatMultiplier = chatBaselinePerMin > 0.5 ? chatRatePerMin / chatBaselinePerMin : chatRatePerMin > 0 ? 99 : 1;

    let loudnessDb = -Infinity;
    let loudBin = anchorBin;
    for (let b = startBin; b <= endBin; b++) {
      if (input.audioPeakDb[b] > loudnessDb) {
        loudnessDb = input.audioPeakDb[b];
        loudBin = b;
      }
    }
    const loudnessBaselineDb = input.audioBaseline[loudBin];
    const loudnessDeltaDb = loudnessDb - loudnessBaselineDb;

    const contextSeconds = 60;
    const sparkStartBin = Math.max(0, startBin - Math.round(contextSeconds / bin));
    const sparkEndBin = Math.min(input.audioDb.length - 1, endBin + Math.round(contextSeconds / bin));
    const sparkDb = input.audioDb.slice(sparkStartBin, sparkEndBin + 1);
    const sparkChat = input.chatRate.slice(sparkStartBin, sparkEndBin + 1);

    const windowMessages = messagesBetween(input.messages, Math.max(0, time - 20), time + 25);
    const terms = topTerms(windowMessages, 5);
    const snippets = pickSnippets(windowMessages, 10);

    const score = scaleScore(best);
    const headline = buildHeadline({ reason, chatMultiplier, chatRatePerMin, loudnessDeltaDb, topTerms: terms });

    return {
      id: `p${idx + 1}`,
      rank: 0,
      time,
      windowStart,
      windowEnd,
      suggestedIn: Math.round(suggestedIn),
      suggestedOut: Math.round(suggestedOut),
      score,
      reason,
      sources,
      chatZ: round(chatSpike ? chatSpike.peakZ : Math.max(...cluster.map((s) => (s.source === "chat" ? s.peakZ : 0)), input.chatZ[peakBin]), 2),
      audioZ: round(audioSpike ? audioSpike.peakZ : Math.max(...cluster.map((s) => (s.source === "audio" ? s.peakZ : 0)), input.audioZ[peakBin]), 2),
      chatRatePerMin: round(chatRatePerMin, 1),
      chatBaselinePerMin: round(chatBaselinePerMin, 1),
      chatMultiplier: round(chatMultiplier, 2),
      loudnessDb: round(loudnessDb, 1),
      loudnessBaselineDb: round(loudnessBaselineDb, 1),
      loudnessDeltaDb: round(loudnessDeltaDb, 1),
      chatSnippets: snippets,
      topTerms: terms,
      loudnessSparkline: {
        startTime: sparkStartBin * bin,
        binSeconds: bin,
        db: sparkDb.map((v) => round(v, 1)),
      },
      chatSparkline: sparkChat.map((v) => round(v, 1)),
      headline,
    };
  });

  peaks.sort((a, b) => b.score - a.score || a.time - b.time);
  const limited = peaks.slice(0, options.maxPeaks);
  limited.forEach((p, i) => {
    p.rank = i + 1;
    p.id = `p${i + 1}`;
  });
  return limited;
}

function round(v: number, digits: number): number {
  if (!isFinite(v)) return 0;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
