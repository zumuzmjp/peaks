import type { ChatMessage } from "../analysis/types";

type Json = Record<string, unknown>;

function asObject(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

function runsToText(message: unknown): string {
  const m = asObject(message);
  if (!m) return "";
  if (typeof m.simpleText === "string") return m.simpleText;
  const runs = Array.isArray(m.runs) ? m.runs : [];
  const parts: string[] = [];
  for (const run of runs) {
    const r = asObject(run);
    if (!r) continue;
    if (typeof r.text === "string") parts.push(r.text);
    else {
      const emoji = asObject(r.emoji);
      const shortcuts = emoji && Array.isArray(emoji.shortcuts) ? (emoji.shortcuts as unknown[]) : [];
      const label = typeof shortcuts[0] === "string" ? shortcuts[0] : typeof emoji?.emojiId === "string" ? emoji.emojiId : "";
      if (label) parts.push(String(label));
    }
  }
  return parts.join("").trim();
}

const MESSAGE_RENDERERS = ["liveChatTextMessageRenderer", "liveChatPaidMessageRenderer", "liveChatMembershipItemRenderer", "liveChatPaidStickerRenderer"];

/**
 * Parses one line of a yt-dlp `.live_chat.json` file (one replay action per
 * line). Returns null for system messages, placeholders and tickers.
 */
export function parseYouTubeChatLine(line: string): ChatMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  const root = asObject(data);
  const replay = asObject(root?.replayChatItemAction);
  if (!replay) return null;
  const offsetMs = Number(replay.videoOffsetTimeMsec);
  if (!Number.isFinite(offsetMs)) return null;
  const actions = Array.isArray(replay.actions) ? replay.actions : [];
  for (const action of actions) {
    const add = asObject(asObject(action)?.addChatItemAction);
    const item = asObject(add?.item);
    if (!item) continue;
    for (const key of MESSAGE_RENDERERS) {
      const r = asObject(item[key]);
      if (!r) continue;
      const author = runsToText(r.authorName).replace(/^@/, "") || "unknown";
      const text = runsToText(r.message) || (key === "liveChatPaidStickerRenderer" ? "[sticker]" : "");
      if (!text) continue;
      return { t: Math.max(0, offsetMs / 1000), author, text };
    }
  }
  return null;
}

/** Parses a whole `.live_chat.json` file. */
export function parseYouTubeChatFile(contents: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = parseYouTubeChatLine(line);
    if (m) out.push(m);
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
