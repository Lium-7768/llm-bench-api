"use client";

import { BookOpenText, GitCompareArrows, History, Radar, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const LINKS = [
  { href: "/", label: "检测", Icon: Radar },
  { href: "/compare", label: "对比", Icon: GitCompareArrows },
  { href: "/history", label: "历史", Icon: History },
  { href: "/docs", label: "API", Icon: BookOpenText },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/75 backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-4 px-4 py-2 sm:gap-6 sm:px-6">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link href="/" className="flex items-center gap-2.5 font-display text-base font-semibold">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg spectrum-bg animate-flow shadow-[0_4px_14px_-2px_rgb(124_58_237/0.5)]">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
                <path d="M3 18V12M7 18V7M11 18V10M15 18V4M19 18V9" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </span>
            LLM Bench
          </Link>
          <p className="flex items-center gap-1 text-[11px] leading-snug text-faint">
            <ShieldCheck size={12} className="shrink-0 text-mint" aria-hidden />
            服务端不保存结果和密钥，历史记录只存在你的浏览器。
          </p>
        </div>
        <nav className="ml-auto flex shrink-0 gap-1" aria-label="主导航">
          {LINKS.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-label={label}
              className={cx(
                "flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition",
                path === href ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-readout hover:bg-surface/70 hover:text-ink",
              )}
            >
              <Icon size={17} aria-hidden />
              <span className="hidden md:inline">{label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
