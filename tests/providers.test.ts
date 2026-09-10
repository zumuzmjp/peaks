import { describe, expect, it } from "vitest";
import { LoudnessAccumulator, parseEbur128Line } from "@/lib/providers/loudness";
import { parseYouTubeChatFile, parseYouTubeChatLine } from "@/lib/providers/youtubeChat";
import { parseTwitchCommentsResponse } from "@/lib/providers/twitchChat";

describe("ffmpeg ebur128 parsing", () => {
  it("parses momentary loudness lines", () => {
    const line = "[Parsed_ebur128_0 @ 0x55d] t: 12.3       TARGET:-23 LUFS    M: -20.1 S: -21.0     I: -22.3 LUFS       LRA:   1.2 LU";
    expect(parseEbur128Line(line)).toEqual({ t: 12.3, momentary: -20.1 });
  });
  it("treats -inf and nan as silence and ignores other lines", () => {
    expect(parseEbur128Line("t: 0.1 TARGET:-23 LUFS M: -inf S: -inf I: -inf LUFS LRA: 0.0 LU")?.momentary).toBe(-90);
    expect(parseEbur128Line("t: 0.2 TARGET:-23 LUFS M: nan S: nan I: nan LUFS LRA: 0.0 LU")?.momentary).toBe(-90);
    expect(parseEbur128Line("Stream #0:0: Audio: aac")).toBeNull();
  });
  it("accumulates into a 1-second series in the power domain", () => {
    const acc = new LoudnessAccumulator();
    for (let i = 0; i < 10; i++) acc.add(0.1 * i, -30);
    for (let i = 0; i < 10; i++) acc.add(1 + 0.1 * i, i === 0 ? -10 : -40);
    const series = acc.toSeries(4);
    expect(series.stepSeconds).toBe(1);
    expect(series.db).toHaveLength(4);
    expect(series.db[0]).toBeCloseTo(-30, 1);
    expect(series.db[1]).toBeGreaterThan(-25); // one loud sample dominates
    expect(series.db[3]).toBe(series.db[1]); // missing seconds hold the last value
  });
});

describe("YouTube live chat parsing", () => {
  const msg = JSON.stringify({
    replayChatItemAction: {
      actions: [
        {
          addChatItemAction: {
            item: {
              liveChatTextMessageRenderer: {
                message: { runs: [{ text: "that was " }, { emoji: { emojiId: "🔥", shortcuts: [":fire:"] } }] },
                authorName: { simpleText: "@Viewer One" },
              },
            },
          },
        },
      ],
      videoOffsetTimeMsec: "61500",
    },
  });
  const system = JSON.stringify({
    replayChatItemAction: {
      actions: [{ addChatItemAction: { item: { liveChatViewerEngagementMessageRenderer: { message: { runs: [{ text: "Live chat replay is on." }] } } } } }],
      videoOffsetTimeMsec: "0",
    },
  });
  it("extracts offset, author and text with emoji shortcuts", () => {
    expect(parseYouTubeChatLine(msg)).toEqual({ t: 61.5, author: "Viewer One", text: "that was :fire:" });
  });
  it("skips system messages and garbage", () => {
    expect(parseYouTubeChatLine(system)).toBeNull();
    expect(parseYouTubeChatLine("{not json")).toBeNull();
    expect(parseYouTubeChatFile(`${system}\n${msg}\n\n${msg}`)).toHaveLength(2);
  });
});

describe("Twitch comments parsing", () => {
  const body = [
    {
      data: {
        video: {
          id: "123",
          comments: {
            edges: [
              { cursor: "c1", node: { id: "a", commenter: { login: "user1", displayName: "User1" }, contentOffsetSeconds: 591, message: { fragments: [{ text: "@x he " }, { text: "did it" }] } } },
              { cursor: "c2", node: { id: "b", commenter: null, contentOffsetSeconds: 592, message: { fragments: [{ text: "ClassiC" }] } } },
              { cursor: "c3", node: { id: "c", commenter: { login: "u" }, contentOffsetSeconds: 593, message: { fragments: [] } } },
            ],
            pageInfo: { hasNextPage: true },
          },
        },
      },
    },
  ];
  it("maps edges to messages and tracks the cursor", () => {
    const page = parseTwitchCommentsResponse(body);
    expect(page.messages).toEqual([
      { t: 591, author: "User1", text: "@x he did it" },
      { t: 592, author: "unknown", text: "ClassiC" },
    ]);
    expect(page.ids).toEqual(["a", "b"]);
    expect(page.cursor).toBe("c3");
    expect(page.hasNextPage).toBe(true);
    expect(page.lastOffset).toBe(592);
  });
  it("throws a readable error when the video is missing", () => {
    expect(() => parseTwitchCommentsResponse([{ data: { video: null } }])).toThrow(/no video/);
    expect(() => parseTwitchCommentsResponse([{ errors: [{ message: "PersistedQueryNotFound" }] }])).toThrow(/PersistedQueryNotFound/);
  });
});
