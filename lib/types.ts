/**
 * 公共类型 —— 对外 API 的契约，前后端共用。
 * 改动时同步更新 app/api/v1/openapi/route.ts 与 README。
 */

/** 上游接口协议 */
export type Protocol = "openai" | "anthropic" | "gemini";

/** 被测接口：每次请求都由调用方带上，服务端不保存 */
export interface Target {
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  model: string;
}

// ---------------------------------------------------------------- 能力评测

export type Category = "reasoning" | "reading" | "coding" | "knowledge" | "hallucination" | "instruction" | "inference";

export interface Question {
  id: string;
  category: Category;
  prompt: string;
  /**
   * exact=精确匹配（带少量前后缀容错），contains=包含任一关键词，
   * regex=匹配任一正则（作用于整个回答），json=解析为 JSON 后与 expected 逐字段比较（不要求字段顺序）
   */
  match: "exact" | "contains" | "regex" | "json";
  /** exact 的标准答案 */
  expected?: string;
  /** 可接受的其他答案 / 关键词 / 正则 */
  accept?: string[];
  weight: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
}

export interface AnswerResult {
  questionId: string;
  category: Category;
  prompt: string;
  output: string;
  passed: boolean;
  score: number;
  weight: number;
  /** 未通过的原因或调用错误 */
  reason?: string;
  /** 调用上游失败（不计入得分） */
  errored?: boolean;
  latencyMs: number;
  usage?: Usage;
}

export interface CategoryScore {
  category: Category;
  label: string;
  /** 0-100 */
  percent: number;
  passed: number;
  total: number;
}

export interface BenchResult {
  id: string;
  model: string;
  protocol: Protocol;
  /** 只含协议与域名，不含路径参数和密钥 */
  host: string;
  startedAt: string;
  durationMs: number;
  /** 0-100，只按成功作答的题计算；全部调用失败时为 null */
  score: number | null;
  /** 调用失败、未计分的题数 */
  failedCalls: number;
  categories: CategoryScore[];
  answers: AnswerResult[];
  bankVersion: string;
  seed: number;
  error?: string;
}

// ---------------------------------------------------------------- 中转站检测

export type CheckStatus = "pass" | "warn" | "fail" | "unsupported" | "error";

export interface CheckResult {
  id: string;
  name: string;
  status: CheckStatus;
  detail: string;
  latencyMs?: number;
}

export interface DetectResult {
  id: string;
  model: string;
  protocol: Protocol;
  host: string;
  startedAt: string;
  durationMs: number;
  /** 0-100 诚信分；没有可判定项时为 null */
  score: number | null;
  /**
   * clean        全部通过
   * suspicious   有可疑项，建议复核
   * tampered     多项异常，很可能被掺水
   * inconclusive 探测本身没跑通（超时 / 不可达），无法下结论
   */
  verdict: "clean" | "suspicious" | "tampered" | "inconclusive";
  checks: CheckResult[];
}

// ---------------------------------------------------------------- 鹈鹕绘图

export interface PelicanResult {
  id: string;
  model: string;
  protocol: Protocol;
  host: string;
  startedAt: string;
  durationMs: number;
  prompt: string;
  /** 从回答里提取出的 SVG；没提取到时为 null */
  svg: string | null;
  /** 模型原始回答 */
  raw: string;
  usage?: Usage;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

/** 统一响应信封 */
export type Envelope<T> =
  { ok: true; data: T; error: null } | { ok: false; data: null; error: { code: string; message: string } };

// ---------------------------------------------------------------- 全面检测

/**
 * 检测按顺序分五步：
 * detect      指纹检测：中转站有没有换模型、吞指令、假流式
 * basic       基础测试：推理、阅读、代码、知识、指令遵循
 * candy       糖果测试：改过条件的熟题、不存在的文献，测幻觉
 * colorblind  综合推理：知识 + 多步反证 + 抗诱导的复合题，单独成步
 * pelican     鹈鹕测试：画一只骑自行车的鹈鹕，不计分
 *
 * 前四步都会产出得分，但综合分只取 指纹 30% + 基础 40% + 糖果 30%；
 * colorblind 单独展示，不计入综合分（2026.10.3 起）。
 */
export type Stage = "detect" | "basic" | "candy" | "colorblind" | "pelican";

/** 一次全面检测的完整报告 */
export interface Report {
  id: string;
  model: string;
  protocol: Protocol;
  host: string;
  startedAt: string;
  durationMs: number;
  stages: Stage[];
  /** 综合分 0-100 = 指纹 30% + 基础 40% + 糖果 30%（只算有结果的部分）；都没有时为 null。综合推理不计入 */
  score: number | null;
  detect?: DetectResult;
  basic?: BenchResult;
  candy?: BenchResult;
  /** 综合推理测试结果，独立于综合分 */
  colorblind?: BenchResult;
  pelican?: PelicanResult;
  /** 某一步整体失败或被跳过的原因 */
  errors: Partial<Record<Stage, string>>;
}
