"use client";

import { useEffect, useState } from "react";

/** 数字从 0 滚动到目标值；减少动态效果时直接显示终值 */
export function useCountUp(target: number | null, duration = 1600): number | null {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === null) return;
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = instant ? 1 : Math.min(1, (now - start) / duration);
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return target === null ? null : value;
}

/** 环形分数：墨色进度环 */
export function ScoreDial({ score, label, size = 200 }: { score: number | null; label: string; size?: number }) {
  const shown = useCountUp(score);
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = shown === null ? 0 : Math.max(0, Math.min(100, shown)) / 100;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} className="overflow-visible" aria-hidden>
        {/* 刻度 */}
        {Array.from({ length: 60 }, (_, i) => (
          <line
            key={i}
            x1="60"
            y1="2"
            x2="60"
            y2={i % 5 === 0 ? 7 : 5}
            stroke="currentColor"
            className="text-line"
            strokeWidth={i % 5 === 0 ? 1.2 : 0.6}
            transform={`rotate(${i * 6} 60 60)`}
          />
        ))}
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-tint-2)" strokeWidth="6" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <strong
          className="font-display leading-none font-bold spectrum-text tabular-nums"
          style={{ fontSize: size * 0.26 }}
        >
          {shown === null ? "—" : Math.round(shown)}
        </strong>
        <span className="mt-2 text-xs text-readout">{label}</span>
      </div>
    </div>
  );
}

/** 光谱渐变条 */
export function Bar({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-tint-2">
      <div
        className="h-full origin-left rounded-full bg-ink"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
