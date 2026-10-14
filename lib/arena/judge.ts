import type { ArenaLanguage, ProblemVerdict } from "../types";
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
  /** 交给 Judge0 的 CPU 时限，秒 */
  cpu: number;
}

/**
 * 公共实例上新版 Python、Node 的沙箱启动就要 2.3–2.8 秒（实测），旧版很快但语法太老（Python 3.8 不支持 list[int]，
 * Node 12 不支持 ?.）。所以选新版，每批额外提交一个空程序测启动耗时，判超时用「用时 − 启动耗时」。
 * Go 1.23 在公共实例繁忙时经常编译超时，用 1.18。
 */
export const LANGUAGES: Record<ArenaLanguage, Runtime> = {
  python: { label: "Python", runtime: "Python 3.13", judge0: 109, note: "", empty: "pass", cpu: 6 },
  javascript: {
    label: "JavaScript",
    runtime: "Node.js 22（CommonJS）",
    judge0: 102,
    note: "用 require('fs').readFileSync(0, 'utf8') 读取全部输入。",
    empty: "",
    cpu: 6,
  },
  java: {
    label: "Java",
    runtime: "Java 17",
    judge0: 91,
    note: "主类必须是 public class Main，不要写 package。",
    empty: "public class Main { public static void main(String[] a) {} }",
    cpu: 4,
  },
  go: {
    label: "Go",
    runtime: "Go 1.18",
    judge0: 95,
    note: "使用 package main。",
    empty: "package main\nfunc main() {}",
    cpu: 4,
  },
};

/** 每组测试的运行时限（不含运行环境启动），超时由我们按 Judge0 返回的用时判 */
export const TIME_LIMIT_S = 2;

export class JudgeUnavailable extends Error {}

export interface JudgeOutcome {
  verdict: Exclude<ProblemVerdict, "no_code" | "error">;
  passedTests: number;
  failedTest?: number;
  detail?: string;
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
  )) as Array<{ token?: string }>;
  const tokens = created.map((c) => c.token);
  if (tokens.some((t) => !t)) throw new JudgeUnavailable("判题服务拒绝了提交");

  let results: Submission[];
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const got = (await call(
      `/submissions/batch?base64_encoded=true&fields=status_id,time,stdout,stderr,compile_output,message&tokens=${tokens.join(",")}`,
      {},
      signal,
    )) as { submissions: Submission[] };
    results = got.submissions;
    // 1 排队中，2 运行中
    if (results.every((s) => s.status_id > 2)) break;
  }

  const empty = results.pop()!;
  const startup = empty.status_id === 3 ? Number(empty.time ?? 0) : 0;
  let passed = 0;
  let first: JudgeOutcome | undefined;
  results.forEach((s, i) => {
    const outcome = classify(s, tests[i], startup);
    if (!outcome) passed++;
    else first ??= { ...outcome, failedTest: i + 1, passedTests: 0 };
  });
  return first ? { ...first, passedTests: passed } : { verdict: "accepted", passedTests: passed };
}

function classify(s: Submission, test: TestCase, startup: number): Omit<JudgeOutcome, "passedTests"> | null {
  // 13 内部错误、14 执行格式错误：判题服务的问题，不算模型的错
  if (s.status_id === 13 || s.status_id === 14) throw new JudgeUnavailable("判题服务内部错误");
  if (s.status_id === 6) return { verdict: "compile_error", detail: clip(dec(s.compile_output)) };
  if (s.status_id === 5 || Number(s.time ?? 0) - startup > TIME_LIMIT_S) {
    return { verdict: "time_limit", detail: `超过 ${TIME_LIMIT_S} 秒` };
  }
  if (s.status_id >= 7) {
    return { verdict: "runtime_error", detail: clip(dec(s.stderr) || dec(s.message)) };
  }
  if (norm(dec(s.stdout)) !== norm(test.output)) return { verdict: "wrong_answer" };
  return null;
}
