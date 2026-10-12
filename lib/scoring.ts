import type {
  AnswerResult,
  Category,
  CategoryScore,
  Question,
} from "./types";
import { CATEGORY_LABELS } from "./bank";

export const ENGINE_VERSION = "1.0.0";

/** 归一化模型输出：去代码块、去空白、去常见前缀 */
export function normalize(raw: string): string {
  let s = (raw ?? "").trim();
  // 去掉 markdown 代码块围栏
  s = s.replace(/^```[a-zA-Z]*\s*/m, "").replace(/```\s*$/m, "");
  s = s.trim();
  return s;
}

export interface JudgeInput {
  question: Question;
  output: string;
  /** rubric 模式下由裁判模型给出的 0-1 分数 */
  rubricScore?: number;
}

export interface JudgeOutput {
  passed: boolean;
  score: number;
  reason?: string;
}

/**
 * 判分：客观题本地判，主观题（rubric）依赖外部传入的 rubricScore。
 */
export function judge({ question, output, rubricScore }: JudgeInput): JudgeOutput {
  const text = normalize(output);
  if (!text) {
    return { passed: false, score: 0, reason: "空输出" };
  }

  switch (question.match) {
    case "exact": {
      const expected = (question.expected ?? "").trim();
      const candidates = [expected, ...(question.accept ?? [])].filter(Boolean);

      // 1) 完全一致（忽略大小写与首尾空白）
      const hit = candidates.some((c) => text.toLowerCase() === c.toLowerCase());
      if (hit) return { passed: true, score: question.weight };

      // 2) 宽容匹配：模型可能带少量前后缀（如「答案：42」「47 天」）。
      //    必须做词边界校验，否则 142 / 420 / 4212 都会被当成 42 而误判通过。
      const loose = candidates.some((c) => {
        if (text.length > c.length + 12) return false;
        return containsAsToken(text, c);
      });

      return {
        passed: loose,
        score: loose ? question.weight : 0,
        reason: loose ? undefined : `期望「${expected}」，实际「${truncate(text)}」`,
      };
    }

    case "contains": {
      const candidates = [question.expected, ...(question.accept ?? [])].filter(
        Boolean,
      ) as string[];
      const ok = candidates.some((c) => text.includes(c));
      return {
        passed: ok,
        score: ok ? question.weight : 0,
        reason: ok ? undefined : `未包含任一关键词: ${candidates.join(" / ")}`,
      };
    }

    case "regex": {
      const patterns = [question.expected, ...(question.accept ?? [])].filter(
        Boolean,
      ) as string[];
      const invalid: string[] = [];
      for (const p of patterns) {
        try {
          if (new RegExp(p, "im").test(text)) {
            return { passed: true, score: question.weight };
          }
        } catch (e) {
          // 非法正则属于题库 bug，必须暴露出来，不能静默判 0 分
          invalid.push(`${p} (${(e as Error).message})`);
        }
      }
      if (invalid.length === patterns.length && invalid.length > 0) {
        return {
          passed: false,
          score: 0,
          reason: `题库配置错误：正则无法编译 —— ${invalid.join("; ")}`,
        };
      }
      return {
        passed: false,
        score: 0,
        reason: `未匹配任一模式，实际「${truncate(text)}」`,
      };
    }

    case "rubric": {
      if (typeof rubricScore !== "number") {
        return {
          passed: false,
          score: 0,
          reason: "主观题未获得裁判评分（详见 runner 提供的具体原因）",
        };
      }
      const ratio = Math.max(0, Math.min(1, rubricScore));
      const score = round2(question.weight * ratio);
      return {
        passed: ratio >= 0.6,
        score,
        reason: ratio >= 0.6 ? undefined : `裁判评分 ${ratio}`,
      };
    }

    default:
      return { passed: false, score: 0, reason: "未知判分方式" };
  }
}

/** 聚合维度得分 */
export function aggregate(answers: AnswerResult[]): CategoryScore[] {
  const map = new Map<Category, { score: number; max: number; total: number; passed: number }>();
  for (const a of answers) {
    const cur = map.get(a.category) ?? { score: 0, max: 0, total: 0, passed: 0 };
    cur.score += a.score;
    cur.max += a.weight;
    cur.total += 1;
    if (a.passed) cur.passed += 1;
    map.set(a.category, cur);
  }
  return [...map.entries()]
    .map(([category, v]) => ({
      category,
      score: round2(v.score),
      max: round2(v.max),
      percent: v.max > 0 ? round2((v.score / v.max) * 100) : 0,
      total: v.total,
      passed: v.passed,
    }))
    .sort((a, b) => b.percent - a.percent);
}

/** 总分 0-100：加权得分率 */
export function totalScore(answers: AnswerResult[]): number {
  const max = answers.reduce((s, a) => s + a.weight, 0);
  const got = answers.reduce((s, a) => s + a.score, 0);
  return max > 0 ? round2((got / max) * 100) : 0;
}

/** 与基线对比，判断是否「降智」 */
export function compareToBaseline(
  current: number,
  baseline: number,
  tolerance = 5,
): { delta: number; verdict: "better" | "stable" | "degraded" } {
  const delta = round2(current - baseline);
  if (delta > tolerance) return { delta, verdict: "better" };
  if (delta < -tolerance) return { delta, verdict: "degraded" };
  return { delta, verdict: "stable" };
}

export function categoryLabel(c: Category): string {
  return CATEGORY_LABELS[c] ?? c;
}

/**
 * 判断 needle 是否作为独立片段出现在 haystack 中（大小写不敏感）。
 *
 * 用于 exact 模式的宽容匹配，避免「包含即通过」造成的误判：
 *   containsAsToken("142", "42")     -> false  （42 是 142 的一部分，不是独立答案）
 *   containsAsToken("420", "42")     -> false
 *   containsAsToken("42abc", "42")   -> false  （与字母数字粘连，视为没有清晰作答）
 *   containsAsToken("答案为42", "42") -> true   （中文不是词字符，可作边界）
 *   containsAsToken("47 天", "47")    -> true
 *
 * 规则：若 needle 首/尾是字母或数字，则对应一侧不能紧邻字母或数字。
 * 中文、空格、标点都算合法边界。这样可以接受「答案是 42」「47 天」这类
 * 正常作答，同时拒绝「142」这种把答案藏在更大数字里的情况。
 */
export function containsAsToken(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();

  const isWordChar = (ch: string | undefined): boolean =>
    ch !== undefined && /[a-z0-9]/.test(ch);

  const startsWordy = isWordChar(n[0]);
  const endsWordy = isWordChar(n[n.length - 1]);

  let from = 0;
  while (true) {
    const idx = h.indexOf(n, from);
    if (idx === -1) return false;

    const before = idx > 0 ? h[idx - 1] : undefined;
    const after = idx + n.length < h.length ? h[idx + n.length] : undefined;

    const leftOk = !startsWordy || !isWordChar(before);
    const rightOk = !endsWordy || !isWordChar(after);

    if (leftOk && rightOk) return true;
    from = idx + 1;
  }
}

function truncate(s: string, n = 80): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
