import { channel } from "../channel";
import { chatLong, UpstreamTimeout } from "../llm";
import type { ArenaLanguage, ArenaTier, ArenaTrack, ProblemResult, Target, TierResult } from "../types";
import { assemble, type LogicProblem } from "./frontend/logic";
import { frontendProblemsOf, logicTestsOf, type FrontendProblem } from "./frontend/problems";
import type { UiProblem } from "./frontend/ui";
import { judge, JudgeUnavailable, LANGUAGES } from "./judge";
import { PASS_PER_TIER } from "./meta";
import { problemsOf, testsOf, type Problem, type TestCase } from "./problems";

export type ArenaEvent =
  | { type: "start"; tier: ArenaTier; problems: Array<{ id: string; title: string; tags: string[] }> }
  /** 模型交卷，开始判题 */
  | { type: "problem.code"; id: string; code: string }
  /** 前端赛道的 UI 题：页面和隐藏测试交给浏览器判定 */
  | { type: "problem.ui"; id: string; html: string; test: string }
  | { type: "problem.done"; result: ProblemResult }
  | { type: "result"; result: TierResult; stamp?: string };

/** 整体时限：留出余量，避免函数被平台强制终止 */
const BUDGET_MS = 285_000;
/** 留给判题的时间 */
const JUDGE_MS = 60_000;

const SYSTEM = "你正在参加编程测试。只输出一个代码块，里面是完整、可直接运行的程序，不要任何解释。";
const FRONTEND_SYSTEM = "你正在参加前端开发测试。只输出一个代码块，不要任何解释。";

function frontendPromptOf(p: FrontendProblem): string {
  const rules =
    p.kind === "function"
      ? [
          `请用 JavaScript 实现下面的 ${p.name}（运行环境 Node.js 22）。`,
          "",
          "要求：",
          "- 只写实现（以及需要的辅助函数），直接在顶层用 function、const 或 class 定义，不要用 export、module.exports、import、require；",
          "- 不要读写标准输入输出，不要打印调试信息。测试会直接调用你的函数，需要时测试会控制时间（setTimeout、Date.now）；",
          "- 只输出一个代码块。",
        ]
      : [
          "请做一个网页，满足下面的要求。",
          "",
          "要求：",
          "- 输出一个完整的 HTML 文件，CSS 和 JavaScript 都写在里面，放在一个 ```html 代码块里；",
          "- 用原生 JavaScript，不能引用任何外部资源（CDN、字体、图片链接都不行），不能发网络请求，不能用 localStorage、sessionStorage、alert；",
          "- 页面会放进一个隔离的 iframe（1024×768）里，由自动化测试按下面约定的 id、role 和属性操作并检查；",
          "- 测试派发的是合成事件（click、input、change、keydown、pointer 事件等），浏览器不会替你执行默认行为（如按 Tab 移动焦点、按 Enter 点击按钮），需要的行为在事件处理里自己实现；",
          "- 只输出一个代码块。",
        ];
  return [...rules, "", `# ${p.title}`, "", p.statement].join("\n");
}

export function promptOf(p: Problem, language: ArenaLanguage): string {
  const lang = LANGUAGES[language];
  const tests = testsOf(p);
  return [
    `请用 ${lang.label} 解决下面的题目。`,
    "",
    "要求：",
    "- 写一个完整程序：从标准输入读取，向标准输出输出，不要输出提示语等多余内容。",
    `- 运行环境 ${lang.runtime}，只能用标准库，不能联网。每组数据限时 ${lang.limit} 秒（不含启动），会用多组隐藏数据测试。`,
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
  track: ArenaTrack;
  /** 前端赛道固定为 javascript */
  language: ArenaLanguage;
  tier: ArenaTier;
  signal?: AbortSignal;
}

/**
 * 跑一档：三题并发作答、判题，逐题产出事件，最后给出这一档的结果。
 * 前端赛道的 UI 题在服务端只拿到页面（verdict 为 pending），是否通过由浏览器判定后再算。
 */
export async function* runTier(opts: TierOptions): AsyncGenerator<ArenaEvent> {
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const problems: Array<Problem | FrontendProblem> =
    opts.track === "frontend" ? frontendProblemsOf(opts.tier) : problemsOf(opts.tier);
  yield {
    type: "start",
    tier: opts.tier,
    problems: problems.map(({ id, title, tags }) => ({ id, title, tags })),
  };

  const events = channel<ArenaEvent>();
  const results: ProblemResult[] = [];
  Promise.all(
    problems.map(async (p) => {
      const onCode = (code: string) => events.push({ type: "problem.code", id: p.id, code });
      const r =
        "kind" in p
          ? await solveFrontend(p, opts, deadline, onCode, (html) =>
              events.push({ type: "problem.ui", id: p.id, html, test: (p as UiProblem).test }),
            )
          : await solve(p, opts, deadline, onCode);
      results.push(r);
      events.push({ type: "problem.done", result: r });
    }),
  ).then(events.close);
  for await (const e of events) yield e;

  const order = problems.map((p) => results.find((r) => r.id === p.id)!);
  const accepted = order.filter((r) => r.verdict === "accepted").length;
  const errored = order.filter((r) => r.verdict === "error");
  const pending = order.filter((r) => r.verdict === "pending").length;
  const passed = accepted >= PASS_PER_TIER;
  // 已经确定没过（剩下的题全对也不够）时，调用失败不影响结论；UI 题还没判，按可能通过算
  const undecided =
    !passed && accepted + pending < PASS_PER_TIER && accepted + pending + errored.length >= PASS_PER_TIER;
  const result: TierResult = {
    track: opts.track,
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
      // 能给多少给多少（约 225 秒）：难题上思考型模型要想两三分钟
      timeoutMs: Math.max(5_000, deadline - Date.now() - JUDGE_MS),
    });
  } catch (e) {
    // 时限内没交卷算模型没做出来（和比赛一样）；连不上、HTTP 错误才算调用失败，可以重试
    if (e instanceof UpstreamTimeout) {
      return { ...base, verdict: "no_code", detail: `规定时间内没有交卷：${e.message}` };
    }
    return { ...base, verdict: "error", detail: `模型调用失败：${(e as Error).message}` };
  }

  const code = extractCode(res.text);
  const answered = { ...base, kind: "program" as const, code, latencyMs: res.latencyMs, usage: res.usage };
  if (!code) return { ...answered, verdict: "no_code", detail: "回答里没有代码" };
  if (code.length > 60_000) return { ...answered, verdict: "no_code", detail: "代码过长" };
  onCode(code);
  return judged(answered, () => judge(opts.language, code, tests, Math.max(5_000, deadline - Date.now())));
}

async function judged(
  answered: Omit<ProblemResult, "verdict">,
  run: () => ReturnType<typeof judge>,
): Promise<ProblemResult> {
  try {
    return { ...answered, ...(await run()) };
  } catch (e) {
    if (e instanceof JudgeUnavailable) return { ...answered, verdict: "error", detail: e.message };
    throw e;
  }
}

/** 前端赛道：逻辑题拼上隐藏测试交给 Judge0；UI 题只取出页面交给浏览器 */
async function solveFrontend(
  p: FrontendProblem,
  opts: TierOptions,
  deadline: number,
  onCode: (code: string) => void,
  onPage: (html: string) => void,
): Promise<ProblemResult> {
  let tests: TestCase[] = [];
  if (p.kind === "function") {
    try {
      tests = await logicTestsOf(p as LogicProblem);
    } catch (e) {
      return {
        id: p.id,
        title: p.title,
        kind: p.kind,
        verdict: "error",
        detail: (e as Error).message,
        passedTests: 0,
        totalTests: 0,
        code: "",
        latencyMs: 0,
      };
    }
  }
  const base = {
    id: p.id,
    title: p.title,
    kind: p.kind,
    passedTests: 0,
    totalTests: tests.length,
    code: "",
    latencyMs: 0,
  };
  let res;
  try {
    res = await chatLong(opts.target, {
      system: FRONTEND_SYSTEM,
      messages: [{ role: "user", content: frontendPromptOf(p) }],
      temperature: 0,
      maxTokens: opts.target.protocol === "anthropic" ? 16384 : undefined,
      timeoutMs: Math.max(5_000, deadline - Date.now() - JUDGE_MS),
    });
  } catch (e) {
    if (e instanceof UpstreamTimeout)
      return { ...base, verdict: "no_code", detail: `规定时间内没有交卷：${e.message}` };
    return { ...base, verdict: "error", detail: `模型调用失败：${(e as Error).message}` };
  }

  const code = extractCode(res.text);
  const answered = { ...base, code, latencyMs: res.latencyMs, usage: res.usage };
  if (!code) return { ...answered, verdict: "no_code", detail: "回答里没有代码" };
  if (code.length > 150_000) return { ...answered, verdict: "no_code", detail: "代码过长" };
  if (p.kind === "ui") {
    onPage(code);
    return { ...answered, verdict: "pending" };
  }
  onCode(code);
  const logic = p as LogicProblem;
  return judged(answered, () =>
    judge("javascript", assemble(logic, code), tests, Math.max(5_000, deadline - Date.now())),
  );
}
