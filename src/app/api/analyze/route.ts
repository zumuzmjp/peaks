import { NextResponse } from "next/server";
import { getConfig } from "@/lib/env";
import { runJob } from "@/lib/jobs/runner";
import { configureStore, createJob, listJobs, toView } from "@/lib/jobs/store";
import type { AnalysisMode, AnalyzeRequest } from "@/lib/jobs/types";
import { tryParseStreamUrl } from "@/lib/url";
import type { Sensitivity } from "@/lib/analysis/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES: AnalysisMode[] = ["demo", "live"];
const LEVELS: Sensitivity[] = ["low", "medium", "high"];

export async function POST(req: Request) {
  let body: Partial<AnalyzeRequest>;
  try {
    body = (await req.json()) as Partial<AnalyzeRequest>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const mode: AnalysisMode = MODES.includes(body.mode as AnalysisMode) ? (body.mode as AnalysisMode) : "demo";
  const sensitivity: Sensitivity = LEVELS.includes(body.sensitivity as Sensitivity) ? (body.sensitivity as Sensitivity) : "medium";
  const url = typeof body.url === "string" ? body.url.trim().slice(0, 2048) : "";

  if (mode === "live" && !tryParseStreamUrl(url)) {
    return NextResponse.json({ error: "Paste a YouTube or Twitch VOD URL to analyse." }, { status: 400 });
  }
  const config = getConfig();
  if (mode === "live" && !config.liveEnabled) {
    return NextResponse.json(
      { error: "Live analysis is disabled on this server. Use demo mode or set PEAKS_ENABLE_LIVE=true." },
      { status: 403 }
    );
  }
  const running = listJobs().filter((j) => j.status === "running" && j.request.mode === "live").length;
  if (mode === "live" && running >= 2) {
    return NextResponse.json({ error: "Two live analyses are already running. Try again in a minute." }, { status: 429 });
  }

  configureStore({ ttlMs: config.jobTtlSeconds * 1000 });
  const job = createJob({ url, mode, sensitivity });
  void runJob(job);
  return NextResponse.json({ jobId: job.id, job: toView(job) }, { status: 202 });
}

export async function GET() {
  const config = getConfig();
  return NextResponse.json({
    liveEnabled: config.liveEnabled,
    maxDurationHours: config.maxDurationSeconds / 3600,
    jobs: listJobs()
      .slice(0, 20)
      .map((j) => ({ id: j.id, status: j.status, url: j.request.url, mode: j.request.mode, title: j.meta?.title ?? null, createdAt: j.createdAt })),
  });
}
