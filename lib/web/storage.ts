"use client";

import { useEffect, useState } from "react";
import type { Protocol, Report } from "@/lib/types";

/**
 * 浏览器本地存储。所有结果只存在当前浏览器，服务端不保存任何东西。
 * 读写都包在 try/catch 里：隐私模式或禁用存储时页面照常可用，只是不记历史。
 */

// ---------------------------------------------------------------- 接口配置

export interface Config {
  presetId: string;
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 是否把密钥保存在本地；关闭时只保存在当前标签页 */
  rememberKey: boolean;
  /** 能力评测题量，0 表示全部 */
  limit: number;
  seed: number;
}

const CONFIG_KEY = "llmbench.config";
const SESSION_KEY = "llmbench.key";

export const DEFAULT_CONFIG: Config = {
  presetId: "openai",
  protocol: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "",
  rememberKey: true,
  limit: 0,
  seed: 42,
};

export function loadConfig(): Config {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "null") as Partial<Config> | null;
    const config = { ...DEFAULT_CONFIG, ...saved };
    if (!config.rememberKey) config.apiKey = sessionStorage.getItem(SESSION_KEY) ?? "";
    return config;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: Config) {
  try {
    const { apiKey, ...rest } = config;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config.rememberKey ? config : { ...rest, apiKey: "" }));
    if (config.rememberKey) sessionStorage.removeItem(SESSION_KEY);
    else sessionStorage.setItem(SESSION_KEY, apiKey);
  } catch {
    // 存储不可用时忽略
  }
}

// ---------------------------------------------------------------- 历史记录

// 报告结构改过一次，换新键名，避免读到旧格式
const HISTORY_KEY = "llmbench.reports.v2";
const HISTORY_EVENT = "llmbench:history";
const MAX_ITEMS = 60;

export function loadHistory(): Report[] {
  try {
    const items = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeHistory(items: Report[]) {
  // 空间不够时从最旧的开始丢
  for (let keep = items.length; keep >= 0; keep = Math.floor(keep * 0.8)) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, keep)));
      break;
    } catch {
      if (keep === 0) break;
    }
  }
  window.dispatchEvent(new Event(HISTORY_EVENT));
}

/** 存入历史。绘图已提取出 SVG 时丢掉原始回答以节省空间 */
export function addHistory(report: Report) {
  const slim: Report = report.pelican?.svg ? { ...report, pelican: { ...report.pelican, raw: "" } } : report;
  writeHistory([slim, ...loadHistory().filter((h) => h.id !== report.id)].slice(0, MAX_ITEMS));
}

export function removeHistory(id: string) {
  writeHistory(loadHistory().filter((h) => h.id !== id));
}

export function clearHistory() {
  writeHistory([]);
}

/** 导入别人导出的 JSON，按 id 去重 */
export function importHistory(items: unknown): number {
  if (!Array.isArray(items)) throw new Error("不是数组");
  const valid = items.filter(
    (h): h is Report => !!h && typeof h.id === "string" && typeof h.model === "string" && Array.isArray(h.stages),
  );
  const existing = loadHistory();
  const ids = new Set(existing.map((h) => h.id));
  const fresh = valid.filter((h) => !ids.has(h.id));
  writeHistory([...fresh, ...existing].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, MAX_ITEMS));
  return fresh.length;
}

/** 订阅历史记录，跨标签页同步；首屏读取前为 null */
export function useHistory(): Report[] | null {
  const [items, setItems] = useState<Report[] | null>(null);
  useEffect(() => {
    const sync = () => setItems(loadHistory());
    sync();
    window.addEventListener(HISTORY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(HISTORY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return items;
}
