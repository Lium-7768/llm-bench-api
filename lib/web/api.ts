import type { Envelope, Protocol } from "@/lib/types";

/**
 * 浏览器端调用本站 API。前端走的就是对外公开的同一套接口。
 */

export interface TargetInput {
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  model: string;
}

function request(path: string, target: Partial<TargetInput>, body: object, signal?: AbortSignal) {
  const { apiKey, ...rest } = target;
  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ ...rest, ...body }),
    signal,
  });
}

export async function postApi<T>(
  path: string,
  target: Partial<TargetInput>,
  body: object = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await request(path, target, body, signal);
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!json) throw new Error(`服务返回异常（HTTP ${res.status}），可能是执行超时`);
  if (!json.ok) throw new Error(json.error.message);
  return json.data;
}

/** 调用 SSE 接口，逐个回调事件 */
export async function streamApi<E>(
  path: string,
  target: TargetInput,
  body: object,
  onEvent: (event: E) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await request(path, target, { ...body, stream: true }, signal);
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => null)) as Envelope<unknown> | null;
    throw new Error(json && !json.ok ? json.error.message : `请求失败（HTTP ${res.status}）`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data) continue;
      const event = JSON.parse(data) as E & { type: string; message?: string };
      if (event.type === "error") throw new Error(event.message ?? "评测中断");
      onEvent(event);
    }
  }
}
