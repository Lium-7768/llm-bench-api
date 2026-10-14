import type { ArenaLanguage, ArenaTier, ArenaTrack, ProblemResult, ProblemVerdict } from "../types";

/** 段位赛里前后端共用的常量。题目和测试只在服务端（problems.ts），不要从前端引用 */

export const TIERS: ArenaTier[] = ["bronze", "silver", "gold", "platinum", "diamond", "king"];

export const TIER_LABEL: Record<ArenaTier, string> = {
  bronze: "青铜",
  silver: "白银",
  gold: "黄金",
  platinum: "白金",
  diamond: "钻石",
  king: "王者",
};

/** 每档的分值：越往上越难，分值按斐波那契增长 */
export const TIER_WEIGHT: Record<ArenaTier, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 5,
  diamond: 8,
  king: 13,
};

/**
 * 打分：每题满分是所在档位的分值。全部测试通过得满分；部分通过按通过比例得一半；其他得 0。
 * 调用失败（error）和还没判完（pending）的题不计入。总分 = 得分 / 满分 × 100
 */
export function arenaScore(problems: ProblemResult[]): { score: number | null; best: ArenaTier | null } {
  let earned = 0;
  let total = 0;
  for (const p of problems) {
    if (!p.tier || p.verdict === "error" || p.verdict === "pending") continue;
    const w = TIER_WEIGHT[p.tier];
    total += w;
    earned += p.verdict === "accepted" ? w : p.totalTests ? (w * 0.5 * p.passedTests) / p.totalTests : 0;
  }
  const solved = TIERS.filter((t) => problems.some((p) => p.tier === t && p.verdict === "accepted"));
  return { score: total ? Math.round((earned / total) * 100) : null, best: solved.at(-1) ?? null };
}

export const LANGUAGE_LABEL: Record<ArenaLanguage, string> = {
  python: "Python",
  javascript: "JavaScript",
  java: "Java",
  go: "Go",
};

export const ARENA_LANGUAGES = Object.keys(LANGUAGE_LABEL) as ArenaLanguage[];

export const TRACK_LABEL: Record<ArenaTrack, string> = {
  algo: "算法",
  frontend: "前端",
};

export const VERDICT_LABEL: Record<ProblemVerdict, string> = {
  accepted: "通过",
  wrong_answer: "答案错误",
  time_limit: "超时",
  compile_error: "编译失败",
  runtime_error: "运行出错",
  no_code: "没有代码",
  error: "调用失败",
  pending: "待判定",
};
