import type { ChatMessage, LoudnessSeries } from "../analysis/types";

/** What we know about a stream before analysing it. */
export interface SourceMeta {
  platform: "youtube" | "twitch";
  id: string;
  title: string;
  channel: string;
  durationSeconds: number;
  thumbnail?: string;
  /** True when the stream is still live (chat replay and full audio aren't available yet). */
  isLive: boolean;
  /** True when the platform reports a chat replay for this VOD. */
  hasChatReplay: boolean;
}

/** Raw inputs for the analyser, as fetched (or generated) for one source. */
export interface SourceSignals {
  meta: SourceMeta;
  chat: ChatMessage[];
  loudness: LoudnessSeries;
  /** Non-fatal problems encountered while fetching. */
  warnings: string[];
}

export type ProgressFn = (percent: number, message?: string) => void;

export class ProviderError extends Error {
  constructor(message: string, public readonly hint?: string) {
    super(message);
    this.name = "ProviderError";
  }
}
