/**
 * Demo fixture: a deterministic, multi-hour Apex Legends ranked session with
 * realistic chat and loudness. Used whenever PEAKS runs in demo mode so the
 * product works end-to-end without API keys or external tools.
 *
 * The generator plants a set of known "moments" (clutches, wipes, heirloom,
 * raids, giveaways, mic peaks…) on top of a slowly varying baseline. Tests use
 * the planted events as ground truth for the detector.
 */

import type { ChatMessage, LoudnessSeries } from "../analysis/types";

export interface PlantedEvent {
  /** Seconds from stream start. */
  time: number;
  label: string;
  /** Which signals this event should show up in. */
  expect: "chat" | "audio" | "both";
  /** Peak chat multiplier over baseline. */
  chatMult: number;
  /** Seconds of elevated chat after the event. */
  chatDuration: number;
  /** Seconds chat lags the event (people react after they see it). */
  chatLag: number;
  /** Peak loudness boost in dB. */
  audioBoostDb: number;
  /** Seconds of elevated loudness. */
  audioDuration: number;
  /** Vocabulary chat uses during this event. */
  vocab: string[];
}

export interface DemoStream {
  title: string;
  streamer: string;
  game: string;
  durationSeconds: number;
  chat: ChatMessage[];
  loudness: LoudnessSeries;
  events: PlantedEvent[];
  peakViewers: number;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------

export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function poisson(rand: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gaussian(rand)));
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

// ---------------------------------------------------------------------------
// Stream structure
// ---------------------------------------------------------------------------

const STREAMER = "NovaApex";
const DURATION = 3 * 3600 + 12 * 60 + 40; // 3h 12m 40s

type SegmentKind = "starting" | "talk" | "drop" | "loot" | "fight" | "rotate" | "lobby" | "brb" | "outro";

interface Segment {
  start: number;
  end: number;
  kind: SegmentKind;
}

/** Fixed break window. Kept clear of every planted event so the quiet
 * baseline of the break never swallows a moment (events are hard-coded,
 * match pacing is seeded). */
const BRB_START = 90 * 60;
const BRB_END = 97 * 60 + 30;

/** Builds the phase timeline of the stream: intro, matches, break, outro. */
function buildSegments(rand: () => number): Segment[] {
  const raw: Segment[] = [];
  let t = 0;
  const push = (kind: SegmentKind, len: number) => {
    raw.push({ start: t, end: Math.min(DURATION, t + len), kind });
    t += len;
  };

  push("starting", 5 * 60 + 30);
  push("talk", 6 * 60);

  while (t < DURATION - 6 * 60) {
    // One match: lobby → drop → loot → (fight → rotate)* → lobby
    push("lobby", 60 + Math.floor(rand() * 60));
    push("drop", 60 + Math.floor(rand() * 30));
    push("loot", 90 + Math.floor(rand() * 90));
    const rounds = 2 + Math.floor(rand() * 3);
    for (let r = 0; r < rounds && t < DURATION - 8 * 60; r++) {
      push("fight", 40 + Math.floor(rand() * 60));
      push("rotate", 90 + Math.floor(rand() * 150));
    }
    push("fight", 45 + Math.floor(rand() * 45));
  }
  push("outro", DURATION - t);

  // Carve the break out of whatever match was running at the time.
  const segs: Segment[] = [];
  for (const s of raw) {
    if (s.end <= BRB_START || s.start >= BRB_END) {
      segs.push(s);
      continue;
    }
    if (s.start < BRB_START) segs.push({ start: s.start, end: BRB_START, kind: s.kind });
    if (s.end > BRB_END) segs.push({ start: BRB_END, end: s.end, kind: s.kind });
  }
  segs.push({ start: BRB_START, end: BRB_END - 90, kind: "brb" });
  segs.push({ start: BRB_END - 90, end: BRB_END, kind: "talk" });
  segs.sort((a, b) => a.start - b.start);
  return segs.filter((s) => s.end > s.start);
}

function segmentAt(segs: Segment[], t: number): Segment {
  // segments are sorted; linear scan with cached index would be faster but n is small
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].end <= t) lo = mid + 1;
    else hi = mid;
  }
  return segs[lo];
}

const CHAT_MULT: Record<SegmentKind, number> = {
  starting: 0.45,
  talk: 1.0,
  drop: 1.15,
  loot: 0.85,
  fight: 1.35,
  rotate: 0.9,
  lobby: 0.95,
  brb: 0.5,
  outro: 1.1,
};

const AUDIO_BASE_DB: Record<SegmentKind, number> = {
  starting: -27,
  talk: -24,
  drop: -19,
  loot: -25,
  fight: -19,
  rotate: -24,
  lobby: -26,
  brb: -38,
  outro: -23,
};

// ---------------------------------------------------------------------------
// Planted events
// ---------------------------------------------------------------------------

const HYPE = ["LETS GOOO", "POGGERS", "W", "CLIP IT", "?????", "NO WAY", "INSANE", "PogU", "gg", "HUGE", "LETSGO", "WWWW"];
const LAUGH = ["KEKW", "LMAOOO", "OMEGALUL", "LULW", "hahahaha", "im crying", "bruh", "LUL", "dead 💀"];
const SAD = ["F", "Sadge", "NOOO", "unlucky", "third party moment", "PepeHands", "robbed", "pain"];

const EVENTS: PlantedEvent[] = [
  {
    time: 11 * 60 + 30,
    label: "Hot drop at Fragment, instant squad wipe",
    expect: "both",
    chatMult: 4.5,
    chatDuration: 40,
    chatLag: 4,
    audioBoostDb: 9,
    audioDuration: 18,
    vocab: [...HYPE, "3 piece", "already?", "fragment W"],
  },
  {
    time: 24 * 60 + 10,
    label: "Cross-map Kraber headshot",
    expect: "both",
    chatMult: 7,
    chatDuration: 55,
    chatLag: 3,
    audioBoostDb: 11,
    audioDuration: 14,
    vocab: [...HYPE, "KRABER", "HEADSHOT", "how", "aimbot", "CLIP THAT"],
  },
  {
    time: 37 * 60 + 45,
    label: "Teammate walks off the edge of the map",
    expect: "chat",
    chatMult: 5.5,
    chatDuration: 50,
    chatLag: 5,
    audioBoostDb: 3,
    audioDuration: 12,
    vocab: [...LAUGH, "he just left", "bye", "gravity W", "KEKW"],
  },
  {
    time: 52 * 60 + 20,
    label: "1v3 clutch on 1 HP for the Champion",
    expect: "both",
    chatMult: 10,
    chatDuration: 75,
    chatLag: 3,
    audioBoostDb: 13,
    audioDuration: 25,
    vocab: [...HYPE, "CLUTCH", "1v3????", "CHAMPION", "1 HP", "HOW", "GOATED", "clip it", "masters incoming"],
  },
  {
    time: 65 * 60,
    label: "Heirloom shards drop from a pack",
    expect: "both",
    chatMult: 8,
    chatDuration: 70,
    chatLag: 2,
    audioBoostDb: 12,
    audioDuration: 16,
    vocab: [...HYPE, "HEIRLOOM", "SHARDS", "luckiest", "no way", "PogU", "which one", "wraith kunai"],
  },
  {
    time: 78 * 60 + 30,
    label: "Raid from another streamer, chat floods in",
    expect: "chat",
    chatMult: 6,
    chatDuration: 90,
    chatLag: 0,
    audioBoostDb: 1,
    audioDuration: 5,
    vocab: ["raidHype", "hello from Kai's stream", "RAID", "hi raiders", "welcome raiders", "kaiLove", "who is this"],
  },
  {
    time: 87 * 60 + 10,
    label: "Mic peaks: grenade jump scare scream",
    expect: "audio",
    chatMult: 1.3,
    chatDuration: 15,
    chatLag: 4,
    audioBoostDb: 14,
    audioDuration: 6,
    vocab: ["lol", "ears", "loud"],
  },
  {
    time: 108 * 60 + 40,
    label: "Third-partied at the end of a 20-kill game",
    expect: "both",
    chatMult: 6.5,
    chatDuration: 60,
    chatLag: 3,
    audioBoostDb: 10,
    audioDuration: 20,
    vocab: [...SAD, "ROBBED", "20 kills", "that hurts", "unlucky", "third party"],
  },
  {
    time: 122 * 60 + 15,
    label: "Misses every shot in a 1v1, chat spams KEKW",
    expect: "chat",
    chatMult: 4.8,
    chatDuration: 45,
    chatLag: 3,
    audioBoostDb: 2,
    audioDuration: 8,
    vocab: [...LAUGH, "0 damage", "aim", "washed", "KEKW", "he cant shoot"],
  },
  {
    time: 134 * 60 + 50,
    label: "Horizon lift + Fuse ult squad wipe",
    expect: "both",
    chatMult: 7.5,
    chatDuration: 55,
    chatLag: 3,
    audioBoostDb: 10,
    audioDuration: 16,
    vocab: [...HYPE, "COMBO", "SQUAD WIPE", "FUSE", "horizon", "cinema", "WIPE"],
  },
  {
    time: 148 * 60 + 30,
    label: "Phone alarm goes off on stream",
    expect: "audio",
    chatMult: 1.4,
    chatDuration: 20,
    chatLag: 3,
    audioBoostDb: 12,
    audioDuration: 9,
    vocab: ["alarm", "turn it off", "lol"],
  },
  {
    time: 161 * 60,
    label: "Giveaway announced, chat floods with entries",
    expect: "chat",
    chatMult: 9,
    chatDuration: 120,
    chatLag: 1,
    audioBoostDb: 1,
    audioDuration: 4,
    vocab: ["!enter", "!enter", "!enter", "me pls", "giveaway PogU", "!giveaway", "how to enter", "!enter 🙏"],
  },
  {
    time: 175 * 60 + 20,
    label: "Second Champion with a 2,800 damage badge",
    expect: "both",
    chatMult: 9.5,
    chatDuration: 80,
    chatLag: 3,
    audioBoostDb: 12,
    audioDuration: 22,
    vocab: [...HYPE, "CHAMPION", "2800", "BADGE", "DEMON", "GOAT", "2 wins", "clip clip clip"],
  },
  {
    time: 184 * 60 + 45,
    label: "Sub goal hit, hype train level 5",
    expect: "chat",
    chatMult: 5,
    chatDuration: 70,
    chatLag: 1,
    audioBoostDb: 4,
    audioDuration: 20,
    vocab: ["HYPE TRAIN", "sub goal", "PogU", "thank you all", "novaLove", "level 5", "gifted", "wholesome"],
  },
  {
    time: 190 * 60 + 30,
    label: "Raid out to a friend, goodbye spam",
    expect: "chat",
    chatMult: 3.8,
    chatDuration: 60,
    chatLag: 0,
    audioBoostDb: 2,
    audioDuration: 10,
    vocab: ["bye", "novaWave", "gn", "good stream", "raiding", "o7", "see you tomorrow"],
  },
];

// ---------------------------------------------------------------------------
// Chat vocabulary
// ---------------------------------------------------------------------------

const NORMAL_MESSAGES = [
  "what sens do you use",
  "!sens",
  "!rank",
  "!settings",
  "hi from germany",
  "first time here, this is cracked",
  "is this ranked?",
  "how many hours do you have",
  "which legend is best rn",
  "lol",
  "true",
  "no shot",
  "W chat",
  "L take",
  "gg",
  "ez",
  "whats the rp right now",
  "play horizon",
  "drop fragment",
  "rotate early",
  "he's one",
  "behind you",
  "they're in the building",
  "nice",
  "clean",
  "sheesh",
  "hello",
  "hi nova",
  "what rank are you",
  "how is the new season",
  "is the kraber good now",
  "this map is so bad",
  "storm point W",
  "nerf horizon",
  "who are you playing with",
  "your teammate is cracked",
  "F",
  "KEKW",
  "LUL",
  "PogU",
  "monkaS",
  "any tips for movement",
  "can you do a tap strafe tutorial",
  "how do you get so many kills",
  "GOATED",
  "?",
  "!discord",
  "!socials",
  "love the stream",
  "been here 3 hours lol",
  "ping is high today",
  "servers are cooked",
  "did you see that",
  "nice shot",
  "heal up",
  "grab the bat",
  "purple shield gg",
  "wattson W",
];

const FIRST = ["Shadow", "Nova", "Pixel", "Kai", "Luna", "Drift", "Ace", "Frost", "Vex", "Zed", "Mira", "Rook", "Echo", "Juno", "Blaze", "Otto", "Nyx", "Rex", "Sage", "Ivy", "Bolt", "Cass", "Dex", "Finn", "Gale", "Hex", "Iris", "Jett", "Kit", "Lux"];
const LAST = ["Runner", "Slayer", "Apex", "TV", "Plays", "Gaming", "Wave", "Zone", "Fox", "Wolf", "Storm", "Byte", "Main", "Clips", "Live", "Edits", "Yt", "Ttv", "One", "Prime", "Legend", "Rush"];

function buildAuthors(rand: () => number, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const style = rand();
    let name = `${pick(rand, FIRST)}${pick(rand, LAST)}`;
    if (style < 0.35) name += Math.floor(rand() * 999);
    else if (style < 0.5) name = `${pick(rand, FIRST).toLowerCase()}_${pick(rand, LAST).toLowerCase()}`;
    else if (style < 0.6) name = `xX${pick(rand, FIRST)}Xx`;
    out.push(name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

function eventEnvelope(t: number, ev: PlantedEvent): { chat: number; audio: number } {
  // Chat: lag, fast rise, then exponential decay over chatDuration.
  const dtChat = t - (ev.time + ev.chatLag);
  let chat = 0;
  if (dtChat >= 0 && dtChat <= ev.chatDuration * 1.5) {
    const rise = Math.min(1, dtChat / 6);
    const decay = Math.exp(-dtChat / (ev.chatDuration * 0.45));
    chat = (ev.chatMult - 1) * rise * decay;
  }
  // Audio: near-instant attack, hold, quick decay.
  const dtAudio = t - ev.time;
  let audio = 0;
  if (dtAudio >= -1 && dtAudio <= ev.audioDuration * 1.6) {
    const attack = Math.min(1, (dtAudio + 1) / 2.5);
    const hold = dtAudio <= ev.audioDuration * 0.6 ? 1 : Math.exp(-(dtAudio - ev.audioDuration * 0.6) / (ev.audioDuration * 0.35));
    audio = ev.audioBoostDb * attack * hold;
  }
  return { chat, audio };
}

/**
 * Generates the demo stream. The same seed always produces the same stream;
 * different seeds vary the noise and match pacing but keep the planted events.
 */
export function generateDemoStream(seedInput = "peaks-demo"): DemoStream {
  const rand = mulberry32(hashSeed(seedInput));
  const segments = buildSegments(rand);
  const authors = buildAuthors(rand, 420);
  const events = EVENTS;

  const chat: ChatMessage[] = [];
  const db: number[] = new Array(DURATION);

  // Viewer count ramps from ~900 to ~4,200 over the first 50 minutes, sags
  // during the break, and climbs again toward the end.
  const viewersAt = (t: number) => {
    const ramp = 900 + 3300 * Math.min(1, t / (50 * 60));
    const breakDip = t > BRB_START && t < BRB_END + 3 * 60 ? 0.8 : 1;
    const late = t > 150 * 60 ? 1 + 0.08 * ((t - 150 * 60) / (40 * 60)) : 1;
    return ramp * breakDip * late;
  };

  // Slow random walk in mood so the baseline isn't perfectly flat.
  let mood = 1;
  let audioWobble = 0;
  let activeVocab: string[] | null = null;
  let activeVocabUntil = -1;

  for (let t = 0; t < DURATION; t++) {
    const seg = segmentAt(segments, t);
    if (t % 30 === 0) mood = Math.max(0.7, Math.min(1.35, mood + gaussian(rand) * 0.06));
    audioWobble = audioWobble * 0.92 + gaussian(rand) * 0.6;

    let chatBoost = 0;
    let audioBoost = 0;
    for (const ev of events) {
      if (t < ev.time - 2 || t > ev.time + Math.max(ev.chatDuration * 1.5, ev.audioDuration * 1.6) + ev.chatLag) continue;
      const env = eventEnvelope(t, ev);
      chatBoost += env.chat;
      audioBoost = Math.max(audioBoost, env.audio);
      if (env.chat > 0.6) {
        activeVocab = ev.vocab;
        activeVocabUntil = t + 3;
      }
    }

    // Small unplanned fight bursts keep the fixture from being too clean.
    let minorAudio = 0;
    if (seg.kind === "fight") {
      minorAudio = Math.max(0, gaussian(rand) * 1.6);
      if (rand() < 0.01) minorAudio += 3 + rand() * 3;
    }

    const baseRatePerSec = (viewersAt(t) / 1000) * 0.42 * CHAT_MULT[seg.kind] * mood;
    const lambda = baseRatePerSec * (1 + chatBoost);
    const count = poisson(rand, lambda);
    const useVocab = activeVocab && t <= activeVocabUntil ? activeVocab : null;
    for (let k = 0; k < count; k++) {
      const author = authors[Math.floor(rand() * authors.length)];
      let text: string;
      if (useVocab && rand() < Math.min(0.9, 0.35 + chatBoost * 0.08)) {
        text = pick(rand, useVocab);
        if (rand() < 0.25) text = `${text} ${pick(rand, useVocab)}`;
      } else {
        text = pick(rand, NORMAL_MESSAGES);
        if (rand() < 0.05) text = `@${STREAMER} ${text}`;
      }
      chat.push({ t: t + rand(), author, text });
    }

    const base = AUDIO_BASE_DB[seg.kind];
    const noise = gaussian(rand) * 1.4 + audioWobble;
    const value = base + noise + audioBoost + minorAudio;
    db[t] = Math.round(Math.max(-70, Math.min(-3, value)) * 10) / 10;
  }

  chat.sort((a, b) => a.t - b.t);

  return {
    title: "RANKED GRIND TO MASTERS | 2 CHAMPIONS ALREADY | !sens !settings",
    streamer: STREAMER,
    game: "Apex Legends",
    durationSeconds: DURATION,
    chat,
    loudness: { stepSeconds: 1, db },
    events,
    peakViewers: 4500,
  };
}
