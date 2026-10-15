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

/** 一题得几分：全部测试通过得满分（档位分值）；部分通过按通过比例得一半；其他得 0 */
export function pointsOf(p: Pick<ProblemResult, "tier" | "verdict" | "passedTests" | "totalTests">): number {
  if (!p.tier) return 0;
  const w = TIER_WEIGHT[p.tier];
  if (p.verdict === "accepted") return w;
  return p.totalTests ? (w * 0.5 * p.passedTests) / p.totalTests : 0;
}

/**
 * 打分：总分 = 得分 / 满分 × 100。满分是这次选中的所有题的分值之和（planned），
 * 答错就停，后面没答到的题也算在满分里、得 0 分，所以越早被淘汰分越低。
 * 调用失败（error）的题不计入满分。
 */
export function arenaScore(
  problems: ProblemResult[],
  planned: ArenaTier[] = problems.map((p) => p.tier!).filter(Boolean),
): { score: number | null; best: ArenaTier | null } {
  const failed = problems.filter((p) => p.verdict === "error").map((p) => p.tier!);
  let total = planned.reduce((s, t) => s + TIER_WEIGHT[t], 0);
  for (const t of failed) total -= TIER_WEIGHT[t];
  const earned = problems.filter((p) => p.verdict !== "error").reduce((s, p) => s + pointsOf(p), 0);
  const solved = TIERS.filter((t) => problems.some((p) => p.tier === t && p.verdict === "accepted"));
  return { score: total > 0 ? Math.round((earned / total) * 100) : null, best: solved.at(-1) ?? null };
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
