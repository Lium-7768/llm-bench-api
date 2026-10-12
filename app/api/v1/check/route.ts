import { ALL_STAGES, runCheck, runCheckToEnd } from "@/lib/check";
import { fail, ok, preflight, readJson, readTarget, sse, type TargetBody } from "@/lib/http";
import type { Stage } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function OPTIONS() {
  return preflight();
}

interface CheckBody extends TargetBody {
  stages?: string[];
  limit?: number;
  seed?: number;
  temperature?: number;
  concurrency?: number;
  timeoutMs?: number;
  stream?: boolean;
}

/**
 * POST /api/v1/check —— 全面检测：指纹 → 基础 → 糖果 → 鹈鹕，按顺序执行
 * 默认同步返回完整报告；stream=true 时以 SSE 推送进度事件，最后一个事件为 result。
 */
export async function POST(req: Request) {
  const body = await readJson<CheckBody>(req);
  if (body instanceof Response) return body;
  const target = readTarget(req, body);
  if (target instanceof Response) return target;

  const badStages = (body.stages ?? []).filter((s) => !ALL_STAGES.includes(s as Stage));
  if (badStages.length) {
    return fail(`未知 stages：${badStages.join(", ")}，可选 ${ALL_STAGES.join(" / ")}`, 400, "invalid_stage");
  }

  const opts = {
    target,
    stages: body.stages as Stage[] | undefined,
    limit: body.limit,
    seed: body.seed,
    temperature: body.temperature,
    concurrency: body.concurrency,
    timeoutMs: body.timeoutMs,
    signal: req.signal,
  };

  if (body.stream) return sse(runCheck(opts));
  return ok(await runCheckToEnd(opts));
}
