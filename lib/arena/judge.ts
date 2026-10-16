import type { ArenaLanguage, ProblemVerdict, TestMark } from "../types";
import type { TestCase } from "./problems";

/**
 * 代码执行交给外部的开源判题服务 Judge0（https://github.com/judge0/judge0），本项目不运行任何模型写的代码。
 * 默认用官方公共实例 ce.judge0.com：不需要密钥，沙箱不能联网，一次最多批量提交 20 组。
 * 自建 Judge0 时设置 JUDGE0_URL，开启了鉴权再设置 JUDGE0_AUTH_TOKEN。
 */

const BASE = () => (process.env.JUDGE0_URL?.trim() || "https://ce.judge0.com").replace(/\/+$/, "");

interface Runtime {
  label: string;
  runtime: string;
  /** Judge0 的语言 ID */
  judge0: number;
  note: string;
  /** 空程序，用来测这个运行环境的启动耗时 */
  empty: string;
  /** 每组测试的运行时限（不含运行环境启动），秒。超时由我们按 Judge0 返回的用时判 */
  limit: number;
  /** 交给 Judge0 的 CPU 时限，秒：启动耗时 + 运行时限 + 余量，Go、Java 的编译也算在里面 */
  cpu: number;
}

/**
 * 公共实例上新版 Python、Node 的沙箱启动就要 2.3–2.8 秒（实测），旧版很快但语法太老（Python 3.8 不支持 list[int]，
 * Node 12 不支持 ?.）。所以选新版，每批额外提交一个空程序测启动耗时，判超时用「用时 − 启动耗时」。
 * Go 1.23 在公共实例繁忙时经常编译超时，用 1.18。
 * 运行时限按语言放宽（常见的做法）：同样的算法，CPython 比 Java、Go 慢一个数量级。
 */
export const LANGUAGES: Record<ArenaLanguage, Runtime> = {
  python: { label: "Python", runtime: "Python 3.13", judge0: 109, note: "", empty: "pass", limit: 6, cpu: 10 },
  javascript: {
    label: "JavaScript",
    runtime: "Node.js 22（CommonJS）",
    judge0: 102,
    note: "用 require('fs').readFileSync(0, 'utf8') 读取全部输入。",
    // 空字符串会被 Judge0 当作没传代码拒绝
    empty: ";",
    limit: 3,
    cpu: 7,
  },
  java: {
    label: "Java",
    runtime: "Java 17",
    judge0: 91,
    note: "主类必须是 public class Main，不要写 package。",
    empty: "public class Main { public static void main(String[] a) {} }",
    limit: 2,
    cpu: 4,
  },
  go: {
    label: "Go",
    runtime: "Go 1.18",
    judge0: 95,
    note: "使用 package main。",
    empty: "package main\nfunc main() {}",
    limit: 2,
    cpu: 4,
  },
};

export class JudgeUnavailable extends Error {}

export interface JudgeOutcome {
  verdict: Exclude<ProblemVerdict, "no_code" | "error">;
  passedTests: number;
  failedTest?: number;
  detail?: string;
  /** 跑完的测试里最慢的一组用时（已扣除启动耗时） */
  slowestMs?: number;
  tests: TestMark[];
}

interface Submission {
  status_id: number;
  time: string | null;
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
}

const enc = (s: string) => Buffer.from(s).toString("base64");
const dec = (s: string | null) => (s ? Buffer.from(s, "base64").toString() : "");
/** 忽略行尾空白、\r 和结尾的空行 */
const norm = (s: string) =>
  s
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trimEnd();
const clip = (s: string, n = 1500) => (s.length > n ? s.slice(0, n) + "\n…" : s);

/** 公共实例偶尔断连或返回 5xx / 429：退避重试三次。重复提交只是多跑一遍，没有副作用 */
async function call(path: string, init: RequestInit, signal: AbortSignal, attempt = 0): Promise<unknown> {
  const token = process.env.JUDGE0_AUTH_TOKEN?.trim();
  const retry = async (reason: string) => {
    if (attempt >= 3 || signal.aborted) throw new JudgeUnavailable(signal.aborted ? "判题超时" : reason);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return call(path, init, signal, attempt + 1);
  };
  let res: Response;
  try {
    res = await fetch(BASE() + path, {
      ...init,
      signal,
      headers: { "Content-Type": "application/json", ...(token && { "X-Auth-Token": token }) },
    });
  } catch (e) {
    const cause = (e as Error & { cause?: { code?: string } }).cause?.code;
    return retry(`连不上判题服务：${(e as Error).message}${cause ? `（${cause}）` : ""}`);
  }
  if (res.status >= 500 || res.status === 429) return retry(`判题服务返回 ${res.status}`);
  if (!res.ok) throw new JudgeUnavailable(`判题服务返回 ${res.status}`);
  return res.json();
}

/** 把代码和全部测试一次提交，轮询到全部出结果，按第一组没通过的测试给出结论 */
export async function judge(
  language: ArenaLanguage,
  code: string,
  tests: TestCase[],
  timeoutMs: number,
  /** 每次轮询后回调各组测试的进度，网页用它逐格显示结果 */
  onProgress?: (tests: TestMark[]) => void,
): Promise<JudgeOutcome> {
  const signal = AbortSignal.timeout(timeoutMs);
  const lang = LANGUAGES[language];
  const created = (await call(
    "/submissions/batch?base64_encoded=true",
    {
      method: "POST",
      body: JSON.stringify({
        // 最后一个是空程序，测启动耗时
        submissions: [...tests.map((t) => ({ code, stdin: t.input })), { code: lang.empty, stdin: "" }].map((s) => ({
          language_id: lang.judge0,
          source_code: enc(s.code),
          stdin: enc(s.stdin),
          cpu_time_limit: lang.cpu,
          wall_time_limit: lang.cpu * 2,
        })),
      }),
    },
    signal,
  )) as Array<{ token?: string } & Record<string, unknown>>;
  const tokens = created.map((c) => c.token);
  const rejected = created.find((c) => !c.token);
  if (rejected) throw new JudgeUnavailable(`判题服务拒绝了提交：${clip(JSON.stringify(rejected), 200)}`);

  let results: Submission[];
  let empty: Submission;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const got = (await call(
      `/submissions/batch?base64_encoded=true&fields=status_id,time,stdout,stderr,compile_output,message&tokens=${tokens.join(",")}`,
      {},
      signal,
    )) as { submissions: Submission[] };
    results = got.submissions.slice(0, -1);
    empty = got.submissions.at(-1)!;
    // 1 排队中，2 运行中
    const finished = got.submissions.every((s) => s.status_id > 2);
    if (finished) break;
    // 判超时要扣启动耗时，空程序跑完之前先都当作还在运行
    if (onProgress) {
      const startup = empty.status_id > 2 ? startupOf(empty) : null;
      onProgress(
        results.map((s, i) => {
          if (startup === null || s.status_id <= 2) return { verdict: "running" };
          try {
            return markOf(s, classify(s, tests[i], startup, lang.limit), startup);
          } catch {
            return { verdict: "running" };
          }
        }),
      );
    }
  }

  const startup = startupOf(empty);
  let passed = 0;
  let first: Omit<JudgeOutcome, "tests"> | undefined;
  const marks = results.map((s, i) => {
    const outcome = classify(s, tests[i], startup, lang.limit);
    if (!outcome) passed++;
    else first ??= { ...outcome, failedTest: i + 1, passedTests: 0 };
    return markOf(s, outcome, startup);
  });
  const ran = results.filter((s) => s.status_id === 3).map((s) => Number(s.time ?? 0) - startup);
  const slowestMs = ran.length ? Math.max(0, Math.round(Math.max(...ran) * 1000)) : undefined;
  return first
    ? { ...first, passedTests: passed, slowestMs, tests: marks }
    : { verdict: "accepted", passedTests: passed, slowestMs, tests: marks };
}

const startupOf = (empty: Submission) => (empty.status_id === 3 ? Number(empty.time ?? 0) : 0);

function markOf(s: Submission, outcome: ReturnType<typeof classify>, startup: number): TestMark {
  const ms = s.time === null ? undefined : Math.max(0, Math.round((Number(s.time) - startup) * 1000));
  return { verdict: outcome?.verdict ?? "accepted", ms };
}

function classify(
  s: Submission,
  test: TestCase,
  startup: number,
  limit: number,
): { verdict: Exclude<TestMark["verdict"], "accepted" | "running">; detail?: string } | null {
  // 13 内部错误、14 执行格式错误：判题服务的问题，不算模型的错
  if (s.status_id === 13 || s.status_id === 14) throw new JudgeUnavailable("判题服务内部错误");
  if (s.status_id === 6) return { verdict: "compile_error", detail: clip(dec(s.compile_output)) };
  if (s.status_id === 5 || Number(s.time ?? 0) - startup > limit) {
    return { verdict: "time_limit", detail: `超过 ${limit} 秒` };
  }
  if (s.status_id >= 7) {
    return { verdict: "runtime_error", detail: clip(dec(s.stderr) || dec(s.message)) };
  }
  if (norm(dec(s.stdout)) !== norm(test.output)) return { verdict: "wrong_answer" };
  return null;
}
