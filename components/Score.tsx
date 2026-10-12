"use client";

import { useEffect, useId, useState } from "react";

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

/** 光谱渐变的环形分数 */
export function ScoreDial({ score, label, size = 200 }: { score: number | null; label: string; size?: number }) {
  // useId 可能含冒号等字符，放进 url(#…) 前要清理
  const id = "dial" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const shown = useCountUp(score);
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = shown === null ? 0 : Math.max(0, Math.min(100, shown)) / 100;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} className="overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-violet)" />
            <stop offset="40%" stopColor="var(--color-blue)" />
            <stop offset="75%" stopColor="var(--color-cyan)" />
            <stop offset="100%" stopColor="var(--color-mint)" />
          </linearGradient>
        </defs>
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
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-tint)" strokeWidth="9" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform="rotate(-90 60 60)"
          style={{ filter: "drop-shadow(0 2px 6px rgb(124 58 237 / .35)) drop-shadow(0 0 14px rgb(8 145 178 / .25))" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <strong
          className="spectrum-text font-display leading-none font-bold tabular-nums"
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
        className="h-full origin-left rounded-full bg-gradient-to-r from-violet via-blue to-cyan shadow-[0_0_8px_rgb(124_58_237/0.3)]"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
