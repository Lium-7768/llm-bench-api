import {
  BASIC_CATEGORIES as BASIC,
  CANDY_CATEGORIES as CANDY,
  INFERENCE_CATEGORIES as INFERENCE,
  selectQuestions,
} from "./bank";
import { runBench } from "./bench";
import { channel } from "./channel";
import { DETECT_CHECKS, runDetect } from "./detect";
import { hostOf } from "./llm";
import { PELICAN_PROMPT, runPelican } from "./pelican";
import type { AnswerResult, BenchResult, CheckResult, Report, Stage, Target } from "./types";

/** 执行顺序 */
export const ALL_STAGES: Stage[] = ["detect", "basic", "candy", "inference", "pelican"];

/** 综合分权重；鹈鹕没有标准答案、综合推理单独展示，都不计分 */
const WEIGHTS: Partial<Record<Stage, number>> = { detect: 0.3, basic: 0.4, candy: 0.3 };

/** 整体时限：留出余量，避免函数被平台强制终止（Vercel 上限 300 秒） */
const BUDGET_MS = 285_000;

export interface CheckOptions {
  target: Target;
  stages?: Stage[];
  /** 基础测试的题量上限，默认全部 */
  limit?: number;
  seed?: number;
  temperature?: number;
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface StagePlan {
  id: Stage;
  /** 该步骤的项目数：题目数、探测项数，绘图为 1 */
  total: number;
  items: Array<{ id: string; label: string }>;
}

export type CheckEvent =
  | { type: "start"; stages: StagePlan[]; pelicanPrompt: string }
  | { type: "stage.start"; stage: Stage }
  | { type: "answer"; stage: "basic" | "candy" | "inference"; done: number; total: number; answer: AnswerResult }
  | { type: "check"; stage: "detect"; check: CheckResult }
  | { type: "stage.done"; stage: Stage; score: number | null }
  | { type: "stage.error"; stage: Stage; message: string }
  | { type: "result"; result: Report };

/**
 * 全面检测：指纹 → 基础 → 糖果 → 综合推理 → 鹈鹕，按顺序执行，
 * 每一步内部仍然并发。逐步产出事件，最后产出合并报告。
 */
export async function* runCheck(opts: CheckOptions): AsyncGenerator<CheckEvent> {
  const stages = opts.stages?.length ? ALL_STAGES.filter((s) => opts.stages!.includes(s)) : ALL_STAGES;
  const seed = opts.seed ?? 42;
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const report: Report = {
    id: crypto.randomUUID(),
    model: opts.target.model,
    protocol: opts.target.protocol,
    host: hostOf(opts.target.baseUrl),
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    stages,
    score: null,
    errors: {},
  };

  const basicQuestions = selectQuestions({ categories: BASIC, limit: opts.limit, seed });
  const candyQuestions = selectQuestions({ categories: CANDY, seed });
  const inferenceQuestions = selectQuestions({ categories: INFERENCE, seed });
  const asItems = (qs: typeof basicQuestions) => qs.map((q) => ({ id: q.id, label: q.prompt }));
  const plans: Record<Stage, StagePlan> = {
    detect: {
      id: "detect",
      total: DETECT_CHECKS.length,
      items: DETECT_CHECKS.map((c) => ({ id: c.id, label: c.name })),
    },
    basic: { id: "basic", total: basicQuestions.length, items: asItems(basicQuestions) },
    candy: { id: "candy", total: candyQuestions.length, items: asItems(candyQuestions) },
    inference: { id: "inference", total: inferenceQuestions.length, items: asItems(inferenceQuestions) },
    pelican: { id: "pelican", total: 1, items: [{ id: "pelican", label: PELICAN_PROMPT }] },
  };

  yield { type: "start", stages: stages.map((s) => plans[s]), pelicanPrompt: PELICAN_PROMPT };

  for (const stage of stages) {
    const remaining = deadline - Date.now();
    if (opts.signal?.aborted || remaining < 5_000) {
      const message = opts.signal?.aborted ? "调用方已断开" : "超出整体时限，已跳过";
      report.errors[stage] = message;
      yield { type: "stage.error", stage, message };
      continue;
    }

    yield { type: "stage.start", stage };
    try {
      if (stage === "detect") {
        // 探测是并发的，用队列把逐项结果转成事件
        const events = channel<CheckResult>();
        const task = runDetect(opts.target, Math.min(30_000, remaining), (c) => events.push(c)).finally(events.close);
        for await (const check of events) yield { type: "check", stage, check };
        report.detect = await task;
        yield { type: "stage.done", stage, score: report.detect.score };
      } else if (stage === "basic" || stage === "candy" || stage === "inference") {
        let result: BenchResult | undefined;
        const categories = stage === "basic" ? BASIC : stage === "candy" ? CANDY : INFERENCE;
        for await (const e of runBench({
          ...opts,
          seed,
          categories,
          // 只有基础测试受 limit 限制；糖果和综合推理总是全做
          limit: stage === "basic" ? opts.limit : undefined,
          // 综合推理要写一段推理，思考型模型实测要两分多钟：放宽单题时限并走流式
          ...(stage === "inference" && { stream: true, timeoutMs: Math.max(opts.timeoutMs ?? 0, 150_000) }),
          budgetMs: remaining,
        })) {
          if (e.type === "answer") yield { type: "answer", stage, done: e.done, total: e.total, answer: e.answer };
          if (e.type === "result") result = e.result;
        }
        report[stage] = result;
        yield { type: "stage.done", stage, score: result?.score ?? null };
      } else {
        report.pelican = await runPelican(opts.target, { timeoutMs: Math.min(170_000, remaining - 2_000) });
        yield { type: "stage.done", stage, score: null };
      }
    } catch (e) {
      report.errors[stage] = (e as Error).message;
      yield { type: "stage.error", stage, message: (e as Error).message };
    }
  }

  report.durationMs = Date.now() - started;
  report.score = compositeScore(report);
  yield { type: "result", result: report };
}

/** 运行到结束，只返回最终报告（同步接口用） */
export async function runCheckToEnd(opts: CheckOptions): Promise<Report> {
  for await (const e of runCheck(opts)) {
    if (e.type === "result") return e.result;
  }
  throw new Error("检测没有产出结果");
}

function compositeScore(r: Report): number | null {
  const parts = (["detect", "basic", "candy"] as const)
    .map((s) => [r[s]?.score, WEIGHTS[s]!] as const)
    .filter((p): p is readonly [number, number] => typeof p[0] === "number");
  if (!parts.length) return null;
  const weight = parts.reduce((sum, [, w]) => sum + w, 0);
  return Math.round((parts.reduce((sum, [v, w]) => sum + v * w, 0) / weight) * 10) / 10;
}
