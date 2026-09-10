/**
 * URL parsing for supported streaming platforms.
 *
 * Supported today: YouTube (videos, live streams, shorts, embeds) and Twitch
 * (VODs, live channels, clips). Kick is recognised and structured so a
 * provider can be added later, but analysis is not implemented for it yet.
 */

export type Platform = "youtube" | "twitch" | "kick";

export type ParsedSource =
  | {
      platform: "youtube";
      /** "video" covers uploads and finished live streams (VODs). */
      kind: "video" | "live";
      videoId: string;
      /** Start offset parsed from ?t= / #t= if present, in seconds. */
      startSeconds?: number;
      canonicalUrl: string;
    }
  | {
      platform: "twitch";
      kind: "vod" | "channel" | "clip";
      /** VOD id (numeric string) when kind === "vod". */
      videoId?: string;
      /** Channel login when kind === "channel". */
      channel?: string;
      /** Clip slug when kind === "clip". */
      clipSlug?: string;
      startSeconds?: number;
      canonicalUrl: string;
    }
  | {
      platform: "kick";
      kind: "vod" | "channel";
      videoId?: string;
      channel?: string;
      canonicalUrl: string;
    };

export class UrlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlParseError";
  }
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Parses "1h2m3s", "3723", "1h", "45m" into seconds. Returns undefined if the
 * value is not a recognisable duration.
 */
export function parseTimeParam(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (!m || m[0] === "") return undefined;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  return h * 3600 + min * 60 + s;
}

function normaliseInput(raw: string): URL {
  let input = raw.trim();
  if (!input) throw new UrlParseError("Paste a YouTube or Twitch URL to get started.");
  if (!/^[a-z]+:\/\//i.test(input)) input = `https://${input}`;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UrlParseError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UrlParseError("Only http(s) URLs are supported.");
  }
  return url;
}

function hostMatches(host: string, domains: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\.|^m\.|^mobile\./, "");
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

function parseYouTube(url: URL): ParsedSource {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  const startSeconds =
    parseTimeParam(url.searchParams.get("t")) ??
    parseTimeParam(url.searchParams.get("start")) ??
    parseTimeParam(url.hash.startsWith("#t=") ? url.hash.slice(3) : null);

  let videoId: string | undefined;
  let kind: "video" | "live" = "video";

  if (hostMatches(host, ["youtu.be"])) {
    videoId = segments[0];
  } else if (segments[0] === "watch") {
    videoId = url.searchParams.get("v") ?? undefined;
  } else if (["live", "shorts", "embed", "v"].includes(segments[0] ?? "")) {
    videoId = segments[1];
    if (segments[0] === "live") kind = "live";
  } else if (segments.length === 0 && url.searchParams.get("v")) {
    videoId = url.searchParams.get("v") ?? undefined;
  }

  if (!videoId || !YT_ID.test(videoId)) {
    throw new UrlParseError(
      "Couldn't find a video ID in that YouTube URL. Use a watch, live, or youtu.be link."
    );
  }
  return {
    platform: "youtube",
    kind,
    videoId,
    startSeconds,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

const TWITCH_RESERVED = new Set([
  "videos",
  "directory",
  "settings",
  "downloads",
  "jobs",
  "p",
  "turbo",
  "subscriptions",
  "inventory",
  "wallet",
  "drops",
  "search",
  "friends",
  "clip",
  "popout",
  "embed",
]);
const TWITCH_LOGIN = /^[A-Za-z0-9_]{3,25}$/;

function parseTwitch(url: URL): ParsedSource {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  const startSeconds = parseTimeParam(url.searchParams.get("t"));

  if (hostMatches(host, ["clips.twitch.tv"])) {
    const slug = segments[0];
    if (!slug) throw new UrlParseError("Missing clip slug in that Twitch clip URL.");
    return {
      platform: "twitch",
      kind: "clip",
      clipSlug: slug,
      canonicalUrl: `https://clips.twitch.tv/${slug}`,
    };
  }

  // https://www.twitch.tv/videos/123456789
  if (segments[0] === "videos" && segments[1]) {
    const id = segments[1];
    if (!/^\d+$/.test(id)) throw new UrlParseError("Twitch VOD IDs are numeric.");
    return {
      platform: "twitch",
      kind: "vod",
      videoId: id,
      startSeconds,
      canonicalUrl: `https://www.twitch.tv/videos/${id}`,
    };
  }

  // https://www.twitch.tv/<channel>/video/123 (legacy) or /<channel>/v/123
  if (
    segments.length >= 3 &&
    (segments[1] === "video" || segments[1] === "v") &&
    /^\d+$/.test(segments[2])
  ) {
    return {
      platform: "twitch",
      kind: "vod",
      videoId: segments[2],
      startSeconds,
      canonicalUrl: `https://www.twitch.tv/videos/${segments[2]}`,
    };
  }

  // https://www.twitch.tv/<channel>/clip/<slug>
  if (segments.length >= 3 && segments[1] === "clip") {
    return {
      platform: "twitch",
      kind: "clip",
      channel: segments[0].toLowerCase(),
      clipSlug: segments[2],
      canonicalUrl: `https://clips.twitch.tv/${segments[2]}`,
    };
  }

  // https://www.twitch.tv/<channel>
  if (
    segments.length === 1 &&
    TWITCH_LOGIN.test(segments[0]) &&
    !TWITCH_RESERVED.has(segments[0].toLowerCase())
  ) {
    const channel = segments[0].toLowerCase();
    return {
      platform: "twitch",
      kind: "channel",
      channel,
      canonicalUrl: `https://www.twitch.tv/${channel}`,
    };
  }

  throw new UrlParseError(
    "Couldn't understand that Twitch URL. Use a VOD link like twitch.tv/videos/123456789 or a channel link."
  );
}

function parseKick(url: URL): ParsedSource {
  const segments = url.pathname.split("/").filter(Boolean);
  // https://kick.com/video/<uuid>
  if (segments[0] === "video" && segments[1]) {
    return {
      platform: "kick",
      kind: "vod",
      videoId: segments[1],
      canonicalUrl: `https://kick.com/video/${segments[1]}`,
    };
  }
  // https://kick.com/<channel>/videos/<uuid>
  if (segments.length >= 3 && segments[1] === "videos") {
    return {
      platform: "kick",
      kind: "vod",
      channel: segments[0].toLowerCase(),
      videoId: segments[2],
      canonicalUrl: `https://kick.com/video/${segments[2]}`,
    };
  }
  if (segments.length === 1 && /^[A-Za-z0-9_-]{2,40}$/.test(segments[0])) {
    const channel = segments[0].toLowerCase();
    return { platform: "kick", kind: "channel", channel, canonicalUrl: `https://kick.com/${channel}` };
  }
  throw new UrlParseError("Couldn't understand that Kick URL.");
}

/** Detects the platform from a URL without fully validating it. */
export function detectPlatform(raw: string): Platform | null {
  try {
    const url = normaliseInput(raw);
    const host = url.hostname;
    if (hostMatches(host, ["youtube.com", "youtu.be", "youtube-nocookie.com"])) return "youtube";
    if (hostMatches(host, ["twitch.tv"])) return "twitch";
    if (hostMatches(host, ["kick.com"])) return "kick";
    return null;
  } catch {
    return null;
  }
}

/** Parses a stream/VOD URL into a structured source. Throws UrlParseError. */
export function parseStreamUrl(raw: string): ParsedSource {
  const url = normaliseInput(raw);
  const host = url.hostname;
  if (hostMatches(host, ["youtube.com", "youtu.be", "youtube-nocookie.com"])) return parseYouTube(url);
  if (hostMatches(host, ["twitch.tv"])) return parseTwitch(url);
  if (hostMatches(host, ["kick.com"])) return parseKick(url);
  throw new UrlParseError("Unsupported platform. PEAKS currently supports YouTube and Twitch URLs.");
}

/** Safe variant that returns null instead of throwing. */
export function tryParseStreamUrl(raw: string): ParsedSource | null {
  try {
    return parseStreamUrl(raw);
  } catch {
    return null;
  }
}

/** Builds a deep link that opens the source at a given offset. */
export function linkAtTime(source: ParsedSource, seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (source.platform === "youtube") return `${source.canonicalUrl}&t=${s}s`;
  if (source.platform === "twitch") {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (source.kind === "vod") return `${source.canonicalUrl}?t=${h}h${m}m${sec}s`;
    return source.canonicalUrl;
  }
  return source.canonicalUrl;
}

export function describeSource(source: ParsedSource): string {
  switch (source.platform) {
    case "youtube":
      return `YouTube ${source.kind === "live" ? "live stream" : "video"} ${source.videoId}`;
    case "twitch":
      if (source.kind === "vod") return `Twitch VOD ${source.videoId}`;
      if (source.kind === "clip") return `Twitch clip ${source.clipSlug}`;
      return `Twitch channel ${source.channel}`;
    case "kick":
      return source.kind === "vod" ? `Kick VOD ${source.videoId}` : `Kick channel ${source.channel}`;
  }
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  twitch: "Twitch",
  kick: "Kick",
};
