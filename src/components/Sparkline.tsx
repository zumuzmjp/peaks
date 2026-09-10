"use client";

/** Small dual-series chart used in the peak detail: chat bars behind a loudness line. */
export function Sparkline({
  chat,
  db,
  binSeconds,
  startTime,
  markerTime,
  clipIn,
  clipOut,
  height = 96,
}: {
  chat: number[];
  db: number[];
  binSeconds: number;
  startTime: number;
  markerTime: number;
  clipIn: number;
  clipOut: number;
  height?: number;
}) {
  const n = Math.max(chat.length, db.length);
  if (n === 0) return null;
  const width = 600;
  const padTop = 6;
  const padBottom = 4;
  const innerH = height - padTop - padBottom;
  const maxChat = Math.max(1, ...chat);
  const dbMin = Math.min(...db) - 2;
  const dbMax = Math.max(...db) + 2;
  const x = (i: number) => (i / n) * width;
  const bw = width / n;
  const yChat = (v: number) => padTop + innerH - (v / maxChat) * innerH;
  const yDb = (v: number) => padTop + innerH - ((v - dbMin) / Math.max(1, dbMax - dbMin)) * innerH;
  const line = db.map((v, i) => `${i === 0 ? "M" : "L"}${(x(i) + bw / 2).toFixed(1)},${yDb(v).toFixed(1)}`).join(" ");
  const tx = (t: number) => ((t - startTime) / (n * binSeconds)) * width;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label="Chat rate and loudness around this moment">
      <rect x={tx(clipIn)} y={0} width={Math.max(0, tx(clipOut) - tx(clipIn))} height={height} fill="rgba(255,255,255,0.05)" />
      {chat.map((v, i) => (
        <rect key={i} x={x(i) + 0.5} y={yChat(v)} width={Math.max(0.5, bw - 1)} height={padTop + innerH - yChat(v)} fill="var(--chat)" opacity={0.45} />
      ))}
      <path d={line} fill="none" stroke="var(--audio)" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
      <line x1={tx(markerTime)} x2={tx(markerTime)} y1={0} y2={height} stroke="var(--text)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
