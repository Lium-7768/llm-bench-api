import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Bench API —— 大模型能力评测接口",
  description:
    "API 优先的大模型能力评测服务：能力测试、幻觉抵抗、指令遵循、中转站指纹检测。前端仅展示后端返回的数据。",
};

const NAV = [
  { href: "/", label: "总览" },
  { href: "/run", label: "发起评测" },
  { href: "/leaderboard", label: "排行榜" },
  { href: "/detect", label: "接口检测" },
  { href: "/runs", label: "历史记录" },
  { href: "/docs", label: "API 文档" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>
        <nav className="nav">
          <div className="nav-inner">
            <Link href="/" className="brand">
              LLM Bench API
            </Link>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="link">
                {n.label}
              </Link>
            ))}
          </div>
        </nav>
        <main className="wrap">{children}</main>
        <footer className="wrap footer">
          API 优先设计 · 前端只负责渲染后端返回的数据 · 密钥不经服务端存储
        </footer>
      </body>
    </html>
  );
}
