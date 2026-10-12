import { ALL_CATEGORIES } from "@/lib/bank";
import { ok, preflight } from "@/lib/http";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

const target = {
  type: "object",
  required: ["model"],
  properties: {
    protocol: {
      type: "string",
      enum: ["openai", "anthropic", "gemini"],
      description: "不填则按 baseUrl 推断，默认 openai",
    },
    baseUrl: {
      type: "string",
      description: "被测接口地址，如 https://api.deepseek.com/v1。只给 protocol 时使用官方地址",
    },
    model: { type: "string" },
    apiKey: { type: "string", description: "推荐改用 Authorization 头" },
  },
};

const envelope = (data: object) => ({
  type: "object",
  properties: {
    ok: { type: "boolean" },
    data,
    error: {
      type: ["object", "null"],
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
});

const json = (schema: object) => ({ "application/json": { schema } });

/** GET /api/v1/openapi —— 机器可读的接口描述 */
export function GET() {
  return ok({
    openapi: "3.1.0",
    info: {
      title: "LLM Bench API",
      version: "3.0.0",
      description:
        "大模型能力评测、中转站检测与鹈鹕绘图。服务端无状态：不保存结果，不保存密钥，密钥只在单次请求中转发给上游。",
    },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: {
        upstreamKey: {
          type: "http",
          scheme: "bearer",
          description: "被测接口的 API Key，也可用 X-Api-Key 头",
        },
      },
    },
    security: [{ upstreamKey: [] }],
    paths: {
      "/": { get: { summary: "API 索引与健康检查", security: [], responses: { "200": { description: "能力列表" } } } },
      "/questions": {
        get: {
          summary: "题库",
          security: [],
          parameters: [
            { name: "category", in: "query", schema: { type: "string", enum: ALL_CATEGORIES } },
            { name: "withAnswers", in: "query", schema: { type: "boolean" } },
          ],
          responses: { "200": { description: "题目列表" } },
        },
      },
      "/models": {
        post: {
          summary: "列出被测接口可用的模型",
          requestBody: { content: json({ ...target, required: [] }) },
          responses: {
            "200": {
              description: "模型 ID 列表",
              content: json(
                envelope({ type: "object", properties: { models: { type: "array", items: { type: "string" } } } }),
              ),
            },
          },
        },
      },
      "/check": {
        post: {
          summary: "全面检测",
          description:
            "按顺序执行五步：detect 指纹检测 → basic 基础测试 → candy 糖果测试 → colorblind 综合推理 → pelican 鹈鹕测试，返回 Report。" +
            "综合分 = 指纹 30% + 基础 40% + 糖果 30%（只算有结果的部分），综合推理与鹈鹕不计入综合分。" +
            "stream=true 时返回 text/event-stream：start → 每一步依次 stage.start、若干 answer 或 check、stage.done（或 stage.error）→ result。",
          requestBody: {
            content: json({
              ...target,
              properties: {
                ...target.properties,
                stages: {
                  type: "array",
                  items: { type: "string", enum: ["detect", "basic", "candy", "colorblind", "pelican"] },
                  description: "要跑的步骤，默认全部，总是按固定顺序执行",
                },
                limit: { type: "integer", description: "基础测试题目数上限，默认全部" },
                seed: { type: "integer", default: 42, description: "同一 seed 抽到同一套题、同一顺序" },
                temperature: { type: "number", default: 0 },
                concurrency: { type: "integer", default: 3, minimum: 1, maximum: 8 },
                timeoutMs: { type: "integer", default: 60000, description: "单题超时" },
                stream: { type: "boolean", default: false },
              },
            }),
          },
          responses: { "200": { description: "Report，或 SSE 事件流" } },
        },
      },
    },
  });
}
