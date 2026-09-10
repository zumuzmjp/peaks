import type { ChatMessage } from "../analysis/types";
import { ProviderError, type ProgressFn } from "./types";

const GQL_URL = "https://gql.twitch.tv/gql";
/** Persisted query used by Twitch's own VOD player to load chat replay. */
const COMMENTS_QUERY_HASH = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a";

type Json = Record<string, unknown>;

interface CommentPage {
  messages: ChatMessage[];
  ids: string[];
  cursor: string | null;
  hasNextPage: boolean;
  /** Offset of the last comment on the page, seconds. */
  lastOffset: number;
}

/** Converts one GraphQL comments response into messages. Exported for tests. */
export function parseTwitchCommentsResponse(body: unknown): CommentPage {
  const arr = Array.isArray(body) ? body : [body];
  const first = arr[0] as Json | undefined;
  const errors = first?.errors;
  if (Array.isArray(errors) && errors.length) {
    const msg = (errors[0] as Json)?.message;
    throw new ProviderError(`Twitch chat API error: ${typeof msg === "string" ? msg : "unknown"}`);
  }
  const data = first?.data as Json | undefined;
  const video = data?.video as Json | null | undefined;
  if (!video) throw new ProviderError("Twitch returned no video for that ID.", "The VOD may have been deleted or is subscriber-only.");
  const comments = video.comments as Json | null | undefined;
  const edges = comments && Array.isArray(comments.edges) ? (comments.edges as Json[]) : [];
  const pageInfo = (comments?.pageInfo as Json | undefined) ?? {};
  const messages: ChatMessage[] = [];
  const ids: string[] = [];
  let cursor: string | null = null;
  let lastOffset = 0;
  for (const edge of edges) {
    const node = edge.node as Json | undefined;
    if (!node) continue;
    if (typeof edge.cursor === "string") cursor = edge.cursor;
    const t = Number(node.contentOffsetSeconds);
    if (!Number.isFinite(t)) continue;
    const commenter = node.commenter as Json | null | undefined;
    const author = (commenter && (typeof commenter.displayName === "string" ? commenter.displayName : typeof commenter.login === "string" ? commenter.login : null)) || "unknown";
    const message = node.message as Json | undefined;
    const fragments = message && Array.isArray(message.fragments) ? (message.fragments as Json[]) : [];
    const text = fragments.map((f) => (typeof f.text === "string" ? f.text : "")).join("").trim();
    if (!text) continue;
    lastOffset = Math.max(lastOffset, t);
    ids.push(typeof node.id === "string" ? node.id : `${t}:${author}:${text}`);
    messages.push({ t, author, text });
  }
  return { messages, ids, cursor, hasNextPage: pageInfo.hasNextPage === true, lastOffset };
}

async function fetchPage(
  videoId: string,
  variables: Json,
  clientId: string,
  signal?: AbortSignal
): Promise<CommentPage> {
  const body = [
    {
      operationName: "VideoCommentsByOffsetOrCursor",
      variables: { videoID: videoId, ...variables },
      extensions: { persistedQuery: { version: 1, sha256Hash: COMMENTS_QUERY_HASH } },
    },
  ];
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(GQL_URL, {
        method: "POST",
        headers: { "Client-ID": clientId, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new ProviderError(`Twitch chat API returned HTTP ${res.status}.`);
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
        continue;
      }
      if (!res.ok) {
        throw new ProviderError(`Twitch chat API returned HTTP ${res.status}.`, res.status === 400 ? "The Twitch client ID may be outdated; set PEAKS_TWITCH_CLIENT_ID." : undefined);
      }
      return parseTwitchCommentsResponse(await res.json());
    } catch (err) {
      if (signal?.aborted) throw new ProviderError("Cancelled.");
      if (err instanceof ProviderError && !/HTTP (429|5\d\d)/.test(err.message)) throw err;
      lastError = err;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  throw lastError instanceof Error ? lastError : new ProviderError("Twitch chat API is unavailable.");
}

/**
 * Downloads the full chat replay of a Twitch VOD. The timeline is split into
 * chunks that are walked in parallel by cursor; results are de-duplicated by
 * comment ID because chunk boundaries overlap slightly.
 */
export async function fetchTwitchChat(
  videoId: string,
  durationSeconds: number,
  opts: { clientId: string; workers?: number; onProgress?: ProgressFn; signal?: AbortSignal }
): Promise<ChatMessage[]> {
  const workers = Math.max(1, Math.min(8, opts.workers ?? 4));
  const chunkCount = Math.max(1, Math.min(workers * 3, Math.ceil(durationSeconds / 600)));
  const chunkLen = durationSeconds / chunkCount;
  const seen = new Set<string>();
  const messages: ChatMessage[] = [];
  const covered = new Array<number>(chunkCount).fill(0);
  let nextChunk = 0;

  const report = () => {
    if (!opts.onProgress) return;
    const done = covered.reduce((a, b) => a + b, 0) / chunkCount;
    opts.onProgress(Math.min(99, Math.floor(done * 100)), `Fetching chat replay… ${messages.length.toLocaleString()} messages`);
  };

  const worker = async () => {
    while (nextChunk < chunkCount) {
      const idx = nextChunk++;
      const start = Math.floor(idx * chunkLen);
      const end = idx === chunkCount - 1 ? durationSeconds + 1 : Math.floor((idx + 1) * chunkLen);
      let page = await fetchPage(videoId, { contentOffsetSeconds: start }, opts.clientId, opts.signal);
      for (let guard = 0; guard < 100_000; guard++) {
        for (let i = 0; i < page.messages.length; i++) {
          const id = page.ids[i];
          const m = page.messages[i];
          if (seen.has(id) || m.t < start - 1 || m.t >= end) continue;
          seen.add(id);
          messages.push(m);
        }
        covered[idx] = Math.max(covered[idx], Math.min(1, (page.lastOffset - start) / Math.max(1, end - start)));
        if (!page.hasNextPage || !page.cursor || page.lastOffset >= end) break;
        report();
        page = await fetchPage(videoId, { cursor: page.cursor }, opts.clientId, opts.signal);
      }
      covered[idx] = 1;
      report();
    }
  };

  await Promise.all(Array.from({ length: Math.min(workers, chunkCount) }, () => worker()));
  messages.sort((a, b) => a.t - b.t);
  return messages;
}
