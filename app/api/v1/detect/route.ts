import { detectFingerprint } from "@/lib/fingerprint";
import { extractApiKey, fail, isSafeBaseUrl, ok, preflight } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export function OPTIONS() {
  return preflight();
}

interface DetectBody {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

/**
 * POST /api/v1/detect
 * 中转站 / 接口指纹检测：偷换模型、吞 system prompt、伪流式、剥离 usage。
 */
export async function POST(req: Request) {
  let body: DetectBody;
  try {
    body = (await req.json()) as DetectBody;
  } catch {
    return fail("请求体必须是合法 JSON", 400, "invalid_json");
  }

  const model = body.model?.trim();
  const baseUrl = body.baseUrl?.trim();
  const apiKey = extractApiKey(req, body.apiKey);

  if (!model) return fail("缺少 model 参数", 400, "missing_model");
  if (!baseUrl) return fail("缺少 baseUrl 参数", 400, "missing_base_url");
  if (!apiKey) return fail("缺少 API Key", 401, "missing_api_key");
  if (!isSafeBaseUrl(baseUrl)) {
    return fail("baseUrl 不合法或指向内网地址", 400, "unsafe_base_url");
  }

  try {
    const result = await detectFingerprint({
      baseUrl,
      apiKey,
      model,
      timeoutMs: body.timeoutMs ?? 20_000,
    });
    return ok({
      ...result,
      detectedAt: new Date().toISOString(),
      explanation: {
        clean: "全部检查通过，接口行为正常。",
        suspicious: "存在部分异常信号，建议进一步人工核对。",
        tampered: "检测到多项异常，该接口很可能被中转站改动过。",
        inconclusive:
          "探测未能完成（上游过慢或不可达），无法给出结论。请稍后重试，或检查该接口是否可用。",
      }[result.verdict],
    });
  } catch (e) {
    return fail(`检测失败: ${(e as Error).message}`, 502, "detect_failed");
  }
}
