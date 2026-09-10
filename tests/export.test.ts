import { describe, expect, it } from "vitest";
import { analyze, optionsForSensitivity } from "@/lib/analysis";
import { generateDemoStream } from "@/lib/demo/fixture";
import { CSV_COLUMNS, peaksToCsv, peaksToJson, peaksToText } from "@/lib/export";
import { applyFilters, DEFAULT_FILTERS, parseTimeInput } from "@/lib/filters";
import { parseStreamUrl } from "@/lib/url";

const stream = generateDemoStream("export-test");
const result = analyze({ durationSeconds: stream.durationSeconds, chat: stream.chat, loudness: stream.loudness, options: optionsForSensitivity("medium") });
const source = parseStreamUrl("https://www.twitch.tv/videos/123456");

describe("CSV export", () => {
  it("writes a header and one row per peak with deep links", () => {
    const csv = peaksToCsv(result.peaks, { source });
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(result.peaks.length + 1);
    expect(lines[1]).toContain("https://www.twitch.tv/videos/123456?t=");
  });
  it("quotes fields containing commas or quotes", () => {
    const peak = { ...result.peaks[0], headline: 'Chat said "clip it", twice' };
    const csv = peaksToCsv([peak]);
    expect(csv).toContain('"Chat said ""clip it"", twice"');
  });
});

describe("JSON and text export", () => {
  it("includes source, stats and formatted timestamps", () => {
    const json = JSON.parse(peaksToJson(result, result.peaks.slice(0, 3), { source, title: "T", channel: "C" }));
    expect(json.generator).toBe("PEAKS");
    expect(json.source).toMatchObject({ platform: "twitch", title: "T", channel: "C", durationSeconds: result.durationSeconds });
    expect(json.peaks).toHaveLength(3);
    expect(json.peaks[0].timeFormatted).toMatch(/^\d+:\d\d:\d\d$/);
    expect(json.stats.totalMessages).toBe(stream.chat.length);
  });
  it("renders a compact text list", () => {
    const text = peaksToText(result.peaks.slice(0, 2), { source });
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toMatch(/^#1 \[\d+\] \d+:\d\d:\d\d/);
  });
});

describe("filters", () => {
  it("filters by reason, score, range and query, and sorts", () => {
    const all = applyFilters(result.peaks, DEFAULT_FILTERS);
    expect(all).toHaveLength(result.peaks.length);
    for (let i = 1; i < all.length; i++) expect(all[i - 1].score).toBeGreaterThanOrEqual(all[i].score);

    const chatOnly = applyFilters(result.peaks, { ...DEFAULT_FILTERS, reasons: { both: false, chat: true, audio: false } });
    expect(chatOnly.every((p) => p.reason === "chat")).toBe(true);

    const strong = applyFilters(result.peaks, { ...DEFAULT_FILTERS, minScore: 80 });
    expect(strong.every((p) => p.score >= 80)).toBe(true);

    const firstHour = applyFilters(result.peaks, { ...DEFAULT_FILTERS, from: 0, to: 3600, sort: "time" });
    expect(firstHour.every((p) => p.time <= 3600)).toBe(true);
    for (let i = 1; i < firstHour.length; i++) expect(firstHour[i - 1].time).toBeLessThanOrEqual(firstHour[i].time);

    const clutch = applyFilters(result.peaks, { ...DEFAULT_FILTERS, query: "clutch" });
    expect(clutch.length).toBeGreaterThan(0);
    expect(clutch.length).toBeLessThan(result.peaks.length);
  });
  it("parses time inputs", () => {
    expect(parseTimeInput("1:02:03")).toBe(3723);
    expect(parseTimeInput("62:03")).toBe(3723);
    expect(parseTimeInput("3723")).toBe(3723);
    expect(parseTimeInput("1h2m3s")).toBe(3723);
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput("nope")).toBeNull();
  });
});
