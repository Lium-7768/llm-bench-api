import { useSyncExternalStore } from "react";

/**
 * 编程彩蛋的解锁令牌，只放 sessionStorage：关掉标签页就没了，也不进历史记录。
 * 页面直接打开时读不到令牌，就什么都不显示。
 */

const KEY = "llmbench.egg";
const EVENT = "llmbench:egg";

export interface Egg {
  token: string;
  expiresAt: string;
  /** 解锁它的那份报告，段位赛结果会补进这份报告 */
  reportId: string;
  model: string;
}

export function saveEgg(egg: Egg) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(egg));
  } catch {
    // 存储不可用时彩蛋就不出现
  }
  window.dispatchEvent(new Event(EVENT));
}

/** 快照返回原始字符串（同一内容引用不变），过期的当作没有 */
function read(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const expiresAt = raw && (JSON.parse(raw) as Partial<Egg>).expiresAt;
    return expiresAt && Date.parse(expiresAt) > Date.now() ? raw : null;
  } catch {
    return null;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** 当前有效的令牌；服务端渲染和首帧为 undefined，读不到或已过期为 null */
export function useEgg(): Egg | null | undefined {
  const raw = useSyncExternalStore(subscribe, read, () => undefined);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw ?? "null") as Egg | null;
  } catch {
    return null;
  }
}
