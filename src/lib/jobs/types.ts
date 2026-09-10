import type { AnalysisResult, Sensitivity } from "../analysis/types";
import type { SourceMeta } from "../providers/types";
import type { ParsedSource } from "../url";

export type AnalysisMode = "demo" | "live";

export interface AnalyzeRequest {
  url: string;
  mode: AnalysisMode;
  sensitivity: Sensitivity;
}

export type StageKey = "resolve" | "chat" | "audio" | "analyze";
export type StageStatus = "pending" | "active" | "done" | "skipped" | "error";

export interface StageState {
  key: StageKey;
  label: string;
  status: StageStatus;
  percent: number;
  detail?: string;
}

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface JobView {
  id: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  request: AnalyzeRequest;
  source: ParsedSource | null;
  meta: SourceMeta | null;
  stages: StageState[];
  /** Overall progress 0-100. */
  percent: number;
  message: string;
  warnings: string[];
  error?: { message: string; hint?: string };
  result?: AnalysisResult;
}

export const STAGE_LABELS: Record<StageKey, string> = {
  resolve: "Resolve stream",
  chat: "Chat replay",
  audio: "Audio loudness",
  analyze: "Detect peaks",
};
