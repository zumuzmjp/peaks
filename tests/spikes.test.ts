import { describe, expect, it } from "vitest";
import { clusterSpikes, detectSpikes, dropSustainedSpikes } from "@/lib/analysis/spikes";
import { binChatRate, binLoudness, onsetZ, robustZ, rollingMedian, trailingMedian } from "@/lib/analysis/series";
import { combinedScore, scaleScore } from "@/lib/analysis/rank";
import { analyze } from "@/lib/analysis";
import type { ChatMessage, Spike } from "@/lib/analysis/types";

describe("rollingMedian", () => {
  it("returns the median of a centred window", () => {
    expect(rollingMedian([1, 1, 1, 100, 1, 1, 1], 3)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(rollingMedian([5], 3)).toEqual([5]);
    expect(rollingMedian([], 3)).toEqual([]);
  });
  it("tracks a slow trend", () => {
    const values = Array.from({ length: 50 }, (_, i) => i);
    const med = rollingMedian(values, 5);
    expect(med[25]).toBe(25);
    expect(med[0]).toBe(1); // window [0,1,2]
  });
});

describe("robustZ", () => {
  it("is near zero on a flat series and large on an outlier", () => {
    const values = new Array(200).fill(10).map((v, i) => v + (i % 3) - 1);
    values[100] = 60;
    const { z } = robustZ(values, { windowBins: 30 });
    expect(Math.abs(z[10])).toBeLessThan(1.5);
    expect(z[100]).toBeGreaterThan(5);
  });
  it("does not explode on perfectly flat data", () => {
    const values = new Array(100).fill(0);
    values[50] = 1;
    const { z } = robustZ(values, { windowBins: 20, scaleFloorAbsolute: 3 });
    expect(z[50]).toBeCloseTo(1 / 3, 2);
  });
});

describe("detectSpikes", () => {
  it("finds contiguous runs above threshold", () => {
    const z = [0, 0, 3, 4, 3, 0, 0, 0, 5, 0];
    const spikes = detectSpikes(z, "chat", { threshold: 2.5, mergeGapBins: 0 });
    expect(spikes).toHaveLength(2);
    expect(spikes[0]).toMatchObject({ startBin: 2, endBin: 4, peakBin: 3, peakZ: 4 });
    expect(spikes[1]).toMatchObject({ startBin: 8, endBin: 8, peakBin: 8, peakZ: 5 });
  });
  it("merges runs separated by a small gap", () => {
    const z = [0, 3, 0, 3, 0, 0, 0, 3];
    const spikes = detectSpikes(z, "audio", { threshold: 2.5, mergeGapBins: 1 });
    expect(spikes).toHaveLength(2);
    expect(spikes[0]).toMatchObject({ startBin: 1, endBin: 3 });
    expect(spikes[1]).toMatchObject({ startBin: 7, endBin: 7 });
  });
  it("respects minBins", () => {
    const z = [0, 3, 0, 0, 3, 3, 0];
    const spikes = detectSpikes(z, "chat", { threshold: 2.5, mergeGapBins: 0, minBins: 2 });
    expect(spikes).toHaveLength(1);
    expect(spikes[0].startBin).toBe(4);
  });
  it("returns nothing when nothing exceeds threshold", () => {
    expect(detectSpikes([0, 1, 2, 1, 0], "chat", { threshold: 2.5 })).toEqual([]);
  });
});

describe("clusterSpikes", () => {
  it("groups overlapping chat and audio spikes", () => {
    const clusters = clusterSpikes(
      [
        { source: "chat", startBin: 10, endBin: 12, peakBin: 11, peakZ: 4, area: 3 },
        { source: "audio", startBin: 11, endBin: 11, peakBin: 11, peakZ: 3, area: 1 },
        { source: "audio", startBin: 40, endBin: 41, peakBin: 40, peakZ: 3, area: 1 },
      ],
      2
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0].map((s) => s.source).sort()).toEqual(["audio", "chat"]);
    expect(clusters[1][0].startBin).toBe(40);
  });
});

describe("scoring", () => {
  it("rewards moments where both signals fire", () => {
    const both = combinedScore(4, 4, 2.5, 2.2);
    const chatOnly = combinedScore(4, 0, 2.5, 2.2);
    const audioOnly = combinedScore(0, 4, 2.5, 2.2);
    expect(both).toBeGreaterThan(chatOnly + audioOnly);
    expect(chatOnly).toBeGreaterThan(audioOnly);
  });
  it("maps to 0-100 with diminishing returns", () => {
    expect(scaleScore(0)).toBe(0);
    expect(scaleScore(5)).toBeGreaterThan(50);
    expect(scaleScore(30)).toBeLessThanOrEqual(100);
    expect(scaleScore(10)).toBeGreaterThan(scaleScore(5));
  });
});

describe("binning", () => {
  it("bins chat into messages per minute", () => {
    const chat: ChatMessage[] = [
      { t: 1, author: "a", text: "x" },
      { t: 2, author: "b", text: "y" },
      { t: 15, author: "c", text: "z" },
    ];
    const rate = binChatRate(chat, 30, 10);
    expect(rate).toEqual([12, 6, 0]);
  });
  it("averages loudness in the power domain", () => {
    const db = [-20, -20, -20, -20, -20, -20, -20, -20, -20, -20, -60, -60, -60, -60, -60, -60, -60, -60, -60, -6];
    const binned = binLoudness({ stepSeconds: 1, db }, 20, 10);
    expect(binned[0]).toBeCloseTo(-20, 5);
    // One loud second dominates the mean power of an otherwise quiet bin.
    expect(binned[1]).toBeGreaterThan(-20);
  });
});

describe("analyze (synthetic)", () => {
  function syntheticStream() {
    const duration = 3600;
    const chat: ChatMessage[] = [];
    const db: number[] = [];
    // Baseline: ~30 msg/min = 0.5/s, deterministic spacing. Loudness -25 dB with small ripple.
    for (let t = 0; t < duration; t++) {
      if (t % 2 === 0) chat.push({ t, author: `u${t % 17}`, text: "hello" });
      db.push(-25 + ((t * 7919) % 13) / 10 - 0.6);
    }
    // Event A at 20:00 — both chat and audio.
    for (let t = 1200; t < 1240; t++) {
      for (let k = 0; k < 6; k++) chat.push({ t: t + k / 6, author: `h${k}`, text: "LETS GO CLIP IT" });
      if (t < 1215) db[t] = -12;
    }
    // Event B at 40:00 — chat only.
    for (let t = 2400; t < 2440; t++) {
      for (let k = 0; k < 5; k++) chat.push({ t: t + k / 5, author: `c${k}`, text: "KEKW" });
    }
    // Event C at 50:00 — audio only.
    for (let t = 3000; t < 3010; t++) db[t] = -10;
    return { duration, chat, db };
  }

  it("detects planted events with the right reasons", () => {
    const { duration, chat, db } = syntheticStream();
    const result = analyze({ durationSeconds: duration, chat, loudness: { stepSeconds: 1, db } });
    const near = (t: number) => result.peaks.find((p) => Math.abs(p.time - t) <= 30);

    const a = near(1210);
    const b = near(2410);
    const c = near(3005);
    expect(a?.reason).toBe("both");
    expect(b?.reason).toBe("chat");
    expect(c?.reason).toBe("audio");
    // Both-signal moment ranks first.
    expect(result.peaks[0].id).toBe(a?.id);
    // No false positives in quiet regions.
    for (const p of result.peaks) {
      expect([1210, 2410, 3005].some((t) => Math.abs(p.time - t) <= 40)).toBe(true);
    }
  });

  it("produces sane clip suggestions", () => {
    const { duration, chat, db } = syntheticStream();
    const result = analyze({ durationSeconds: duration, chat, loudness: { stepSeconds: 1, db } });
    for (const p of result.peaks) {
      const len = p.suggestedOut - p.suggestedIn;
      expect(len).toBeGreaterThanOrEqual(result.options.minClipSeconds);
      expect(len).toBeLessThanOrEqual(result.options.maxClipSeconds);
      expect(p.suggestedIn).toBeLessThanOrEqual(p.time);
      expect(p.suggestedOut).toBeGreaterThanOrEqual(p.time);
      expect(p.score).toBeGreaterThan(0);
      expect(p.score).toBeLessThanOrEqual(100);
    }
  });

  it("returns ranks in descending score order", () => {
    const { duration, chat, db } = syntheticStream();
    const result = analyze({ durationSeconds: duration, chat, loudness: { stepSeconds: 1, db } });
    for (let i = 1; i < result.peaks.length; i++) {
      expect(result.peaks[i - 1].score).toBeGreaterThanOrEqual(result.peaks[i].score);
      expect(result.peaks[i].rank).toBe(i + 1);
    }
  });
});

describe("onset detection (audio)", () => {
  it("trailingMedian uses only earlier values", () => {
    expect(trailingMedian([1, 2, 3, 100, 100, 100], 3)).toEqual([1, 1, 1.5, 2, 3, 100]);
    expect(trailingMedian([], 3)).toEqual([]);
  });
  it("onsetZ flags a jump above the local level but not a plateau", () => {
    const values = new Array(120).fill(-24).map((v, i) => v + ((i * 7) % 3) * 0.3);
    values[60] = -12; // +12 dB burst
    for (let i = 90; i < 120; i++) values[i] = -17; // sustained level change
    const { z } = onsetZ(values, { baselineBins: 6, scaleWindowBins: 60, scaleFloorAbsolute: 1.5, scaleCapAbsolute: 3 });
    expect(z[60]).toBeGreaterThan(3);
    expect(z[90]).toBeGreaterThan(2);
    expect(z[100]).toBeLessThan(1); // baseline has caught up with the new level
  });
  it("dropSustainedSpikes removes level changes and keeps transients", () => {
    const db = new Array(60).fill(-24);
    for (let i = 20; i < 22; i++) db[i] = -12; // transient
    for (let i = 40; i < 60; i++) db[i] = -14; // step up that stays
    const spikes: Spike[] = [
      { source: "audio", startBin: 20, endBin: 21, peakBin: 20, peakZ: 4, area: 3 },
      { source: "audio", startBin: 40, endBin: 43, peakBin: 40, peakZ: 3.5, area: 3 },
    ];
    const kept = dropSustainedSpikes(spikes, db);
    expect(kept.map((s) => s.startBin)).toEqual([20]);
  });
});

describe("anchoring", () => {
  it("anchors a long chat flood at its onset, not its maximum", () => {
    const duration = 3600;
    const chat: ChatMessage[] = [];
    const db: number[] = [];
    for (let t = 0; t < duration; t++) {
      if (t % 2 === 0) chat.push({ t, author: `u${t % 17}`, text: "hello" });
      db.push(-25 + ((t * 7919) % 13) / 10 - 0.6);
    }
    // Chat ramps up from 1800 and keeps growing for 90 s; the moment is at 1800.
    for (let t = 1800; t < 1890; t++) {
      const per = 2 + Math.floor((t - 1800) / 15);
      for (let k = 0; k < per; k++) chat.push({ t: t + k / per, author: `h${k}`, text: "LETS GO" });
    }
    const result = analyze({ durationSeconds: duration, chat, loudness: { stepSeconds: 1, db } });
    const top = result.peaks[0];
    expect(Math.abs(top.time - 1800)).toBeLessThanOrEqual(20);
    expect(top.suggestedIn).toBeLessThan(1800);
  });
});
