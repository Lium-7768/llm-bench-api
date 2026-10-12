import type { Question } from "./types";

/** OpenAI 兼容的 Chat Completions 客户端 —— 覆盖绝大多数国内外模型 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  /** 是否检测到「伪流式」 */
  streamedChunks?: number;
}

export interface CallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
  /** 流式，用于检测伪流式 */
  stream?: boolean;
}

export function maskBaseUrl(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return "invalid-url";
  }
}

/** 归一化 baseUrl：允许用户传 https://x.com 或 https://x.com/v1 */
export function normalizeBaseUrl(baseUrl: string): string {
  let b = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(b)) b = "https://" + b;
  // 若没写 /v1 且不是已知带路径的网关，补 /v1
  if (!/\/v\d+$/.test(b) && !/\/chat\/completions$/.test(b)) {
    b = b + "/v1";
  }
  return b;
}

function endpoint(baseUrl: string): string {
  const b = normalizeBaseUrl(baseUrl);
  return b.endsWith("/chat/completions") ? b : b + "/chat/completions";
}

/** 单次对话调用（非流式） */
export async function chat(
  messages: ChatMessage[],
  opts: CallOptions,
): Promise<ChatResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

  try {
    const res = await fetch(endpoint(opts.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: opts.temperature ?? 0,
        stream: false,
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`上游 ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      content: data.choices?.[0]?.message?.content ?? "",
      latencyMs,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 流式调用：统计收到多少个数据块，用于识别「假流式」 */
export async function chatStream(
  messages: ChatMessage[],
  opts: CallOptions,
): Promise<ChatResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

  try {
    const res = await fetch(endpoint(opts.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: 0,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new Error(`上游 ${res.status}: ${body.slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let chunks = 0;
    const arrivals: number[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            chunks += 1;
            arrivals.push(Date.now() - started);
          }
        } catch {
          // 忽略无法解析的行
        }
      }
    }

    return {
      content,
      latencyMs: Date.now() - started,
      streamedChunks: chunks,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 让模型自报身份，用于指纹检测 */
export async function askIdentity(opts: CallOptions): Promise<ChatResult> {
  return chat(
    [
      {
        role: "user",
        content:
          "请用一句话回答：你是什么模型？由哪家公司开发？只回答模型名和公司名，不要解释。",
      },
    ],
    opts,
  );
}

/** 检测 system prompt 是否被吞掉 */
export async function askWithSystem(
  systemPrompt: string,
  userPrompt: string,
  opts: CallOptions,
): Promise<ChatResult> {
  return chat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    opts,
  );
}

export interface JudgeOutcome {
  /** 0-1 的得分率；解析失败时为 undefined */
  score?: number;
  /** 裁判模型的原始输出，便于排查 */
  raw: string;
  /** 解析失败的原因 */
  parseError?: string;
}

/**
 * 用裁判模型给主观题打分（0-1）。
 * 支持输出形式：`0.7`、`1`、`70%`、`7/10`、以及带说明文字时的最后一个数字。
 */
export async function judgeWithModel(
  question: Question,
  answer: string,
  opts: CallOptions,
): Promise<JudgeOutcome> {
  const res = await chat(
    [
      {
        role: "system",
        content:
          "你是一个严格的评分员。只输出一个 0 到 1 之间的小数（如 0.7），表示学生答案的得分率。不要输出任何其他内容。",
      },
      {
        role: "user",
        content: [
          `题目：${question.prompt}`,
          `评分标准：${question.rubric ?? "答案是否正确完整"}`,
          `学生答案：${answer}`,
          "",
          "请只输出 0-1 的小数。",
        ].join("\n"),
      },
    ],
    { ...opts, temperature: 0 },
  );

  const score = parseJudgeScore(res.content);
  return {
    score,
    raw: res.content,
    parseError:
      score === undefined
        ? `裁判模型未返回可解析的分数，原始输出：「${res.content.slice(0, 120)}」`
        : undefined,
  };
}

/** 从裁判模型的自由文本中提取 0-1 的得分率 */
export function parseJudgeScore(content: string): number | undefined {
  const text = (content ?? "").trim();
  if (!text) return undefined;

  // 百分比：70% -> 0.7
  const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) {
    const v = parseFloat(pct[1]) / 100;
    if (Number.isFinite(v)) return clamp01(v);
  }

  // 分数：7/10 -> 0.7
  const frac = text.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac) {
    const denom = parseFloat(frac[2]);
    if (denom > 0) {
      const v = parseFloat(frac[1]) / denom;
      if (Number.isFinite(v)) return clamp01(v);
    }
  }

  // 纯小数或整数：取最后一个候选（裁判常先复述再给分）
  const nums = [...text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)]
    .map((m) => parseFloat(m[1]))
    .filter((n) => Number.isFinite(n));

  for (const n of nums.reverse()) {
    if (n >= 0 && n <= 1) return clamp01(n);
    // 容忍 0-100 的百分制打分
    if (n > 1 && n <= 100) return clamp01(n / 100);
  }

  return undefined;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
