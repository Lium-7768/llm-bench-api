import { NextResponse } from "next/server";

/** 统一响应包装，保证 API 输出稳定可解析 */
export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(
    { ok: true, data, error: null },
    {
      ...init,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        ...(init?.headers ?? {}),
      },
    },
  );
}

export function fail(
  message: string,
  status = 400,
  code = "bad_request",
  extra?: Record<string, unknown>,
) {
  return NextResponse.json(
    { ok: false, data: null, error: { code, message, ...(extra ?? {}) } },
    {
      status,
      headers: { "Access-Control-Allow-Origin": "*" },
    },
  );
}

export function preflight() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    },
  });
}

/**
 * 包装读取存储的调用：当存储（Redis）不可用时，返回结构化的 503，
 * 而不是让框架抛出空 body 的 500 —— 保证 API 始终返回统一信封结构。
 */
export async function withStore<T>(
  fn: () => Promise<T>,
  okBuilder: (data: T) => Response,
): Promise<Response> {
  try {
    return okBuilder(await fn());
  } catch (e) {
    return fail(
      `存储服务不可用：${(e as Error).message}`,
      503,
      "storage_unavailable",
      { hint: "请检查 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 是否正确，或移除它们以回退到内存存储。" },
    );
  }
}

/** 从请求里取 API Key：优先 header，其次 body */
export function extractApiKey(req: Request, bodyKey?: string): string | undefined {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const headerKey = req.headers.get("x-api-key");
  if (headerKey) return headerKey.trim();
  return bodyKey?.trim() || undefined;
}

/**
 * 校验 URL，避免 SSRF 到内网。
 *
 * 默认拒绝 localhost 与内网网段。如果确实需要评测本地模型
 * （例如 Ollama、LM Studio、vLLM），可显式设置环境变量
 * `ALLOW_PRIVATE_BASE_URL=true` 放开限制 —— 仅在自托管/本地开发时使用，
 * 公网部署切勿开启，否则接口会变成内网探测工具。
 */
export function isSafeBaseUrl(baseUrl: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;

    if (process.env.ALLOW_PRIVATE_BASE_URL === "true") return true;

    const host = u.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host)) return false;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
      return false;
    }
    if (host.endsWith(".internal") || host.endsWith(".local")) return false;
    return true;
  } catch {
    return false;
  }
}
