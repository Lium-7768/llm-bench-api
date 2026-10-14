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
  /** 输出格式与动画分析；v0.4.0 之前的报告没有 */
  analysis?: SvgAnalysis;
  usage?: Usage;
}

/**
 * 回答是否遵守「只输出 SVG」：
 * pure 只有 SVG（允许 XML 声明）；fenced 外面包了代码块；extra 前后有其他文字或不止一段 SVG；
 * truncated 有 <svg> 开头没有结尾；none 没有 SVG
 */
export type SvgFormat = "pure" | "fenced" | "extra" | "truncated" | "none";

export interface SvgAnalysis {
  format: SvgFormat;
  /** 是否带动画（SMIL 或 CSS 动画）。网页以图片方式展示，这两种动画都会播放 */
  animated: boolean;
  animation: Array<"smil" | "css">;
  /** 是否含脚本或事件属性。以图片方式展示时脚本不会执行，靠脚本驱动的动画也不会动 */
  script: boolean;
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
 * inference  综合推理：知识 + 多步反证 + 抗诱导的复合题，单独成步
 * pelican     鹈鹕测试：画一只骑自行车的鹈鹕，不计分
 *
 * 前四步都会产出得分，但综合分只取 指纹 30% + 基础 40% + 糖果 30%；
 * inference 单独展示，不计入综合分（2026.10.3 起）。
 */
export type Stage = "detect" | "basic" | "candy" | "inference" | "pelican";

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
  inference?: BenchResult;
  pelican?: PelicanResult;
  /** 编程彩蛋的段位赛结果，只由网页在浏览器里补进报告，接口不返回 */
  arena?: ArenaResult;
  /** 某一步整体失败或被跳过的原因 */
  errors: Partial<Record<Stage, string>>;
}

// ---------------------------------------------------------------- 编程彩蛋

/**
 * 编程段位赛：五步全部跑完、糖果测试全对后才能进入，不计入综合分。
 * 模型按题面写完整程序，交给外部判题服务（Judge0）运行隐藏测试。
 */
export type ArenaLanguage = "python" | "javascript" | "java" | "go";

/** 段位从低到高 */
export type ArenaTier = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "king";

/**
 * accepted 全部通过；wrong_answer 答案错误；time_limit 超时；compile_error 编译失败；
 * runtime_error 运行出错；no_code 回答里没有代码；error 调用模型或判题服务失败（不算模型答错）
 */
export type ProblemVerdict =
  "accepted" | "wrong_answer" | "time_limit" | "compile_error" | "runtime_error" | "no_code" | "error";

export interface ProblemResult {
  id: string;
  title: string;
  verdict: ProblemVerdict;
  passedTests: number;
  totalTests: number;
  /** 第一组没通过的测试，从 1 开始；不给输入，测试是隐藏的 */
  failedTest?: number;
  /** 编译或运行错误信息、调用失败原因（截断） */
  detail?: string;
  /** 从回答里提取的代码 */
  code: string;
  /** 模型作答用时 */
  latencyMs: number;
  /** 跑完的测试里最慢的一组程序用时 */
  slowestMs?: number;
  usage?: Usage;
}

export interface TierResult {
  tier: ArenaTier;
  language: ArenaLanguage;
  /** 答对 2 题及以上 */
  passed: boolean;
  problems: ProblemResult[];
  durationMs: number;
  /** 调用失败导致这一档无法判定，可以重试 */
  error?: string;
}

export interface ArenaResult {
  language: ArenaLanguage;
  /** 通过的最高段位；一档都没过为 null */
  rank: ArenaTier | null;
  tiers: TierResult[];
  startedAt: string;
}
