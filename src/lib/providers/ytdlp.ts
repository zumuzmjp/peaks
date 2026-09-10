import fs from "node:fs/promises";
import path from "node:path";
import { run } from "./exec";
import { ProviderError, type ProgressFn, type SourceMeta } from "./types";
import { parseYouTubeChatFile } from "./youtubeChat";
import type { ChatMessage } from "../analysis/types";
import type { ParsedSource } from "../url";

export interface YtDlpOptions {
  ytDlpPath: string;
  extraArgs: string[];
  signal?: AbortSignal;
}

/** Fetches title, duration and chat-replay availability without downloading media. */
export async function fetchMetadata(source: ParsedSource, opts: YtDlpOptions): Promise<SourceMeta> {
  if (source.platform === "kick") throw new ProviderError("Kick isn't supported yet.", "Paste a YouTube or Twitch URL.");
  if (source.platform === "twitch" && source.kind !== "vod") {
    throw new ProviderError(
      source.kind === "clip" ? "Twitch clips are already clips." : "Live Twitch channels can't be analysed yet.",
      "Paste a VOD link like https://www.twitch.tv/videos/123456789 once the stream has ended."
    );
  }
  const { stdout } = await run(opts.ytDlpPath, {
    args: ["-J", "--no-warnings", "--no-playlist", ...opts.extraArgs, source.canonicalUrl],
    signal: opts.signal,
  });
  let info: Record<string, unknown>;
  try {
    info = JSON.parse(stdout);
  } catch {
    throw new ProviderError("yt-dlp returned unreadable metadata.");
  }
  const duration = Number(info.duration);
  const subtitles = (info.subtitles ?? {}) as Record<string, unknown>;
  const isLive = info.is_live === true || info.live_status === "is_live";
  const meta: SourceMeta = {
    platform: source.platform,
    id: String(info.id ?? (source.platform === "youtube" ? source.videoId : source.videoId ?? "")),
    title: typeof info.title === "string" ? info.title : "Untitled stream",
    channel: String(info.uploader ?? info.channel ?? info.uploader_id ?? ""),
    durationSeconds: Number.isFinite(duration) ? duration : 0,
    thumbnail: typeof info.thumbnail === "string" ? info.thumbnail : undefined,
    isLive,
    hasChatReplay: source.platform === "twitch" ? true : "live_chat" in subtitles,
  };
  if (isLive) throw new ProviderError("That stream is still live.", "PEAKS analyses finished streams; try again once the VOD is available.");
  if (!meta.durationSeconds) throw new ProviderError("Couldn't determine the stream duration.", "Is this a finished VOD?");
  return meta;
}

function parseDownloadPercent(line: string): number | null {
  const m = /\[download\]\s+([\d.]+)%/.exec(line);
  return m ? Number(m[1]) : null;
}

/** Downloads the smallest usable audio track into `dir`; returns the file path. */
export async function downloadAudio(
  source: ParsedSource,
  dir: string,
  opts: YtDlpOptions & { onProgress: ProgressFn }
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const template = path.join(dir, "audio.%(ext)s");
  let lastPct = -1;
  await run(opts.ytDlpPath, {
    args: [
      "--no-warnings",
      "--no-playlist",
      "--newline",
      "--progress",
      "-f",
      "bestaudio[abr<=96]/bestaudio/Audio_Only/worst",
      "-o",
      template,
      ...opts.extraArgs,
      source.canonicalUrl,
    ],
    signal: opts.signal,
    onStdout: (line) => {
      const pct = parseDownloadPercent(line);
      if (pct !== null && Math.floor(pct) !== lastPct) {
        lastPct = Math.floor(pct);
        opts.onProgress(Math.min(99, lastPct), `Downloading audio… ${lastPct}%`);
      }
    },
  });
  const files = (await fs.readdir(dir)).filter((f) => f.startsWith("audio.") && !f.endsWith(".part"));
  if (!files.length) throw new ProviderError("yt-dlp finished but no audio file was written.");
  return path.join(dir, files[0]);
}

/** Downloads a YouTube live chat replay via yt-dlp and parses it. */
export async function downloadYouTubeChat(
  source: ParsedSource,
  dir: string,
  opts: YtDlpOptions & { onProgress: ProgressFn; durationSeconds: number }
): Promise<ChatMessage[]> {
  await fs.mkdir(dir, { recursive: true });
  const template = path.join(dir, "chat.%(ext)s");
  let frags = 0;
  await run(opts.ytDlpPath, {
    args: [
      "--no-warnings",
      "--no-playlist",
      "--skip-download",
      "--write-subs",
      "--sub-langs",
      "live_chat",
      "--newline",
      "-o",
      template,
      ...opts.extraArgs,
      source.canonicalUrl,
    ],
    signal: opts.signal,
    onStdout: (line) => {
      const m = /\(frag (\d+)\)/.exec(line);
      if (m) {
        frags = Number(m[1]);
        // Each fragment covers a few minutes of chat; the count is only a hint.
        const est = Math.min(95, Math.round((frags * 90 * 100) / Math.max(1, opts.durationSeconds)));
        opts.onProgress(est, `Downloading chat replay… ${frags} fragments`);
      }
    },
  });
  const files = (await fs.readdir(dir)).filter((f) => f.startsWith("chat.") && f.endsWith(".json"));
  if (!files.length) return [];
  const contents = await fs.readFile(path.join(dir, files[0]), "utf8");
  return parseYouTubeChatFile(contents);
}
