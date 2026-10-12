import { ok, preflight } from "@/lib/http";
import { ALL_CATEGORIES, CATEGORY_LABELS } from "@/lib/bank";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** GET /api/v1/openapi —— 机器可读的接口描述，方便别人直接接入 */
export function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "LLM Bench API",
      version: "1.0.0",
      description:
        "大模型能力评测 API。调用方自带上游模型密钥，本站不保存任何密钥。",
    },
    servers: [{ url: "/api/v1" }],
    tags: [
      { name: "meta" },
      { name: "bank" },
      { name: "runs" },
      { name: "detect" },
    ],
    paths: {
      "/": {
        get: {
          tags: ["meta"],
          summary: "API 索引",
          responses: { "200": { description: "能力列表" } },
        },
      },
      "/health": {
        get: {
          tags: ["meta"],
          summary: "健康检查",
          responses: { "200": { description: "服务状态" } },
        },
      },
      "/categories": {
        get: {
          tags: ["bank"],
          summary: "评测维度列表",
          responses: { "200": { description: "维度数组" } },
        },
      },
      "/questions": {
        get: {
          tags: ["bank"],
          summary: "题库查询",
          parameters: [
            {
              name: "category",
              in: "query",
              schema: { type: "string", enum: ALL_CATEGORIES },
              description: "按维度过滤",
            },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1 } },
            {
              name: "difficulty",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 5 },
            },
            {
              name: "withAnswers",
              in: "query",
              schema: { type: "boolean", default: false },
              description: "是否返回期望答案",
            },
          ],
          responses: { "200": { description: "题目数组" } },
        },
      },
      "/runs": {
        get: {
          tags: ["runs"],
          summary: "评测历史",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          ],
          responses: { "200": { description: "评测摘要数组" } },
        },
        post: {
          tags: ["runs"],
          summary: "提交一次评测",
          description:
            "同步执行题库并返回逐题结果。题目数量有限（默认 21 题），单次请求内完成。",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["model", "baseUrl"],
                  properties: {
                    model: { type: "string", example: "gpt-4o-mini" },
                    baseUrl: {
                      type: "string",
                      example: "https://api.openai.com/v1",
                      description: "OpenAI 兼容的接口地址",
                    },
                    apiKey: {
                      type: "string",
                      description: "也可用 Authorization: Bearer 传入（推荐）",
                    },
                    limit: { type: "integer", maximum: 50 },
                    categories: {
                      type: "array",
                      items: { type: "string", enum: ALL_CATEGORIES },
                    },
                    temperature: { type: "number", default: 0 },
                    seed: {
                      type: "integer",
                      default: 42,
                      description: "同样的 seed 得到同样的题目顺序",
                    },
                    concurrency: { type: "integer", default: 3, maximum: 8 },
                    timeoutMs: { type: "integer", default: 60000 },
                    includeAnswers: { type: "boolean", default: true },
                    judge: {
                      type: "object",
                      description: "裁判模型，用于给主观题打分",
                      properties: {
                        baseUrl: { type: "string" },
                        apiKey: { type: "string" },
                        model: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "评测完成" },
            "400": { description: "参数错误" },
            "401": { description: "缺少密钥" },
            "502": { description: "上游模型全部失败" },
          },
        },
      },
      "/runs/{id}": {
        get: {
          tags: ["runs"],
          summary: "评测详情",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "含逐题明细" },
            "404": { description: "不存在" },
          },
        },
        delete: {
          tags: ["runs"],
          summary: "删除评测记录",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "已删除" } },
        },
      },
      "/detect": {
        post: {
          tags: ["detect"],
          summary: "中转站 / 接口指纹检测",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["model", "baseUrl"],
                  properties: {
                    model: { type: "string" },
                    baseUrl: { type: "string" },
                    apiKey: { type: "string" },
                    timeoutMs: {
                      type: "integer",
                      default: 20000,
                      description: "单项探测的超时时间；四项并发执行",
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "检测结果" } },
        },
      },
      "/leaderboard": {
        get: {
          tags: ["runs"],
          summary: "模型排行榜（基于历史评测聚合）",
          responses: { "200": { description: "排名数组" } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        Category: { type: "string", enum: ALL_CATEGORIES },
        CategoryLabel: {
          type: "object",
          additionalProperties: { type: "string" },
          example: CATEGORY_LABELS,
        },
      },
    },
  };

  return ok(spec);
}
