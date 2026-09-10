import type { ChatMessage } from "./types";

const STOPWORDS = new Set(
  (
    "the a an and or but if is are was were be been to of in on at for with from by as it its this that " +
    "these those he she they we you i me my your our his her their them us im dont cant do does did not no " +
    "yes so just like what who how when where why which can could would should will about there here have " +
    "has had get got go going come came lol lmao omg wtf bro dude man guys chat"
  ).split(/\s+/)
);

function normaliseToken(token: string): string {
  return token.replace(/^[^\p{L}\p{N}!?@]+|[^\p{L}\p{N}!?]+$/gu, "");
}

/**
 * Returns the most repeated words and emotes in a set of messages. Emote-style
 * tokens (CamelCase, all caps) are preserved as written; other words are
 * lowercased. Repeated punctuation like "?????" is collapsed to a single token.
 */
export function topTerms(messages: ChatMessage[], limit = 5): string[] {
  const counts = new Map<string, { display: string; count: number }>();
  for (const m of messages) {
    const seen = new Set<string>();
    for (const rawToken of m.text.split(/\s+/)) {
      let token = normaliseToken(rawToken);
      if (!token) continue;
      if (/^[?!]+$/.test(token)) token = token[0].repeat(Math.min(3, token.length));
      const isEmoteLike = /^[A-Z][a-z]+[A-Z]/.test(token) || (/^[A-Z]{3,}$/.test(token) && token.length <= 12);
      const key = isEmoteLike ? token : token.toLowerCase();
      if (key.length < 2 && !/^[?!]/.test(key)) continue;
      if (STOPWORDS.has(key)) continue;
      if (/^!\w+/.test(key) && key.length > 1) {
        // chat commands like !enter are interesting; keep them
      }
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { display: isEmoteLike ? token : key, count: 1 });
    }
  }
  return Array.from(counts.values())
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((e) => e.display);
}

/** Picks representative messages: spread across the window, prefer distinct authors. */
export function pickSnippets(messages: ChatMessage[], limit = 10): ChatMessage[] {
  if (messages.length <= limit) return messages.slice();
  const stride = messages.length / limit;
  const out: ChatMessage[] = [];
  const authors = new Set<string>();
  for (let i = 0; i < limit; i++) {
    const base = Math.floor(i * stride);
    let pick = messages[base];
    for (let j = base; j < Math.min(messages.length, base + stride); j++) {
      if (!authors.has(messages[j].author)) {
        pick = messages[j];
        break;
      }
    }
    authors.add(pick.author);
    out.push(pick);
  }
  return out;
}
