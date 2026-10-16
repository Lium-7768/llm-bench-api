import { channel } from "../channel";
import { chatLong, UpstreamError, UpstreamTimeout } from "../llm";
import type { ArenaCatalogItem, ArenaLanguage, ArenaTier, ArenaTrack, ProblemResult, Target, TestMark } from "../types";
import { assemble, type LogicProblem } from "./frontend/logic";
import { frontendProblemsOf, logicTestsOf, type FrontendProblem } from "./frontend/problems";
import type { UiProblem } from "./frontend/ui";
import { judge, JudgeUnavailable, LANGUAGES } from "./judge";
import { TIERS } from "./meta";
import { problemsOf, testsOf, type Problem, type TestCase } from "./problems";

export type ArenaEvent =
  | { type: "start"; problems: Array<{ id: string; tier: ArenaTier; title: string; tags: string[] }> }
  /** 模型正在写：回答的增量文本（攒一小段再发） */
  | { type: "problem.text"; id: string; text: string }
  /** 模型交卷，开始判题；total 是隐藏测试组数，limit 是每组的运行时限（秒） */
  | { type: "problem.code"; id: string; code: string; total: number; limit: number }
  /** 判题进度：各组测试的当前结果 */
  | { type: "problem.tests"; id: string; tests: TestMark[] }
  /** 前端赛道的 UI 题：页面和隐藏测试交给浏览器判定 */
  | { type: "problem.ui"; id: string; html: string; test: string }
  | { type: "problem.done"; result: ProblemResult }
  | { type: "result"; problems: ProblemResult[] };

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

export interface RunOptions {
  target: Target;
  track: ArenaTrack;
  /** 前端赛道固定为 javascript */
  language: ArenaLanguage;
  /** 要跑的题目 id，同一赛道，最多 MAX_PER_RUN 道 */
  ids: string[];
  signal?: AbortSignal;
}

/** 一次请求最多跑几道题：并发作答，共用一次函数时限 */
export const MAX_PER_RUN = 3;

type AnyProblem = Problem | FrontendProblem;

const problemsOfTrack = (track: ArenaTrack): AnyProblem[] =>
  TIERS.flatMap((t): AnyProblem[] => (track === "frontend" ? frontendProblemsOf(t) : problemsOf(t)));

/** 题目目录：只有标题和标签，不含题面和测试。每档第一道是默认选中的题 */
export function catalogOf(track: ArenaTrack): ArenaCatalogItem[] {
  return problemsOfTrack(track).map((p) => ({
    id: p.id,
    tier: p.tier,
    title: p.title,
    tags: p.tags,
    kind: "kind" in p ? p.kind : "program",
  }));
}

/** 跑指定的几道题：并发作答、判题，逐题产出事件，最后汇总 */
export async function* runProblems(opts: RunOptions): AsyncGenerator<ArenaEvent> {
  const deadline = Date.now() + BUDGET_MS;
  const all = problemsOfTrack(opts.track);
  const problems = opts.ids.map((id) => all.find((p) => p.id === id)).filter((p): p is AnyProblem => !!p);
  yield {
    type: "start",
    problems: problems.map(({ id, tier, title, tags }) => ({ id, tier, title, tags })),
  };

  const events = channel<ArenaEvent>();
  const results: ProblemResult[] = [];
  Promise.all(
    problems.map(async (p) => {
      // 增量文本攒 150ms 发一次，避免一个字一个事件
      let pending = "";
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (pending) events.push({ type: "problem.text", id: p.id, text: pending });
        pending = "";
      };
      const hooks: Hooks = {
        text: (t) => {
          pending += t;
          timer ??= setTimeout(flush, 150);
        },
        code: (code, total, limit) => {
          flush();
          events.push({ type: "problem.code", id: p.id, code, total, limit });
        },
        tests: (tests) => events.push({ type: "problem.tests", id: p.id, tests }),
        page: (html) => {
          flush();
          events.push({ type: "problem.ui", id: p.id, html, test: (p as UiProblem).test });
        },
      };
      const r = "kind" in p ? await solveFrontend(p, opts, deadline, hooks) : await solve(p, opts, deadline, hooks);
      flush();
      results.push({ ...r, tier: p.tier });
      events.push({ type: "problem.done", result: { ...r, tier: p.tier } });
    }),
  ).then(events.close);
  for await (const e of events) yield e;

  yield { type: "result", problems: problems.map((p) => results.find((r) => r.id === p.id)!) };
}

interface Hooks {
  text: (delta: string) => void;
  code: (code: string, total: number, limit: number) => void;
  tests: (tests: TestMark[]) => void;
  page: (html: string) => void;
}

/** 调用失败分两种：上游给了 HTTP 错误是接口报错，连不上、断开算网络错误 */
const callError = (e: unknown) => ({
  verdict: "error" as const,
  errorKind: e instanceof UpstreamError && e.status > 0 ? ("model" as const) : ("network" as const),
  detail: `模型调用失败：${(e as Error).message}`,
});

async function solve(p: Problem, opts: RunOptions, deadline: number, hooks: Hooks): Promise<ProblemResult> {
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
      onText: hooks.text,
    });
  } catch (e) {
    // 时限内没交卷算模型没做出来（和比赛一样）；连不上、HTTP 错误才算调用失败，可以重试
    if (e instanceof UpstreamTimeout) {
      return { ...base, verdict: "no_code", detail: `规定时间内没有交卷：${e.message}` };
    }
    return { ...base, ...callError(e) };
  }

  const code = extractCode(res.text);
  const answered = { ...base, kind: "program" as const, code, latencyMs: res.latencyMs, usage: res.usage };
  if (!code) return { ...answered, verdict: "no_code", detail: "回答里没有代码" };
  if (code.length > 60_000) return { ...answered, verdict: "no_code", detail: "代码过长" };
  hooks.code(code, tests.length, LANGUAGES[opts.language].limit);
  return judged(answered, () => judge(opts.language, code, tests, Math.max(5_000, deadline - Date.now()), hooks.tests));
}

async function judged(
  answered: Omit<ProblemResult, "verdict">,
  run: () => ReturnType<typeof judge>,
): Promise<ProblemResult> {
  try {
    return { ...answered, ...(await run()) };
  } catch (e) {
    if (e instanceof JudgeUnavailable) return { ...answered, verdict: "error", errorKind: "judge", detail: e.message };
    throw e;
  }
}

/** 前端赛道：逻辑题拼上隐藏测试交给 Judge0；UI 题只取出页面交给浏览器 */
async function solveFrontend(
  p: FrontendProblem,
  opts: RunOptions,
  deadline: number,
  hooks: Hooks,
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
        errorKind: "judge",
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
      onText: hooks.text,
    });
  } catch (e) {
    if (e instanceof UpstreamTimeout)
      return { ...base, verdict: "no_code", detail: `规定时间内没有交卷：${e.message}` };
    return { ...base, ...callError(e) };
  }

  const code = extractCode(res.text);
  const answered = { ...base, code, latencyMs: res.latencyMs, usage: res.usage };
  if (!code) return { ...answered, verdict: "no_code", detail: "回答里没有代码" };
  if (code.length > 150_000) return { ...answered, verdict: "no_code", detail: "代码过长" };
  if (p.kind === "ui") {
    hooks.page(code);
    return { ...answered, verdict: "pending" };
  }
  hooks.code(code, tests.length, LANGUAGES.javascript.limit);
  const logic = p as LogicProblem;
  return judged(answered, () =>
    judge("javascript", assemble(logic, code), tests, Math.max(5_000, deadline - Date.now()), hooks.tests),
  );
}
