/**
 * 公共类型定义 —— 对外 API 的契约来源。
 * 任何改动都应同步更新 /app/api/v1/openapi/route.ts 与 README。
 */

/** 评测维度 */
export type Category =
  | "reasoning" // 逻辑推理
  | "reading" // 阅读理解
  | "coding" // 代码
  | "knowledge" // 知识问答
  | "hallucination" // 幻觉/迷惑题
  | "instruction"; // 指令遵循

/** 单道题目 */
export interface Question {
  id: string;
  category: Category;
  /** 题干 */
  prompt: string;
  /** 期望答案（用于客观判分） */
  expected?: string;
  /** 可接受的等价答案 */
  accept?: string[];
  /** 判分方式：exact=精确匹配，contains=包含，regex=正则，rubric=无标准答案由模型自评 */
  match: "exact" | "contains" | "regex" | "rubric";
  /** rubric 模式下给「裁判模型」的评分说明 */
  rubric?: string;
  /** 分值 */
  weight: number;
  /** 难度 1-5 */
  difficulty: 1 | 2 | 3 | 4 | 5;
}

/** 随机数种子：同一 seed + 同一题库版本 => 同一套题 */
export interface RunConfig {
  /** 被测模型 */
  model: string;
  /** 基础地址，如 https://api.openai.com/v1 */
  baseUrl: string;
  /** 题目数量上限 */
  limit?: number;
  /** 只测某些维度 */
  categories?: Category[];
  /** 采样温度 */
  temperature?: number;
  seed?: number;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed";

/** 单题作答结果 */
export interface AnswerResult {
  questionId: string;
  category: Category;
  prompt: string;
  /** 模型原始输出 */
  output: string;
  /** 是否命中 */
  passed: boolean;
  /** 该题得分 */
  score: number;
  /** 该题满分 */
  weight: number;
  /** 失败原因或错误信息 */
  error?: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

/** 维度聚合 */
export interface CategoryScore {
  category: Category;
  score: number;
  max: number;
  /** 0-100 */
  percent: number;
  total: number;
  passed: number;
}

/** 一次评测任务 */
export interface Run {
  id: string;
  status: RunStatus;
  createdAt: string;
  finishedAt?: string;
  config: RunConfig;
  /** 参与本次评测的题目 id 列表 */
  questionIds: string[];
  answers: AnswerResult[];
  categories?: CategoryScore[];
  /** 0-100 总分 */
  score?: number;
  error?: string;
  meta: {
    engineVersion: string;
    bankVersion: string;
    /** 被脱敏后的 baseUrl（不含密钥） */
    baseUrlMasked: string;
    totalLatencyMs?: number;
  };
}

/** 中转站/接口指纹检测结果 */
export interface FingerprintResult {
  model: string;
  /** 模型自报身份与请求模型是否一致 */
  identityMatch: boolean;
  /** 是否吞掉 system prompt */
  systemPromptHonored: boolean;
  /** 是否伪流式（一次性返回） */
  streamingReal: boolean;
  /** 返回 token 用量是否正常 */
  usagePresent: boolean;
  signals: Array<{ name: string; ok: boolean; detail: string }>;
  /**
   * clean       全部检查通过
   * suspicious  部分异常，建议人工复核
   * tampered    多项异常，很可能被改动过
   * inconclusive 探测本身没能完成（超时/上游不可达），无法下结论
   */
  verdict: "clean" | "suspicious" | "tampered" | "inconclusive";
}
