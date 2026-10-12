import { DEFAULT_BASE_URL, resolveProtocol } from "./llm";
import type { Target } from "./types";

/**
 * 路由共用的 HTTP 工具：统一信封、CORS、读取被测接口、SSE。
 * 服务端无状态，任何请求数据都不落盘。
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
  "Cache-Control": "no-store",
};

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ ok: true, data, error: null }, { ...init, headers: CORS });
}

export function fail(message: string, status = 400, code = "bad_request"): Response {
  return Response.json({ ok: false, data: null, error: { code, message } }, { status, headers: CORS });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** 读取 JSON 请求体；失败时返回错误响应 */
export async function readJson<T>(req: Request): Promise<T | Response> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") throw new Error();
    return body as T;
  } catch {
    return fail("请求体必须是 JSON 对象", 400, "invalid_json");
  }
}

export interface TargetBody {
  protocol?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

/**
 * 从请求中取出被测接口。
 * 密钥优先读 `Authorization: Bearer`，其次 `X-Api-Key`，最后 body.apiKey。
 * 只给 protocol 不给 baseUrl 时使用该协议的官方地址。
 */
export function readTarget(req: Request, body: TargetBody, { requireModel = true } = {}): Target | Response {
  const auth = req.headers.get("authorization");
  const apiKey =
    (auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7) : undefined)?.trim() ||
    req.headers.get("x-api-key")?.trim() ||
    body.apiKey?.trim();
  const model = body.model?.trim() ?? "";

  if (body.protocol && !["openai", "anthropic", "gemini"].includes(body.protocol)) {
    return fail("protocol 只能是 openai / anthropic / gemini", 400, "invalid_protocol");
  }
  if (!body.baseUrl?.trim() && !body.protocol) {
    return fail("缺少 baseUrl（或至少给出 protocol 以使用官方地址）", 400, "missing_base_url");
  }
  const protocol = resolveProtocol(body.baseUrl ?? "", body.protocol);
  const baseUrl = body.baseUrl?.trim() || DEFAULT_BASE_URL[protocol];

  if (!isSafeBaseUrl(baseUrl)) {
    return fail("baseUrl 不合法或指向内网地址", 400, "unsafe_base_url");
  }
  if (!apiKey) {
    return fail("缺少 API Key：请用 Authorization: Bearer <key> 传入", 401, "missing_api_key");
  }
  if (requireModel && !model) return fail("缺少 model", 400, "missing_model");

  return { protocol, baseUrl, apiKey, model };
}

/** 把事件流包装成 SSE 响应：每个事件一条 `event: <type>` + `data: <json>` */
export function sse<E extends { type: string }>(events: AsyncIterable<E>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (type: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        for await (const e of events) send(e.type, e);
      } catch (e) {
        send("error", { type: "error", message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * 拒绝指向本机和内网的地址，防止服务被当作内网探测工具（SSRF）。
 * 自托管评测本地模型（Ollama、vLLM…）时可设置 ALLOW_PRIVATE_BASE_URL=true，公网部署切勿开启。
 */
export function isSafeBaseUrl(baseUrl: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (process.env.ALLOW_PRIVATE_BASE_URL === "true") return true;

    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost")) return false;
    if (host.endsWith(".internal") || host.endsWith(".local")) return false;
    if (/^(0|10|127)\./.test(host)) return false;
    if (/^169\.254\./.test(host) || /^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return false;
    if (host.includes(":") && (host === "::" || host === "::1" || /^(f[cd]|fe80|::ffff:)/i.test(host))) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
