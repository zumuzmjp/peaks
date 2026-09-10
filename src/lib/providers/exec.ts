import { spawn } from "node:child_process";
import { ProviderError } from "./types";

export interface RunOptions {
  args: string[];
  cwd?: string;
  signal?: AbortSignal;
  /** Called for every line written to stdout. */
  onStdout?: (line: string) => void;
  /** Called for every line written to stderr (progress lines use \r; those are split too). */
  onStderr?: (line: string) => void;
  /** Reject when the process exits non-zero. Default true. */
  failOnExit?: boolean;
  /** Bytes of stdout to keep for the result. Default 200 kB. */
  maxStdoutBytes?: number;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function splitLines(buffer: string, emit: (line: string) => void): string {
  const parts = buffer.split(/\r\n|\r|\n/);
  const rest = parts.pop() ?? "";
  for (const line of parts) if (line.trim()) emit(line);
  return rest;
}

/**
 * Spawns a command and streams its output line by line. Resolves when the
 * process exits; rejects with a ProviderError if the executable is missing.
 */
export function run(command: string, opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, opts.args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    let outRest = "";
    let errRest = "";
    const maxKeep = opts.maxStdoutBytes ?? 200_000;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < maxKeep) stdout += chunk;
      if (opts.onStdout) outRest = splitLines(outRest + chunk, opts.onStdout);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-maxKeep);
      if (opts.onStderr) errRest = splitLines(errRest + chunk, opts.onStderr);
    });

    const onAbort = () => {
      child.kill("SIGKILL");
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("error", (err: NodeJS.ErrnoException) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (err.code === "ENOENT") {
        reject(
          new ProviderError(
            `Could not find "${command}" on this machine.`,
            "Install it and make sure it is on PATH, or point PEAKS_YTDLP_PATH / PEAKS_FFMPEG_PATH at the binary."
          )
        );
      } else reject(err);
    });
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (outRest.trim() && opts.onStdout) opts.onStdout(outRest);
      if (errRest.trim() && opts.onStderr) opts.onStderr(errRest);
      if (opts.signal?.aborted) {
        reject(new ProviderError("Cancelled."));
        return;
      }
      if (code !== 0 && (opts.failOnExit ?? true)) {
        const tail = stderr.trim().split("\n").filter(Boolean).slice(-6).join("\n");
        reject(new ProviderError(`${command} exited with code ${code}.`, tail || undefined));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}
