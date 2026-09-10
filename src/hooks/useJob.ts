"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyzeRequest, JobView } from "@/lib/jobs/types";

export type JobPhase = "idle" | "submitting" | "running" | "done" | "error" | "cancelled";

interface UseJobState {
  phase: JobPhase;
  job: JobView | null;
  error: string | null;
}

const TERMINAL = new Set(["done", "error", "cancelled"]);

/** Submits analysis jobs and polls them until they finish. */
export function useJob(initialJobId?: string | null) {
  const [state, setState] = useState<UseJobState>({ phase: initialJobId ? "running" : "idle", job: null, error: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jobIdRef = useRef<string | null>(initialJobId ?? null);

  const stopPolling = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const poll = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setState({ phase: "error", job: null, error: body.error ?? `Job lookup failed (${res.status}).` });
          return;
        }
        const job = (await res.json()) as JobView;
        if (jobIdRef.current !== id) return;
        if (TERMINAL.has(job.status)) {
          setState({ phase: job.status as JobPhase, job, error: job.error?.message ?? null });
          return;
        }
        setState({ phase: "running", job, error: null });
        timer.current = setTimeout(() => poll(id), 650);
      } catch (err) {
        setState({ phase: "error", job: null, error: err instanceof Error ? err.message : "Network error" });
      }
    },
    []
  );

  useEffect(() => {
    if (initialJobId) void poll(initialJobId);
    return stopPolling;
  }, [initialJobId, poll, stopPolling]);

  const submit = useCallback(
    async (request: AnalyzeRequest) => {
      stopPolling();
      setState({ phase: "submitting", job: null, error: null });
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const body = (await res.json()) as { jobId?: string; job?: JobView; error?: string };
        if (!res.ok || !body.jobId) {
          setState({ phase: "error", job: null, error: body.error ?? `Request failed (${res.status}).` });
          return null;
        }
        jobIdRef.current = body.jobId;
        setState({ phase: "running", job: body.job ?? null, error: null });
        void poll(body.jobId);
        return body.jobId;
      } catch (err) {
        setState({ phase: "error", job: null, error: err instanceof Error ? err.message : "Network error" });
        return null;
      }
    },
    [poll, stopPolling]
  );

  const cancel = useCallback(async () => {
    const id = jobIdRef.current;
    if (!id) return;
    stopPolling();
    await fetch(`/api/jobs/${id}`, { method: "DELETE" }).catch(() => undefined);
    setState((s) => ({ phase: "cancelled", job: s.job, error: null }));
  }, [stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    jobIdRef.current = null;
    setState({ phase: "idle", job: null, error: null });
  }, [stopPolling]);

  return { ...state, submit, cancel, reset };
}
