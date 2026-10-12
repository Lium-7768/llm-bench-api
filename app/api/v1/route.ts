import { ok, preflight } from "@/lib/http";
import { ALL_CATEGORIES, BANK_VERSION, CATEGORY_LABELS, QUESTIONS } from "@/lib/bank";
import { ENGINE_VERSION } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** API 索引：让调用方自己发现有哪些能力 */
export function GET() {
  return ok({
    name: "LLM Bench API",
    description: "大模型能力评测与接口指纹检测 API",
    version: "1.0.0",
    engineVersion: ENGINE_VERSION,
    bankVersion: BANK_VERSION,
    totalQuestions: QUESTIONS.length,
    endpoints: [
      { method: "GET", path: "/api/v1", desc: "本索引" },
      { method: "GET", path: "/api/v1/health", desc: "健康检查" },
      { method: "GET", path: "/api/v1/categories", desc: "评测维度列表" },
      { method: "GET", path: "/api/v1/questions", desc: "题库，支持 ?category= 与 ?limit=" },
      { method: "POST", path: "/api/v1/runs", desc: "提交一次评测（同步执行并返回结果）" },
      { method: "GET", path: "/api/v1/runs", desc: "评测历史列表 ?limit=" },
      { method: "GET", path: "/api/v1/runs/{id}", desc: "单次评测详情" },
      { method: "DELETE", path: "/api/v1/runs/{id}", desc: "删除一次评测记录" },
      { method: "POST", path: "/api/v1/detect", desc: "中转站 / 接口指纹检测" },
      { method: "GET", path: "/api/v1/leaderboard", desc: "按模型聚合的排行榜" },
      { method: "GET", path: "/api/v1/openapi", desc: "OpenAPI 3.1 描述文档" },
    ],
    auth: {
      scheme: "调用方自带上游密钥",
      header: "Authorization: Bearer <你的模型 API Key>",
      note: "本站不保存任何密钥；密钥仅在单次请求内存中使用，不写入响应与日志。",
    },
    categories: ALL_CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABELS[c] })),
  });
}
