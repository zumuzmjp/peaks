import { describe, expect, it } from "vitest";
import {
  detectPlatform,
  linkAtTime,
  parseStreamUrl,
  parseTimeParam,
  tryParseStreamUrl,
  UrlParseError,
} from "@/lib/url";

describe("parseTimeParam", () => {
  it("parses plain seconds", () => {
    expect(parseTimeParam("90")).toBe(90);
  });
  it("parses h/m/s notation", () => {
    expect(parseTimeParam("1h2m3s")).toBe(3723);
    expect(parseTimeParam("45m")).toBe(2700);
    expect(parseTimeParam("2h")).toBe(7200);
    expect(parseTimeParam("30s")).toBe(30);
  });
  it("rejects garbage", () => {
    expect(parseTimeParam("abc")).toBeUndefined();
    expect(parseTimeParam("")).toBeUndefined();
    expect(parseTimeParam(null)).toBeUndefined();
  });
});

describe("YouTube URLs", () => {
  const cases: Array<[string, string]> = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ?feature=share", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
  ];
  for (const [url, id] of cases) {
    it(`parses ${url.trim()}`, () => {
      const parsed = parseStreamUrl(url);
      expect(parsed.platform).toBe("youtube");
      if (parsed.platform === "youtube") {
        expect(parsed.videoId).toBe(id);
        expect(parsed.canonicalUrl).toBe(`https://www.youtube.com/watch?v=${id}`);
      }
    });
  }

  it("marks /live/ links as live", () => {
    const parsed = parseStreamUrl("https://www.youtube.com/live/dQw4w9WgXcQ");
    expect(parsed.platform === "youtube" && parsed.kind).toBe("live");
  });

  it("extracts the start offset", () => {
    const a = parseStreamUrl("https://youtu.be/dQw4w9WgXcQ?t=42");
    expect(a.platform === "youtube" && a.startSeconds).toBe(42);
    const b = parseStreamUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s");
    expect(b.platform === "youtube" && b.startSeconds).toBe(3723);
  });

  it("rejects channel and playlist pages", () => {
    expect(() => parseStreamUrl("https://www.youtube.com/@somechannel")).toThrow(UrlParseError);
    expect(() => parseStreamUrl("https://www.youtube.com/playlist?list=PL123")).toThrow(UrlParseError);
    expect(() => parseStreamUrl("https://www.youtube.com/watch?v=short")).toThrow(UrlParseError);
  });
});

describe("Twitch URLs", () => {
  it("parses VOD links", () => {
    const parsed = parseStreamUrl("https://www.twitch.tv/videos/2181234567");
    expect(parsed).toMatchObject({ platform: "twitch", kind: "vod", videoId: "2181234567" });
    expect(parsed.canonicalUrl).toBe("https://www.twitch.tv/videos/2181234567");
  });
  it("parses VOD links with a timestamp", () => {
    const parsed = parseStreamUrl("https://www.twitch.tv/videos/2181234567?t=01h02m03s");
    expect(parsed.platform === "twitch" && parsed.startSeconds).toBe(3723);
  });
  it("parses legacy channel/video links", () => {
    const parsed = parseStreamUrl("https://www.twitch.tv/somestreamer/video/123456");
    expect(parsed).toMatchObject({ platform: "twitch", kind: "vod", videoId: "123456" });
    const v = parseStreamUrl("https://www.twitch.tv/somestreamer/v/123456");
    expect(v).toMatchObject({ platform: "twitch", kind: "vod", videoId: "123456" });
  });
  it("parses channel links", () => {
    const parsed = parseStreamUrl("https://twitch.tv/SomeStreamer");
    expect(parsed).toMatchObject({ platform: "twitch", kind: "channel", channel: "somestreamer" });
  });
  it("parses mobile links", () => {
    const parsed = parseStreamUrl("https://m.twitch.tv/videos/2181234567");
    expect(parsed).toMatchObject({ platform: "twitch", kind: "vod", videoId: "2181234567" });
  });
  it("parses clip links", () => {
    const a = parseStreamUrl("https://clips.twitch.tv/FunnyClipSlug-abc123");
    expect(a).toMatchObject({ platform: "twitch", kind: "clip", clipSlug: "FunnyClipSlug-abc123" });
    const b = parseStreamUrl("https://www.twitch.tv/streamer/clip/FunnyClipSlug-abc123");
    expect(b).toMatchObject({ platform: "twitch", kind: "clip", clipSlug: "FunnyClipSlug-abc123", channel: "streamer" });
  });
  it("rejects non-numeric VOD ids and reserved paths", () => {
    expect(() => parseStreamUrl("https://www.twitch.tv/videos/abc")).toThrow(UrlParseError);
    expect(() => parseStreamUrl("https://www.twitch.tv/directory")).toThrow(UrlParseError);
  });
});

describe("Kick URLs (structured, not yet analysable)", () => {
  it("parses channel and video links", () => {
    expect(parseStreamUrl("https://kick.com/xqc")).toMatchObject({ platform: "kick", kind: "channel", channel: "xqc" });
    expect(parseStreamUrl("https://kick.com/video/6c1a2b3c-d4e5-4f67-8901-abcdef123456")).toMatchObject({
      platform: "kick",
      kind: "vod",
      videoId: "6c1a2b3c-d4e5-4f67-8901-abcdef123456",
    });
    expect(parseStreamUrl("https://kick.com/xqc/videos/6c1a2b3c-d4e5-4f67-8901-abcdef123456")).toMatchObject({
      platform: "kick",
      kind: "vod",
      channel: "xqc",
    });
  });
});

describe("unsupported input", () => {
  it("throws for other domains and junk", () => {
    expect(() => parseStreamUrl("https://vimeo.com/12345")).toThrow(UrlParseError);
    expect(() => parseStreamUrl("not a url at all")).toThrow(UrlParseError);
    expect(() => parseStreamUrl("")).toThrow(UrlParseError);
    expect(() => parseStreamUrl("ftp://twitch.tv/videos/1")).toThrow(UrlParseError);
  });
  it("tryParseStreamUrl returns null instead of throwing", () => {
    expect(tryParseStreamUrl("https://vimeo.com/12345")).toBeNull();
    expect(tryParseStreamUrl("https://twitch.tv/videos/1")).not.toBeNull();
  });
});

describe("detectPlatform", () => {
  it("detects platforms from partial input", () => {
    expect(detectPlatform("youtube.com/watch?v=x")).toBe("youtube");
    expect(detectPlatform("https://twitch.tv/foo")).toBe("twitch");
    expect(detectPlatform("kick.com/foo")).toBe("kick");
    expect(detectPlatform("example.com")).toBeNull();
  });
});

describe("linkAtTime", () => {
  it("builds YouTube deep links", () => {
    const src = parseStreamUrl("https://youtu.be/dQw4w9WgXcQ");
    expect(linkAtTime(src, 3723.9)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3723s");
  });
  it("builds Twitch VOD deep links", () => {
    const src = parseStreamUrl("https://www.twitch.tv/videos/2181234567");
    expect(linkAtTime(src, 3723)).toBe("https://www.twitch.tv/videos/2181234567?t=1h2m3s");
  });
});
