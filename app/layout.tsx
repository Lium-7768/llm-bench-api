import type { Metadata, Viewport } from "next";
import "@fontsource-variable/unbounded/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Bench — 大模型接口全面体检",
  description: "按顺序完成指纹检测、基础测试、糖果测试和鹈鹕测试，也可作为 API 直接接入。",
};

export const viewport: Viewport = {
  themeColor: "#fafafa",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="field-bg" aria-hidden />
        <Nav />
        <main className="mx-auto max-w-6xl px-4 pt-8 pb-16 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
