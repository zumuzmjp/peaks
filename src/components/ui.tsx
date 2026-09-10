import type { PeakReason } from "@/lib/analysis/types";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const REASON_LABEL: Record<PeakReason, string> = {
  both: "Chat + audio",
  chat: "Chat",
  audio: "Audio",
};

export const REASON_COLOR: Record<PeakReason, string> = {
  both: "var(--both)",
  chat: "var(--chat)",
  audio: "var(--audio)",
};

export function ReasonBadge({ reason, compact = false }: { reason: PeakReason; compact?: boolean }) {
  const bg = reason === "both" ? "bg-[var(--both-soft)]" : reason === "chat" ? "bg-[var(--chat-soft)]" : "bg-[var(--audio-soft)]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md ${bg} px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide`}
      style={{ color: REASON_COLOR[reason] }}
      title={REASON_LABEL[reason]}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: REASON_COLOR[reason] }} />
      {compact ? reason : REASON_LABEL[reason]}
    </span>
  );
}

export function scoreColor(score: number): string {
  if (score >= 80) return "var(--both)";
  if (score >= 60) return "#a3e635";
  if (score >= 40) return "var(--audio)";
  return "var(--muted)";
}

export function ScoreBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "h-12 w-12 text-lg" : size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm";
  return (
    <span
      className={`inline-flex ${dims} shrink-0 items-center justify-center rounded-lg border font-semibold tabular`}
      style={{ borderColor: scoreColor(score), color: scoreColor(score), background: "rgba(255,255,255,0.02)" }}
      title={`Score ${score} / 100`}
    >
      {score}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md";
  children: ReactNode;
};

export function Button({ variant = "outline", size = "md", className = "", children, ...rest }: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const sizes = size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm";
  const variants = {
    primary: "bg-accent text-[var(--accent-text)] hover:bg-white",
    ghost: "text-muted hover:bg-panel-2 hover:text-ink",
    outline: "border border-line bg-panel text-ink hover:border-line-strong hover:bg-panel-2",
    danger: "border border-line text-danger hover:bg-panel-2",
  }[variant];
  return (
    <button className={`${base} ${sizes} ${variants} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Panel({ children, className = "", title, aside }: { children: ReactNode; className?: string; title?: ReactNode; aside?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-line bg-panel shadow-panel ${className}`}>
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{children}</kbd>;
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M2 18 L7 9 L10.5 14 L14 5 L18 12 L22 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="14" cy="5" r="2" fill="var(--both)" />
      </svg>
      <span className="font-semibold tracking-[0.18em]">PEAKS</span>
    </span>
  );
}

/** Copies text and briefly flips the label. */
export function useCopy() {
  return async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };
}
