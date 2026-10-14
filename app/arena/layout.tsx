import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "编程段位赛 — LLM Bench", robots: { index: false, follow: false } };

export default function ArenaLayout({ children }: { children: ReactNode }) {
  return children;
}
