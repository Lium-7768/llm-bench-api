"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_CONFIG, loadConfig, saveConfig, type Config } from "./storage";

/**
 * 被测接口配置：存在浏览器本地，各页面共享同一份。
 * 用 useSyncExternalStore 订阅，服务端渲染时使用默认配置。
 */

let cached: Config | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): Config {
  return (cached ??= loadConfig());
}

function serverSnapshot(): Config {
  return DEFAULT_CONFIG;
}

export function updateConfig(patch: Partial<Config>) {
  cached = { ...snapshot(), ...patch };
  saveConfig(cached);
  listeners.forEach((l) => l());
}

export function useConfig() {
  const config = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return { config, update: updateConfig };
}

/** 返回配置缺项的提示，齐全时返回 null */
export function missingConfig(c: Config): string | null {
  if (!c.baseUrl.trim()) return "请填写接口地址";
  if (!c.apiKey.trim()) return "请填写 API Key";
  if (!c.model.trim()) return "请选择或填写模型";
  return null;
}
