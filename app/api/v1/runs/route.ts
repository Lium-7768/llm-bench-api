import { executeRun, summarizeRun } from "@/lib/runner";
import {
  extractApiKey,
  fail,
  isSafeBaseUrl,
  ok,
  preflight,
} from "@/lib/http";
import { ALL_CATEGORIES } from "@/lib/bank";
import { listRuns } from "@/lib/store";
import type { Category, RunConfig } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function OPTIONS() {
  return preflight();
}

/** GET /api/v1/runs?limit=20 —— 评测历史（不含完整答案，减小体积） */
export function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20") || 20, 100);
  const runs = listRuns(limit).map(summarizeRun);
  return ok({ total: runs.length, runs });
}

interface RunBody {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  limit?: number;
  categories?: string[];
  temperature?: number;
  seed?: number;
  concurrency?: number;
  timeoutMs?: number;
  judge?: { baseUrl?: string; apiKey?: string; model?: string };
  /** includeAnswers=false 可只取分数 */
  includeAnswers?: boolean;
}

/**
 * POST /api/v1/runs
 * 同步执行一次评测并把结果返回。题目不多（默认 21 题），单次请求内可完成。
 */
export async function POST(req: Request) {
  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    return fail("请求体必须是合法 JSON", 400, "invalid_json");
  }

  const model = body.model?.trim();
  const baseUrl = body.baseUrl?.trim();
  const apiKey = extractApiKey(req, body.apiKey);

  if (!model) return fail("缺少 model 参数", 400, "missing_model");
  if (!baseUrl) return fail("缺少 baseUrl 参数", 400, "missing_base_url");
  if (!apiKey) {
    return fail(
      "缺少 API Key，请通过 Authorization: Bearer <key> 或 body.apiKey 传入",
      401,
      "missing_api_key",
    );
  }
  if (!isSafeBaseUrl(baseUrl)) {
    return fail(
      "baseUrl 不合法或指向内网地址（出于安全考虑已禁止）",
      400,
      "unsafe_base_url",
    );
  }

  const categories = body.categories?.filter((c): c is Category =>
    ALL_CATEGORIES.includes(c as Category),
  );

  if (body.categories?.length && !categories?.length) {
    return fail("categories 中没有合法维度", 400, "invalid_category", {
      allowed: ALL_CATEGORIES,
    });
  }

  const config: RunConfig = {
    model,
    baseUrl,
    limit: body.limit && body.limit > 0 ? Math.min(body.limit, 50) : undefined,
    categories: categories?.length ? categories : undefined,
    temperature: typeof body.temperature === "number" ? body.temperature : 0,
    seed: typeof body.seed === "number" ? body.seed : 42,
  };

  let judge: { baseUrl: string; apiKey: string; model: string } | undefined;
  if (body.judge?.model && body.judge.baseUrl) {
    const jKey = body.judge.apiKey ?? apiKey;
    if (isSafeBaseUrl(body.judge.baseUrl)) {
      judge = { baseUrl: body.judge.baseUrl, apiKey: jKey, model: body.judge.model };
    }
  }

  try {
    const run = await executeRun({
      config,
      apiKey,
      judge,
      concurrency: body.concurrency ?? 3,
      timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : 60_000,
    });

    const includeAnswers = body.includeAnswers !== false;

    return ok(
      {
        ...summarizeRun(run),
        error: run.error ?? null,
        meta: run.meta,
        answers: includeAnswers ? run.answers : undefined,
      },
      { status: run.status === "failed" ? 502 : 200 },
    );
  } catch (e) {
    return fail(`评测执行失败: ${(e as Error).message}`, 500, "run_failed");
  }
}
