import { describe, expect, it } from "vitest";
import { generateDemoStream } from "@/lib/demo/fixture";
import { analyze, optionsForSensitivity } from "@/lib/analysis";

describe("demo fixture", () => {
  const stream = generateDemoStream("test-seed");

  it("is deterministic for a given seed", () => {
    const again = generateDemoStream("test-seed");
    expect(again.chat.length).toBe(stream.chat.length);
    expect(again.loudness.db.slice(0, 50)).toEqual(stream.loudness.db.slice(0, 50));
    expect(again.chat[123]).toEqual(stream.chat[123]);
  });

  it("looks like a multi-hour stream", () => {
    expect(stream.durationSeconds).toBeGreaterThan(3 * 3600);
    expect(stream.chat.length).toBeGreaterThan(8000);
    expect(stream.loudness.db.length).toBe(stream.durationSeconds);
    expect(stream.events.length).toBeGreaterThanOrEqual(12);
  });

  it("keeps the break window clear of planted events", () => {
    for (const ev of stream.events) {
      expect(ev.time < 90 * 60 || ev.time > 98 * 60).toBe(true);
    }
  });

  it("recovers the planted events with the expected reasons", () => {
    const result = analyze({
      durationSeconds: stream.durationSeconds,
      chat: stream.chat,
      loudness: stream.loudness,
      options: optionsForSensitivity("medium"),
    });

    const tolerance = 45;
    let found = 0;
    let reasonMatches = 0;
    for (const ev of stream.events) {
      const peak = result.peaks.find((p) => Math.abs(p.time - ev.time) <= tolerance);
      if (peak) {
        found++;
        if (peak.reason === ev.expect) reasonMatches++;
      }
    }
    // The planted events should be detected (one weak one may slip on a noisy seed)...
    expect(found).toBeGreaterThanOrEqual(stream.events.length - 1);
    // ...and the large majority should be attributed to the right signal(s).
    expect(reasonMatches / stream.events.length).toBeGreaterThanOrEqual(0.75);

    // The top peak should be one of the "both" events.
    const top = result.peaks[0];
    const topEvent = stream.events.find((ev) => Math.abs(top.time - ev.time) <= tolerance);
    expect(topEvent?.expect).toBe("both");

    // Few false positives among confident peaks: the fixture deliberately
    // includes minor fight bursts, so weak peaks may be unexplained, but
    // high-scoring ones must map to planted events.
    const confident = result.peaks.filter((p) => p.score >= 60);
    const unexplained = confident.filter(
      (p) => !stream.events.some((ev) => Math.abs(p.time - ev.time) <= tolerance + 60)
    );
    expect(confident.length).toBeGreaterThanOrEqual(8);
    expect(unexplained.length).toBeLessThanOrEqual(confident.length * 0.35);
  });
});
