import { randomUUID } from "node:crypto";
import type { AnalyzeRequest, JobStatus, JobView, StageKey, StageState } from "./types";
import { STAGE_LABELS } from "./types";

export interface Job extends JobView {
  controller: AbortController;
}

interface Store {
  jobs: Map<string, Job>;
  ttlMs: number;
}

// Survives Next.js dev-mode module reloads.
const g = globalThis as unknown as { __peaksJobs?: Store };

function store(): Store {
  if (!g.__peaksJobs) g.__peaksJobs = { jobs: new Map(), ttlMs: 2 * 3600 * 1000 };
  return g.__peaksJobs;
}

export function configureStore(opts: { ttlMs: number }): void {
  store().ttlMs = opts.ttlMs;
}

function freshStages(): StageState[] {
  return (Object.keys(STAGE_LABELS) as StageKey[]).map((key) => ({
    key,
    label: STAGE_LABELS[key],
    status: "pending",
    percent: 0,
  }));
}

export function createJob(request: AnalyzeRequest): Job {
  sweep();
  const now = Date.now();
  const job: Job = {
    id: randomUUID().slice(0, 8),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    request,
    source: null,
    meta: null,
    stages: freshStages(),
    percent: 0,
    message: "Queued",
    warnings: [],
    controller: new AbortController(),
  };
  store().jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return store().jobs.get(id);
}

export function listJobs(): Job[] {
  return Array.from(store().jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function cancelJob(id: string): boolean {
  const job = getJob(id);
  if (!job) return false;
  if (job.status === "done" || job.status === "error" || job.status === "cancelled") return true;
  job.controller.abort();
  setStatus(job, "cancelled", "Cancelled");
  for (const s of job.stages) if (s.status === "active") s.status = "error";
  return true;
}

/** Strips server-only fields for the API. */
export function toView(job: Job): JobView {
  const { controller: _controller, ...view } = job;
  void _controller;
  return view;
}

export function setStatus(job: Job, status: JobStatus, message?: string): void {
  job.status = status;
  if (message) job.message = message;
  job.updatedAt = Date.now();
}

const STAGE_WEIGHTS: Record<StageKey, number> = { resolve: 5, chat: 35, audio: 45, analyze: 15 };

export function updateStage(job: Job, key: StageKey, patch: Partial<StageState>, message?: string): void {
  const stage = job.stages.find((s) => s.key === key);
  if (!stage) return;
  Object.assign(stage, patch);
  if (message) job.message = message;
  let total = 0;
  for (const s of job.stages) {
    const w = STAGE_WEIGHTS[s.key];
    if (s.status === "done" || s.status === "skipped") total += w;
    else if (s.status === "active") total += (w * Math.max(0, Math.min(100, s.percent))) / 100;
  }
  job.percent = Math.round(total);
  job.updatedAt = Date.now();
}

function sweep(): void {
  const { jobs, ttlMs } = store();
  const cutoff = Date.now() - ttlMs;
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff && job.status !== "running") jobs.delete(id);
  }
}
