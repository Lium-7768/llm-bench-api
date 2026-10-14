import vm from "node:vm";
import type { ArenaTier } from "../../types";
import { TIERS } from "../meta";
import type { TestCase } from "../problems";
import { assemble, LOGIC_PROBLEMS, type LogicProblem } from "./logic";
import { UI_PROBLEMS, type UiProblem } from "./ui";

/** 前端赛道的题库（只在服务端用）：每档 1 道逻辑题（Judge0 判）+ 2 道 UI 题（浏览器判） */
export type FrontendProblem = LogicProblem | UiProblem;

export function frontendProblemsOf(tier: ArenaTier): FrontendProblem[] {
  if (!TIERS.includes(tier)) return [];
  return [...LOGIC_PROBLEMS, ...UI_PROBLEMS].filter((p) => p.tier === tier);
}

const cache = new Map<string, Promise<TestCase[]>>();

/** 逻辑题的测试：输入是 cases 里的每一项，期望输出由参考实现在 node:vm 里跑同一套测试脚本得到 */
export function logicTestsOf(p: LogicProblem): Promise<TestCase[]> {
  let tests = cache.get(p.id);
  if (!tests) {
    tests = Promise.all(
      p.cases.map(async (c) => {
        const input = JSON.stringify(c);
        return { input, output: await runReference(p, input) };
      }),
    );
    cache.set(p.id, tests);
    tests.catch(() => cache.delete(p.id));
  }
  return tests;
}

function runReference(p: LogicProblem, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`参考实现超时：${p.id}`)), 10_000);
    const quiet = () => {};
    const context = vm.createContext({
      __arena_input: input,
      console: {
        log: (s: unknown) => {
          clearTimeout(timer);
          resolve(String(s));
        },
        info: quiet,
        warn: quiet,
        error: quiet,
        debug: quiet,
      },
    });
    vm.runInContext(assemble(p, p.reference), context, { timeout: 5_000 });
  });
}
