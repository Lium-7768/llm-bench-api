import { PROTOCOL_LABELS } from "@/lib/presets";
import type { CheckStatus, DetectResult, Protocol, Report } from "@/lib/types";

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function protocolLabel(p: Protocol): string {
  return PROTOCOL_LABELS[p] ?? p;
}

/** 分数对应的色阶 */
export function tone(score: number | null): "good" | "mid" | "bad" | "none" {
  if (score === null) return "none";
  return score >= 80 ? "good" : score >= 60 ? "mid" : "bad";
}

export const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: "通过",
  warn: "存疑",
  fail: "异常",
  unsupported: "不支持",
  error: "未完成",
};

export const VERDICT_LABEL: Record<DetectResult["verdict"], string> = {
  clean: "未发现掺水",
  suspicious: "存在可疑项",
  tampered: "很可能掺水",
  inconclusive: "无法判断",
};

/**
 * 报告是否带有报错：任何一步失败或被跳过、有题目调用失败、指纹检测没跑通、或算不出综合分。
 * 带报错的报告结果不完整，不参与模型对比。
 */
export function hasError(r: Report): boolean {
  return (
    r.score === null ||
    Object.keys(r.errors ?? {}).length > 0 ||
    (r.basic?.failedCalls ?? 0) > 0 ||
    (r.candy?.failedCalls ?? 0) > 0 ||
    r.detect?.verdict === "inconclusive"
  );
}

/** 报错报告的一句话原因，用于在列表里展示 */
export function errorReason(r: Report): string {
  const stageError = Object.values(r.errors ?? {})[0];
  if (stageError) return stageError;
  const bench = [r.basic, r.candy].find((b) => b?.error || (b?.failedCalls ?? 0) > 0);
  if (bench?.error) return bench.error;
  if (bench) return `${bench.failedCalls} 题调用失败`;
  if (r.detect?.verdict === "inconclusive") return r.detect.checks.find((c) => c.status === "error")?.detail ?? "指纹检测没有完成";
  return "没有得出综合分";
}
