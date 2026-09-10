import fs from "node:fs/promises";
import path from "node:path";
import type { SourceSignals } from "./providers/types";

const VERSION = 1;

export function cacheKey(platform: string, id: string): string {
  return `${platform}-${id}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function cachePaths(cacheDir: string, key: string) {
  const dir = path.join(cacheDir, key);
  return { dir, signals: path.join(dir, "signals.json"), work: path.join(dir, "work") };
}

export async function readCachedSignals(cacheDir: string, key: string): Promise<SourceSignals | null> {
  try {
    const raw = await fs.readFile(cachePaths(cacheDir, key).signals, "utf8");
    const parsed = JSON.parse(raw) as { version: number; signals: SourceSignals };
    if (parsed.version !== VERSION) return null;
    return parsed.signals;
  } catch {
    return null;
  }
}

export async function writeCachedSignals(cacheDir: string, key: string, signals: SourceSignals): Promise<void> {
  const paths = cachePaths(cacheDir, key);
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.writeFile(paths.signals, JSON.stringify({ version: VERSION, signals }));
}

export async function removeWorkDir(cacheDir: string, key: string): Promise<void> {
  await fs.rm(cachePaths(cacheDir, key).work, { recursive: true, force: true });
}
