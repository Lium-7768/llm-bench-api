import { channel } from "../channel";
import { chatLong } from "../llm";
import type { ArenaLanguage, ArenaTier, ProblemResult, Target, TierResult } from "../types";
import { judge, JudgeUnavailable, LANGUAGES, TIME_LIMIT_S } from "./judge";
import { PASS_PER_TIER } from "./meta";
import { problemsOf, testsOf, type Problem } from "./problems";

export type ArenaEvent =
  | { type: "start"; tier: ArenaTier; problems: Array<{ id: string; title: string; tags: string[] }> }
  /** 模型交卷，开始判题 */
  | { type: "problem.code"; id: string; code: string }
  | { type: "problem.done"; result: ProblemResult }
  | { type: "result"; result: TierResult; stamp?: string };

/** 整体时限：留出余量，避免函数被平台强制终止 */
const BUDGET_MS = 285_000;
/** 留给判题的时间 */
const JUDGE_MS = 60_000;

const SYSTEM = "你正在参加编程测试。只输出一个代码块，里面是完整、可直接运行的程序，不要任何解释。";

export function promptOf(p: Problem, language: ArenaLanguage): string {
  const lang = LANGUAGES[language];
  const tests = testsOf(p);
  return [
    `请用 ${lang.label} 解决下面的题目。`,
    "",
    "要求：",
    "- 写一个完整程序：从标准输入读取，向标准输出输出，不要输出提示语等多余内容。",
    `- 运行环境 ${lang.runtime}，只能用标准库，不能联网。每组数据限时 ${TIME_LIMIT_S} 秒，会用多组隐藏数据测试。`,
    ...(lang.note ? [`- ${lang.note}`] : []),
    "- 只输出一个代码块。",
    "",
    `# ${p.title}`,
    "",
    p.statement,
    ...(p.legacy
      ? [
          "",
          "下面是一段线上跑了很多年的祖传代码，用来解这道题，但在部分输入上结果是错的。请找出问题，写出正确的程序（用题目要求的语言）：",
          "",
          "```python",
          p.legacy,
          "```",
        ]
      : []),
    "",
    "样例输入：",
    "```",
    tests[0].input.trimEnd(),
    "```",
    "样例输出：",
    "```",
    tests[0].output,
    "```",
  ].join("\n");
}

/** 从回答里取代码：优先取最长的代码块；没闭合的代码块（被截断）取到结尾；没有代码块就当整段都是代码 */
export function extractCode(text: string): string {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const blocks = [...t.matchAll(/```[^\n`]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length) return blocks.reduce((a, b) => (b.length > a.length ? b : a)).trim();
  const open = t.match(/```[^\n`]*\n([\s\S]*)$/);
  return (open ? open[1] : t).trim();
}

export interface TierOptions {
  target: Target;
  language: ArenaLanguage;
  tier: ArenaTier;
  signal?: AbortSignal;
}

/** 跑一档：三题并发作答、判题，逐题产出事件，最后给出这一档是否通过 */
export async function* runTier(opts: TierOptions): AsyncGenerator<ArenaEvent> {
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const problems = problemsOf(opts.tier);
  yield {
    type: "start",
    tier: opts.tier,
    problems: problems.map(({ id, title, tags }) => ({ id, title, tags })),
  };

  const events = channel<ArenaEvent>();
  const results: ProblemResult[] = [];
  Promise.all(
    problems.map(async (p) => {
      const r = await solve(p, opts, deadline, (code) => events.push({ type: "problem.code", id: p.id, code }));
      results.push(r);
      events.push({ type: "problem.done", result: r });
    }),
  ).then(events.close);
  for await (const e of events) yield e;

  const order = problems.map((p) => results.find((r) => r.id === p.id)!);
  const accepted = order.filter((r) => r.verdict === "accepted").length;
  const errored = order.filter((r) => r.verdict === "error");
  const passed = accepted >= PASS_PER_TIER;
  // 已经确定没过（剩下的题全对也不够）时，调用失败不影响结论
  const undecided = !passed && accepted + errored.length >= PASS_PER_TIER;
  const result: TierResult = {
    tier: opts.tier,
    language: opts.language,
    passed,
    problems: order,
    durationMs: Date.now() - started,
    ...(undecided && { error: errored[0].detail ?? "调用失败" }),
  };
  yield { type: "result", result };
}

async function solve(
  p: Problem,
  opts: TierOptions,
  deadline: number,
  onCode: (code: string) => void,
): Promise<ProblemResult> {
  const tests = testsOf(p);
  const base = { id: p.id, title: p.title, passedTests: 0, totalTests: tests.length, code: "", latencyMs: 0 };
  let res;
  try {
    res = await chatLong(opts.target, {
      system: SYSTEM,
      messages: [{ role: "user", content: promptOf(p, opts.language) }],
      temperature: 0,
      maxTokens: opts.target.protocol === "anthropic" ? 8192 : undefined,
      timeoutMs: Math.max(5_000, Math.min(200_000, deadline - Date.now() - JUDGE_MS)),
    });
  } catch (e) {
    return { ...base, verdict: "error", detail: `模型调用失败：${(e as Error).message}` };
  }

  const code = extractCode(res.text);
  const answered = { ...base, code, latencyMs: res.latencyMs, usage: res.usage };
  if (!code) return { ...answered, verdict: "no_code", detail: "回答里没有代码" };
  if (code.length > 60_000) return { ...answered, verdict: "no_code", detail: "代码过长" };
  onCode(code);

  try {
    const outcome = await judge(opts.language, code, tests, Math.max(5_000, deadline - Date.now()));
    return { ...answered, ...outcome };
  } catch (e) {
    if (e instanceof JudgeUnavailable) return { ...answered, verdict: "error", detail: e.message };
    throw e;
  }
}
