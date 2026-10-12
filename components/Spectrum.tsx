import { cx } from "./ui";

export type BarState = "wait" | "pass" | "warn" | "fail" | "error";

export interface SpectrumBar {
  key: string;
  state: BarState;
  /** 0-1，柱高 */
  level?: number;
  title?: string;
}

const FILL: Record<BarState, string> = {
  wait: "bg-tint-2",
  pass: "bg-gradient-to-t from-violet via-blue to-cyan shadow-[0_4px_14px_-4px_rgb(37_99_235/0.55)]",
  warn: "bg-gradient-to-t from-amber/60 to-amber shadow-[0_4px_12px_-4px_rgb(217_119_6/0.5)]",
  fail: "bg-gradient-to-t from-rose/60 to-rose shadow-[0_4px_12px_-4px_rgb(225_29_72/0.5)]",
  error: "bg-faint/50",
};

/** 运行中的光谱：每一项检测结果是一根柱子 */
export function Spectrum({ bars, height = 132 }: { bars: SpectrumBar[]; height?: number }) {
  return (
    <div className="flex items-end gap-[3px]" style={{ height }} role="img" aria-label="检测进度光谱">
      {bars.map((b) => (
        <div key={b.key} className="relative flex h-full min-w-0 flex-1 items-end" title={b.title}>
          <div
            className={cx(
              "w-full rounded-t-[3px] transition-[height] duration-700 ease-[cubic-bezier(.2,1.4,.4,1)]",
              FILL[b.state],
              b.state === "wait" && "animate-blink",
            )}
            style={{ height: b.state === "wait" ? "10%" : `${Math.round(18 + (b.level ?? 0.5) * 82)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/** 待机光谱：首页的波形，表示仪器在线 */
export function IdleSpectrum({ count = 64, height = 120 }: { count?: number; height?: number }) {
  return (
    <div className="flex items-end gap-[3px] max-sm:[&>*:nth-child(2n)]:hidden" style={{ height }} aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const level = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11));
        return (
          <div
            key={i}
            className="flex-1 origin-bottom animate-wave rounded-t-[3px] bg-gradient-to-t from-violet/80 via-blue/75 to-cyan/80"
            style={{ height: `${level * 100}%`, animationDelay: `${-(i % 16) * 0.14}s`, opacity: 0.35 + level * 0.55 }}
          />
        );
      })}
    </div>
  );
}

/** 延迟映射到 0-1 柱高（对数刻度，100ms 低、30s 满） */
export function latencyLevel(ms?: number): number {
  if (!ms || ms <= 0) return 0.4;
  return Math.max(0.08, Math.min(1, Math.log10(ms / 100) / Math.log10(300)));
}
