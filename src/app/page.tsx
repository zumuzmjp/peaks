import Link from "next/link";
import { Logo } from "@/components/ui";
import { generateDemoStream } from "@/lib/demo/fixture";
import { analyze, optionsForSensitivity } from "@/lib/analysis";
import { formatTimestamp } from "@/lib/time";
import { REASON_COLOR, REASON_LABEL } from "@/components/ui";

const FEATURES: Array<[string, string]> = [
  ["Two signals, one ranking", "Chat activity and audio loudness are scored against a rolling baseline. Moments where both react rank highest."],
  ["Editor-ready output", "Every peak comes with suggested in/out points, the chat context, a deep link into the VOD, and CSV/JSON export."],
  ["Explainable", "Each moment says why it was picked: how far chat surged over its baseline and how many dB the audio jumped."],
  ["Runs on your machine", "Chat replay and audio are pulled with yt-dlp and ffmpeg; nothing is uploaded anywhere."],
  ["Demo mode", "A synthetic three-hour stream with planted clutches, raids and mic peaks, so you can try the whole flow instantly."],
  ["Filters and search", "Narrow by signal, score, time range or what chat was saying. Sort by score or time. Exports follow the filters."],
];

function HeroPreview() {
  const stream = generateDemoStream("landing");
  const result = analyze({ durationSeconds: stream.durationSeconds, chat: stream.chat, loudness: stream.loudness, options: optionsForSensitivity("medium") });
  const top = result.peaks.slice(0, 5);
  const width = 600;
  const height = 110;
  const n = result.series.chatRate.length;
  const maxChat = Math.max(1, ...result.series.chatRate);
  const area = `M0,${height} ` + result.series.chatRate.map((v, i) => `L${((i / n) * width).toFixed(1)},${(height - (v / maxChat) * (height - 12)).toFixed(1)}`).join(" ") + ` L${width},${height} Z`;
  return (
    <div className="rounded-2xl border border-line bg-panel p-4 shadow-panel">
      <div className="mb-3 flex items-center justify-between text-xs text-muted">
        <span className="truncate">{stream.streamer} · {stream.title}</span>
        <span className="tabular shrink-0">{result.peaks.length} peaks</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full" preserveAspectRatio="none" aria-hidden>
        <path d={area} fill="var(--chat)" opacity={0.3} />
        {result.peaks.map((p) => (
          <line key={p.id} x1={(p.time / result.durationSeconds) * width} x2={(p.time / result.durationSeconds) * width} y1={height - 6 - (p.score / 100) * (height - 20)} y2={height} stroke={REASON_COLOR[p.reason]} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <ol className="mt-3 divide-y divide-line text-sm">
        {top.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2">
            <span className="tabular w-8 shrink-0 text-right font-semibold" style={{ color: p.score >= 80 ? "var(--both)" : "var(--audio)" }}>{p.score}</span>
            <span className="tabular w-16 shrink-0 text-ink">{formatTimestamp(p.time)}</span>
            <span className="w-24 shrink-0 text-[11px] uppercase tracking-wide" style={{ color: REASON_COLOR[p.reason] }}>{REASON_LABEL[p.reason]}</span>
            <span className="truncate text-muted">{p.headline}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function Landing() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Logo />
        <nav className="flex items-center gap-4 text-sm text-muted">
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="https://github.com/zumuzmjp/peaks" target="_blank" rel="noreferrer" className="hover:text-ink">GitHub</a>
          <Link href="/app" className="rounded-lg bg-accent px-3 py-1.5 font-medium text-[var(--accent-text)] hover:bg-white">Open app</Link>
        </nav>
      </header>

      <section className="grid items-center gap-10 py-10 lg:grid-cols-2 lg:py-16">
        <div className="grid gap-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">For clip editors</p>
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">
            Find the moments worth clipping in a five-hour stream.
          </h1>
          <p className="max-w-xl text-balance text-lg leading-relaxed text-muted">
            Paste a YouTube or Twitch VOD link. PEAKS reads the chat replay and the audio track, finds where both spike, and hands you a ranked list of clip moments with in/out points.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/app?demo" className="rounded-lg bg-accent px-5 py-3 text-sm font-medium text-[var(--accent-text)] hover:bg-white">Try the demo</Link>
            <Link href="/app?mode=live" className="rounded-lg border border-line bg-panel px-5 py-3 text-sm font-medium text-ink hover:border-line-strong hover:bg-panel-2">Analyse a VOD</Link>
          </div>
          <p className="text-xs text-faint">Works with finished YouTube live streams and Twitch VODs. Live analysis needs yt-dlp and ffmpeg on the server.</p>
        </div>
        <HeroPreview />
      </section>

      <section id="how" className="grid gap-8 py-10">
        <div className="grid gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">How it works</h2>
          <p className="max-w-2xl text-muted">The detector is deliberately simple and explainable. No models, no uploads; just two signals and a robust baseline.</p>
        </div>
        <ol className="grid gap-4 md:grid-cols-4">
          {[
            ["Fetch", "The chat replay is pulled from the platform and the audio track is downloaded once, at the lowest usable quality."],
            ["Bin", "Both signals are bucketed into 10-second bins: messages per minute, and loudness measured with ffmpeg's EBU R128 meter."],
            ["Detect", "Chat is compared with a rolling 10-minute median; loudness with the level just before each moment. Sustained level changes are ignored."],
            ["Rank", "Spikes from both signals are clustered into moments and scored 0–100. Moments where chat and audio react together win."],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-xl border border-line bg-panel p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-line text-[10px] text-ink">{i + 1}</span>
                {t}
              </div>
              <p className="text-sm leading-relaxed text-muted">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-6 py-10">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">What you get</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([t, d]) => (
            <div key={t} className="rounded-xl border border-line bg-panel p-4">
              <div className="mb-1 text-sm font-semibold text-ink">{t}</div>
              <p className="text-sm leading-relaxed text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border border-line bg-panel p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-ink">Run it locally</h2>
        <pre className="overflow-x-auto rounded-lg border border-line bg-elevated p-4 font-mono text-xs leading-relaxed text-ink">{`git clone https://github.com/zumuzmjp/peaks && cd peaks
npm install
cp .env.example .env      # optional: paths, limits
npm run dev               # http://localhost:3000`}</pre>
        <p className="text-sm text-muted">Demo mode works out of the box. For real VODs install <span className="font-mono text-ink">yt-dlp</span> and <span className="font-mono text-ink">ffmpeg</span>.</p>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2 py-8 text-xs text-faint">
        <span>PEAKS · chat + audio spike detection for stream VODs</span>
        <Link href="/app" className="hover:text-ink">Open the app →</Link>
      </footer>
    </main>
  );
}
