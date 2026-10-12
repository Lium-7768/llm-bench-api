"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_CONFIG, loadConfig, saveConfig, type Config } from "@/lib/web/storage";

interface ConfigContext {
  config: Config;
  update: (patch: Partial<Config>) => void;
  /** 本地配置是否已读取完毕（首屏渲染时还没有） */
  ready: boolean;
}

const Ctx = createContext<ConfigContext>({ config: DEFAULT_CONFIG, update: () => {}, ready: false });

/** 接口配置在各页面之间共享，并保存在浏览器本地 */
export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConfig(loadConfig());
    setReady(true);
  }, []);

  const update = useCallback((patch: Partial<Config>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveConfig(next);
      return next;
    });
  }, []);

  return <Ctx.Provider value={{ config, update, ready }}>{children}</Ctx.Provider>;
}

export function useConfig() {
  return useContext(Ctx);
}

/** 返回配置缺项的提示，齐全时返回 null */
export function missingConfig(c: Config): string | null {
  if (!c.baseUrl.trim()) return "请填写接口地址";
  if (!c.apiKey.trim()) return "请填写 API Key";
  if (!c.model.trim()) return "请选择或填写模型";
  return null;
}
