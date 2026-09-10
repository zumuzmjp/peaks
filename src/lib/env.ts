/**
 * Server-side configuration. Everything has a default so the demo works with
 * no `.env` at all; live analysis needs yt-dlp and ffmpeg on the machine.
 */
import path from "node:path";

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface PeaksConfig {
  /** Allow analysing real URLs (downloads chat + audio). Demo mode always works. */
  liveEnabled: boolean;
  ytDlpPath: string;
  ffmpegPath: string;
  /** Extra arguments appended to every yt-dlp call (cookies, proxies, rate limits). */
  ytDlpExtraArgs: string[];
  cacheDir: string;
  /** Streams longer than this are refused in live mode. */
  maxDurationSeconds: number;
  /** Concurrent GraphQL requests when pulling Twitch chat. */
  twitchChatWorkers: number;
  twitchClientId: string;
  /** Keep downloaded audio after analysis (useful for debugging). */
  keepAudio: boolean;
  /** How long finished jobs stay in memory. */
  jobTtlSeconds: number;
}

export function getConfig(): PeaksConfig {
  const env = process.env;
  const extra = (env.PEAKS_YTDLP_ARGS ?? "").trim();
  return {
    liveEnabled: bool(env.PEAKS_ENABLE_LIVE, true),
    ytDlpPath: env.PEAKS_YTDLP_PATH || "yt-dlp",
    ffmpegPath: env.PEAKS_FFMPEG_PATH || "ffmpeg",
    ytDlpExtraArgs: extra ? extra.split(/\s+/) : [],
    cacheDir: path.resolve(env.PEAKS_CACHE_DIR || ".peaks-cache"),
    maxDurationSeconds: num(env.PEAKS_MAX_DURATION_HOURS, 8) * 3600,
    twitchChatWorkers: Math.min(8, Math.round(num(env.PEAKS_TWITCH_CHAT_WORKERS, 4))),
    twitchClientId: env.PEAKS_TWITCH_CLIENT_ID || "ue6666qo983tsx6so1t0vnawi233wa",
    keepAudio: bool(env.PEAKS_KEEP_AUDIO, false),
    jobTtlSeconds: num(env.PEAKS_JOB_TTL_MINUTES, 120) * 60,
  };
}
