import { BANK_VERSION, selectQuestions } from "./bank";
import { channel } from "./channel";
import { chat, hostOf } from "./llm";
import { aggregate, judge, totalScore } from "./scoring";
import type { AnswerResult, BenchResult, Category, Question, Target } from "./types";

export interface BenchOptions {
  target: Target;
  categories?: Category[];
  limit?: number;
  seed?: number;
  temperature?: number;
  /** 并发数，1-8 */
  concurrency?: number;
  /** 单题超时 */
  timeoutMs?: number;
  /** 整体时限：超出后剩余题目不再执行，避免被平台强制终止 */
  budgetMs?: number;
  /** 调用方断开时停止 */
  signal?: AbortSignal;
}

export type BenchEvent =
  | {
      type: "start";
      total: number;
      questions: Array<Pick<Question, "id" | "category" | "prompt">>;
    }
  | { type: "answer"; done: number; total: number; answer: AnswerResult }
  | { type: "result"; result: BenchResult };

const SYSTEM_PROMPT =
  "你正在参加一个能力评测。请严格按题目要求作答，只输出答案，不要输出多余的解释或客套话。";

/** 执行一次评测，逐题产出事件，最后产出完整结果 */
export async function* runBench(opts: BenchOptions): AsyncGenerator<BenchEvent> {
  const seed = opts.seed ?? 42;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, 8));
  const startedAt = new Date();
  const deadline = startedAt.getTime() + (opts.budgetMs ?? 270_000);

  const questions = selectQuestions({
    limit: opts.limit,
    categories: opts.categories,
    seed,
  });

  yield {
    type: "start",
    total: questions.length,
    questions: questions.map(({ id, category, prompt }) => ({ id, category, prompt })),
  };

  const finished: AnswerResult[] = [];
  const queue = channel<AnswerResult>();
  let cursor = 0;

  const worker = async () => {
    while (cursor < questions.length) {
      const q = questions[cursor++];
      const remaining = deadline - Date.now();
      const a =
        opts.signal?.aborted || remaining < 3_000
          ? skipped(q, opts.signal?.aborted ? "调用方已断开" : "超出整体时限，未执行")
          : await answer(q, opts, Math.min(timeoutMs, remaining));
      finished.push(a);
      queue.push(a);
    }
  };

  Promise.all(Array.from({ length: Math.min(concurrency, questions.length) }, worker)).then(queue.close);

  let done = 0;
  for await (const a of queue) {
    yield { type: "answer", done: ++done, total: questions.length, answer: a };
  }

  const order = new Map(questions.map((q, i) => [q.id, i]));
  const answers = finished.sort((a, b) => order.get(a.questionId)! - order.get(b.questionId)!);
  const failedCalls = answers.filter((a) => a.errored).length;
  const score = totalScore(answers);

  yield {
    type: "result",
    result: {
      id: crypto.randomUUID(),
      model: opts.target.model,
      protocol: opts.target.protocol,
      host: hostOf(opts.target.baseUrl),
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      score,
      failedCalls,
      categories: aggregate(answers),
      answers,
      bankVersion: BANK_VERSION,
      seed,
      error:
        questions.length === 0
          ? "没有选出任何题目，请检查 categories / limit 参数"
          : score === null
            ? `全部 ${failedCalls} 题调用失败，请检查接口地址、密钥和模型名。首个错误：${answers[0]?.reason ?? ""}`
            : undefined,
    },
  };
}

/** 运行到结束，只返回最终结果（同步接口用） */
export async function runBenchToEnd(opts: BenchOptions): Promise<BenchResult> {
  for await (const event of runBench(opts)) {
    if (event.type === "result") return event.result;
  }
  throw new Error("评测没有产出结果");
}

async function answer(q: Question, opts: BenchOptions, timeoutMs: number): Promise<AnswerResult> {
  const started = Date.now();
  try {
    const res = await chat(opts.target, {
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: q.prompt }],
      temperature: opts.temperature ?? 0,
      timeoutMs,
    });
    const verdict = judge(q, res.text);
    return {
      questionId: q.id,
      category: q.category,
      prompt: q.prompt,
      output: res.text,
      passed: verdict.passed,
      score: verdict.score,
      weight: q.weight,
      reason: verdict.reason,
      latencyMs: res.latencyMs,
      usage: res.usage,
    };
  } catch (e) {
    return {
      ...skipped(q, (e as Error).message),
      latencyMs: Date.now() - started,
    };
  }
}

function skipped(q: Question, reason: string): AnswerResult {
  return {
    questionId: q.id,
    category: q.category,
    prompt: q.prompt,
    output: "",
    passed: false,
    score: 0,
    weight: q.weight,
    reason,
    errored: true,
    latencyMs: 0,
  };
}
