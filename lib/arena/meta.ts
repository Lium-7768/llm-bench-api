import type { ArenaLanguage, ArenaTier, ArenaTrack, ProblemVerdict } from "../types";

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

/** 每档 3 题，答对 2 题晋级 */
export const PASS_PER_TIER = 2;

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
