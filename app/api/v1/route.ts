import { ALL_CATEGORIES, BANK_VERSION, CATEGORY_LABELS, QUESTIONS } from "@/lib/bank";
import { ok, preflight } from "@/lib/http";
import { PRESETS } from "@/lib/presets";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** API 索引，兼作健康检查 */
export function GET() {
  return ok({
    name: "LLM Bench API",
    description: "大模型接口全面检测：指纹检测、基础测试、糖果测试、鹈鹕测试。服务端无状态，不保存任何数据和密钥。",
    bankVersion: BANK_VERSION,
    totalQuestions: QUESTIONS.length,
    protocols: ["openai", "anthropic", "gemini"],
    stages: ["detect", "basic", "candy", "pelican"],
    endpoints: [
      { method: "GET", path: "/api/v1", desc: "本索引" },
      { method: "GET", path: "/api/v1/openapi", desc: "OpenAPI 3.1 描述" },
      { method: "GET", path: "/api/v1/questions", desc: "题库" },
      { method: "POST", path: "/api/v1/models", desc: "列出被测接口可用的模型" },
      { method: "POST", path: "/api/v1/check", desc: "全面检测：指纹 → 基础 → 糖果 → 鹈鹕，按顺序执行；stream=true 时以 SSE 推送进度" },
    ],
    auth: "Authorization: Bearer <被测接口的 API Key>，仅在单次请求中转发给上游",
    categories: ALL_CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
    presets: PRESETS.filter((p) => p.baseUrl).map(({ id, name, protocol, baseUrl }) => ({
      id,
      name,
      protocol,
      baseUrl,
    })),
  });
}
