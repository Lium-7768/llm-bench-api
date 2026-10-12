import { selectQuestions, CATEGORY_LABELS } from "./bank";
import { aggregate, totalScore, judge, ENGINE_VERSION } from "./scoring";
import {
  chat,
  judgeWithModel,
  maskBaseUrl,
  type CallOptions,
} from "./provider";
import { newId, saveRun } from "./store";
import type { AnswerResult, Category, Run, RunConfig } from "./types";
import { BANK_VERSION } from "./bank";

export interface ExecuteInput {
  config: RunConfig;
  apiKey: string;
  /** 裁判模型（用于 rubric 主观题），不传则主观题按 0 分处理并注明 */
  judge?: { baseUrl: string; apiKey: string; model: string };
  /** 每题超时 */
  timeoutMs?: number;
  /** 并发度 */
  concurrency?: number;
  /** 是否把中间状态写入 store（异步模式需要） */
  onProgress?: (run: Run) => void;
}

const SYSTEM_PROMPT =
  "你正在参加一个能力评测。请严格按题目要求作答，只输出答案，不要输出多余的解释或客套话。";

/** 执行一次完整评测 */
export async function executeRun(input: ExecuteInput): Promise<Run> {
  const { config, apiKey, judge: judgeCfg, timeoutMs = 60_000 } = input;
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 3, 8));

  const questions = selectQuestions({
    limit: config.limit,
    categories: config.categories,
    seed: config.seed,
  });

  const run: Run = {
    id: newId("run"),
    status: "running",
    createdAt: new Date().toISOString(),
    config,
    questionIds: questions.map((q) => q.id),
    answers: [],
    meta: {
      engineVersion: ENGINE_VERSION,
      bankVersion: BANK_VERSION,
      baseUrlMasked: maskBaseUrl(config.baseUrl),
    },
  };
  saveRun(run);
  input.onProgress?.(run);

  const baseOpts: CallOptions = {
    baseUrl: config.baseUrl,
    apiKey,
    model: config.model,
    temperature: config.temperature ?? 0,
    timeoutMs,
  };

  const judgeOpts: CallOptions | undefined = judgeCfg
    ? {
        baseUrl: judgeCfg.baseUrl,
        apiKey: judgeCfg.apiKey,
        model: judgeCfg.model,
        temperature: 0,
        timeoutMs,
      }
    : undefined;

  const startedAll = Date.now();
  const answers: AnswerResult[] = [];
  let cursor = 0;

  // 简单并发池
  const worker = async () => {
    while (cursor < questions.length) {
      const idx = cursor++;
      const q = questions[idx];
      const t0 = Date.now();
      try {
        const res = await chat(
          [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: q.prompt },
          ],
          baseOpts,
        );

        let rubricScore: number | undefined;
        let judgeError: string | undefined;
        if (q.match === "rubric") {
          if (judgeOpts) {
            try {
              const outcome = await judgeWithModel(q, res.content, judgeOpts);
              rubricScore = outcome.score;
              judgeError = outcome.parseError;
            } catch (e) {
              judgeError = `裁判模型调用失败: ${(e as Error).message}`;
            }
          } else {
            judgeError = "未配置裁判模型（judge 参数），该主观题无法自动评分";
          }
        }

        const j = judge({ question: q, output: res.content, rubricScore });
        answers.push({
          questionId: q.id,
          category: q.category,
          prompt: q.prompt,
          output: res.content,
          passed: j.passed,
          score: j.score,
          weight: q.weight,
          error: j.reason ?? judgeError,
          latencyMs: res.latencyMs || Date.now() - t0,
          promptTokens: res.promptTokens,
          completionTokens: res.completionTokens,
        });
      } catch (e) {
        answers.push({
          questionId: q.id,
          category: q.category,
          prompt: q.prompt,
          output: "",
          passed: false,
          score: 0,
          weight: q.weight,
          error: `调用失败: ${(e as Error).message}`,
          latencyMs: Date.now() - t0,
        });
      }

      run.answers = [...answers].sort(
        (a, b) =>
          questions.findIndex((q) => q.id === a.questionId) -
          questions.findIndex((q) => q.id === b.questionId),
      );
      if (answers.length % 3 === 0) input.onProgress?.(run);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, questions.length || 1) }, worker),
  );

  // 按题目顺序排列结果
  const order = new Map(questions.map((q, i) => [q.id, i]));
  answers.sort(
    (a, b) => (order.get(a.questionId) ?? 0) - (order.get(b.questionId) ?? 0),
  );

  run.answers = answers;
  run.categories = aggregate(answers);
  run.score = totalScore(answers);
  run.status = "succeeded";
  run.finishedAt = new Date().toISOString();
  run.meta.totalLatencyMs = Date.now() - startedAll;

  // 若全部调用都失败，标记为 failed 更诚实
  if (answers.length > 0 && answers.every((a) => a.output === "")) {
    run.status = "failed";
    run.error = "所有题目调用均失败，请检查 baseUrl / apiKey / model 是否正确。";
  }
  if (answers.length === 0) {
    run.status = "failed";
    run.error = "没有选出任何题目，请检查 categories / limit 参数。";
  }

  saveRun(run);
  return run;
}

export function summarizeRun(run: Run) {
  return {
    id: run.id,
    status: run.status,
    score: run.score ?? null,
    configuredModel: run.config.model,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    baseUrl: run.meta.baseUrlMasked,
    totalLatencyMs: run.meta.totalLatencyMs ?? null,
    categories:
      run.categories?.map((c) => ({
        category: c.category,
        label: CATEGORY_LABELS[c.category as Category],
        percent: c.percent,
        passed: c.passed,
        total: c.total,
      })) ?? [],
  };
}
