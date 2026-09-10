"use client";

import { useEffect, useMemo, useState } from "react";
import type { Sensitivity } from "@/lib/analysis/types";
import type { AnalysisMode, AnalyzeRequest } from "@/lib/jobs/types";
import { detectPlatform, PLATFORM_LABEL, tryParseStreamUrl, describeSource } from "@/lib/url";
import { Button } from "./ui";

export const DEMO_URL = "https://www.twitch.tv/videos/2181234567";

interface Props {
  busy: boolean;
  liveEnabled: boolean | null;
  initial?: Partial<AnalyzeRequest>;
  onSubmit: (request: AnalyzeRequest) => void;
}

const SENSITIVITY_HELP: Record<Sensitivity, string> = {
  low: "Only the biggest moments",
  medium: "Balanced",
  high: "Catch smaller reactions too",
};

export function UrlForm({ busy, liveEnabled, initial, onSubmit }: Props) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [mode, setMode] = useState<AnalysisMode>(initial?.mode ?? "demo");
  const [sensitivity, setSensitivity] = useState<Sensitivity>(initial?.sensitivity ?? "medium");

  useEffect(() => {
    if (liveEnabled === false) setMode("demo");
  }, [liveEnabled]);

  const parsed = useMemo(() => tryParseStreamUrl(url), [url]);
  const platform = useMemo(() => detectPlatform(url), [url]);
  const canSubmit = !busy && (mode === "demo" || (parsed !== null && parsed.platform !== "kick"));

  const hint = (() => {
    if (!url.trim()) return mode === "demo" ? "Leave empty for the built-in demo stream, or paste any link." : "Paste a YouTube or Twitch VOD link.";
    if (!parsed) return platform ? `Looks like ${PLATFORM_LABEL[platform]}, but the link isn't a video.` : "Not a YouTube or Twitch link.";
    if (parsed.platform === "kick") return "Kick is recognised but not supported yet.";
    if (parsed.platform === "twitch" && parsed.kind !== "vod") return `${describeSource(parsed)} — live analysis needs a VOD link (twitch.tv/videos/…).`;
    return describeSource(parsed);
  })();

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit({ url: url.trim(), mode, sensitivity });
      }}
    >
      <label className="grid gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">Stream URL</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.twitch.tv/videos/123456789 or https://youtube.com/watch?v=…"
              spellCheck={false}
              autoComplete="off"
              inputMode="url"
              className="h-11 w-full rounded-lg border border-line bg-elevated pl-3 pr-24 font-mono text-sm text-ink placeholder:text-faint focus:border-line-strong"
            />
            {platform && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] font-medium text-muted">
                {PLATFORM_LABEL[platform]}
              </span>
            )}
          </div>
          <Button type="submit" variant="primary" disabled={!canSubmit} className="h-11 min-w-32">
            {busy ? "Analysing…" : mode === "demo" ? "Run demo" : "Find peaks"}
          </Button>
        </div>
        <span className={`text-xs ${parsed || !url.trim() ? "text-muted" : "text-danger"}`}>{hint}</span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset className="grid gap-1.5">
          <legend className="text-xs font-medium uppercase tracking-wider text-muted">Mode</legend>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-elevated p-1">
            {(["demo", "live"] as AnalysisMode[]).map((m) => {
              const disabled = m === "live" && liveEnabled === false;
              return (
                <button
                  key={m}
                  type="button"
                  disabled={disabled}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${mode === m ? "bg-panel-2 text-ink shadow" : "text-muted hover:text-ink"}`}
                  title={disabled ? "Live analysis is disabled on this server" : undefined}
                >
                  {m === "demo" ? "Demo" : "Live"}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-muted">
            {mode === "demo" ? "Synthetic 3-hour stream with planted moments. Instant, no downloads." : "Downloads the chat replay and audio track with yt-dlp + ffmpeg on the server."}
          </span>
        </fieldset>

        <fieldset className="grid gap-1.5">
          <legend className="text-xs font-medium uppercase tracking-wider text-muted">Sensitivity</legend>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-elevated p-1">
            {(["low", "medium", "high"] as Sensitivity[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSensitivity(s)}
                className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${sensitivity === s ? "bg-panel-2 text-ink shadow" : "text-muted hover:text-ink"}`}
              >
                {s}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted">{SENSITIVITY_HELP[sensitivity]}</span>
        </fieldset>
      </div>

      {mode === "demo" && !url.trim() && (
        <button type="button" onClick={() => setUrl(DEMO_URL)} className="justify-self-start text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
          Use a sample Twitch link so deep links work
        </button>
      )}
    </form>
  );
}
