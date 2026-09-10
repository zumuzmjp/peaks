import fs from "node:fs/promises";
import { analyze, optionsForSensitivity } from "../analysis";
import { cacheKey, cachePaths, readCachedSignals, removeWorkDir, writeCachedSignals } from "../cache";
import { generateDemoStream } from "../demo/fixture";
import { getConfig } from "../env";
import { measureLoudness } from "../providers/loudness";
import { fetchTwitchChat } from "../providers/twitchChat";
import { ProviderError, type SourceSignals } from "../providers/types";
import { downloadAudio, downloadYouTubeChat, fetchMetadata } from "../providers/ytdlp";
import { parseStreamUrl, UrlParseError, type ParsedSource } from "../url";
import { setStatus, updateStage, type Job } from "./store";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new ProviderError("Cancelled."));
    });
  });

/** Runs a job to completion, recording progress on the job object as it goes. */
export async function runJob(job: Job): Promise<void> {
  const signal = job.controller.signal;
  setStatus(job, "running", "Starting…");
  try {
    const signals = job.request.mode === "demo" ? await demoSignals(job, signal) : await liveSignals(job, signal);
    if (signal.aborted) return;

    updateStage(job, "analyze", { status: "active", percent: 10 }, "Detecting chat and audio spikes…");
    // Let the UI show the stage before the (synchronous) analysis blocks the loop.
    await sleep(job.request.mode === "demo" ? 350 : 30, signal);
    const result = analyze({
      durationSeconds: signals.meta.durationSeconds,
      chat: signals.chat,
      loudness: signals.loudness,
      options: optionsForSensitivity(job.request.sensitivity),
    });
    job.result = result;
    job.meta = signals.meta;
    job.warnings.push(...signals.warnings);
    updateStage(job, "analyze", { status: "done", percent: 100, detail: `${result.peaks.length} peaks` });
    setStatus(job, "done", `Found ${result.peaks.length} peaks`);
  } catch (err) {
    if (signal.aborted) {
      setStatus(job, "cancelled", "Cancelled");
      return;
    }
    const active = job.stages.find((s) => s.status === "active");
    if (active) active.status = "error";
    const message = err instanceof Error ? err.message : String(err);
    const hint = err instanceof ProviderError ? err.hint : err instanceof UrlParseError ? "Check the URL and try again." : undefined;
    job.error = { message, hint };
    setStatus(job, "error", message);
  }
}

async function demoSignals(job: Job, signal: AbortSignal): Promise<SourceSignals> {
  updateStage(job, "resolve", { status: "active", percent: 50 }, "Loading demo stream…");
  let source: ParsedSource | null = null;
  if (job.request.url.trim()) {
    try {
      source = parseStreamUrl(job.request.url);
    } catch {
      source = null;
    }
  }
  job.source = source ?? parseStreamUrl("https://www.twitch.tv/videos/2181234567");
  const seed = source ? `${source.platform}:${"videoId" in source ? source.videoId : source.canonicalUrl}` : "peaks-demo";
  await sleep(300, signal);
  const stream = generateDemoStream(seed);
  const meta = {
    platform: job.source.platform as "youtube" | "twitch",
    id: "videoId" in job.source && job.source.videoId ? job.source.videoId : "demo",
    title: stream.title,
    channel: stream.streamer,
    durationSeconds: stream.durationSeconds,
    isLive: false,
    hasChatReplay: true,
  };
  job.meta = meta;
  updateStage(job, "resolve", { status: "done", percent: 100, detail: `${Math.round(stream.durationSeconds / 60)} min · ${stream.game}` });

  updateStage(job, "chat", { status: "active", percent: 0 }, "Replaying chat…");
  for (let p = 0; p <= 100; p += 25) {
    await sleep(120, signal);
    updateStage(job, "chat", { percent: p }, `Replaying chat… ${Math.round((stream.chat.length * p) / 100).toLocaleString()} messages`);
  }
  updateStage(job, "chat", { status: "done", percent: 100, detail: `${stream.chat.length.toLocaleString()} messages` });

  updateStage(job, "audio", { status: "active", percent: 0 }, "Measuring loudness…");
  for (let p = 0; p <= 100; p += 20) {
    await sleep(110, signal);
    updateStage(job, "audio", { percent: p }, `Measuring loudness… ${p}%`);
  }
  updateStage(job, "audio", { status: "done", percent: 100, detail: "1 s resolution" });

  return {
    meta,
    chat: stream.chat,
    loudness: stream.loudness,
    warnings: ["Demo mode: this is a synthetic stream with planted moments, not the URL you pasted."],
  };
}

async function liveSignals(job: Job, signal: AbortSignal): Promise<SourceSignals> {
  const config = getConfig();
  if (!config.liveEnabled) {
    throw new ProviderError("Live analysis is disabled on this server.", "Set PEAKS_ENABLE_LIVE=true (and install yt-dlp + ffmpeg) to analyse real URLs.");
  }
  updateStage(job, "resolve", { status: "active", percent: 20 }, "Resolving stream…");
  const source = parseStreamUrl(job.request.url);
  job.source = source;
  const ytOpts = { ytDlpPath: config.ytDlpPath, extraArgs: config.ytDlpExtraArgs, signal };

  const platformId = source.platform === "youtube" ? source.videoId : source.platform === "twitch" ? source.videoId ?? "" : "";
  const key = cacheKey(source.platform, platformId);
  const cached = await readCachedSignals(config.cacheDir, key);
  if (cached) {
    job.meta = cached.meta;
    updateStage(job, "resolve", { status: "done", percent: 100, detail: "from cache" });
    updateStage(job, "chat", { status: "done", percent: 100, detail: `${cached.chat.length.toLocaleString()} messages (cached)` });
    updateStage(job, "audio", { status: "done", percent: 100, detail: "cached" });
    return { ...cached, warnings: [...cached.warnings, "Loaded chat and loudness from the local cache."] };
  }

  const meta = await fetchMetadata(source, ytOpts);
  job.meta = meta;
  if (meta.durationSeconds > config.maxDurationSeconds) {
    throw new ProviderError(
      `This stream is ${(meta.durationSeconds / 3600).toFixed(1)} h long; the limit is ${config.maxDurationSeconds / 3600} h.`,
      "Raise PEAKS_MAX_DURATION_HOURS to allow longer streams."
    );
  }
  updateStage(job, "resolve", { status: "done", percent: 100, detail: `${Math.round(meta.durationSeconds / 60)} min · ${meta.channel}` });

  const paths = cachePaths(config.cacheDir, key);
  await fs.mkdir(paths.work, { recursive: true });
  const warnings: string[] = [];

  const chatTask = (async () => {
    updateStage(job, "chat", { status: "active", percent: 0 }, "Fetching chat replay…");
    if (!meta.hasChatReplay) {
      warnings.push("No chat replay is available for this stream; peaks are based on audio only.");
      updateStage(job, "chat", { status: "skipped", percent: 100, detail: "no replay available" });
      return [];
    }
    const onProgress = (percent: number, message?: string) => updateStage(job, "chat", { percent }, message);
    const chat =
      source.platform === "twitch"
        ? await fetchTwitchChat(platformId, meta.durationSeconds, { clientId: config.twitchClientId, workers: config.twitchChatWorkers, onProgress, signal })
        : await downloadYouTubeChat(source, paths.work, { ...ytOpts, onProgress, durationSeconds: meta.durationSeconds });
    if (chat.length === 0) warnings.push("The chat replay came back empty; peaks are based on audio only.");
    updateStage(job, "chat", { status: "done", percent: 100, detail: `${chat.length.toLocaleString()} messages` });
    return chat;
  })();

  const audioTask = (async () => {
    updateStage(job, "audio", { status: "active", percent: 0 }, "Downloading audio…");
    const file = await downloadAudio(source, paths.work, {
      ...ytOpts,
      onProgress: (percent, message) => updateStage(job, "audio", { percent: Math.round(percent * 0.6) }, message),
    });
    updateStage(job, "audio", { percent: 60 }, "Measuring loudness…");
    const loudness = await measureLoudness(
      config.ffmpegPath,
      file,
      meta.durationSeconds,
      (percent, message) => updateStage(job, "audio", { percent: 60 + Math.round(percent * 0.4) }, message),
      signal
    );
    updateStage(job, "audio", { status: "done", percent: 100, detail: `${Math.round(loudness.db.length / 60)} min measured` });
    return loudness;
  })();

  const [chat, loudness] = await Promise.all([chatTask, audioTask]);
  const signals: SourceSignals = { meta, chat, loudness, warnings };
  await writeCachedSignals(config.cacheDir, key, signals);
  if (!config.keepAudio) await removeWorkDir(config.cacheDir, key);
  return signals;
}
