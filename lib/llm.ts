import type { Protocol, Target, Usage } from "./types";

/**
 * 上游模型调用层：把三种协议统一成同一组函数。
 *
 * - openai     OpenAI Chat Completions 及所有兼容接口（DeepSeek、Kimi、通义、豆包、GLM、Grok、各类中转站…）
 * - anthropic  Anthropic Messages API（Claude 官方及兼容中转）
 * - gemini     Google Gemini generateContent
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDef[];
  timeoutMs?: number;
  /** 流式请求每收到一段回答文本就回调一次（不含思考内容） */
  onText?: (text: string) => void;
}

export interface ChatResponse {
  text: string;
  /** 上游响应里声明的模型名 */
  model?: string;
  usage?: Usage;
  toolCalls: Array<{ name: string; arguments: unknown }>;
  latencyMs: number;
}

export interface StreamResponse {
  text: string;
  /** 收到的非空文本增量个数 */
  chunks: number;
  firstChunkMs?: number;
  lastChunkMs?: number;
  usage?: Usage;
  latencyMs: number;
}

export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(status ? `上游返回 ${status}：${summarizeError(body)}` : body);
  }
}

/** 上游在时限内没有答完（区别于连不上、HTTP 错误） */
export class UpstreamTimeout extends UpstreamError {}

const DEFAULT_TIMEOUT = 60_000;

// ---------------------------------------------------------------- 地址与协议

export const DEFAULT_BASE_URL: Record<Protocol, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
};

function clean(raw: string): string {
  let s = (raw ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}

/** 未指定协议时根据地址推断 */
export function resolveProtocol(baseUrl: string, hint?: string): Protocol {
  if (hint === "openai" || hint === "anthropic" || hint === "gemini") return hint;
  try {
    const u = new URL(clean(baseUrl));
    const path = u.pathname.toLowerCase();
    if (u.hostname.endsWith("anthropic.com") || /\/anthropic(\/|$)|\/messages$/.test(path)) {
      return "anthropic";
    }
    if (u.hostname === "generativelanguage.googleapis.com" && !path.includes("/openai")) {
      return "gemini";
    }
  } catch {
    // 交给后续校验报错
  }
  return "openai";
}

/** 只保留协议与域名，用于结果展示 */
export function hostOf(baseUrl: string): string {
  try {
    const u = new URL(clean(baseUrl));
    return `${u.protocol}//${u.host}`;
  } catch {
    return "invalid-url";
  }
}

function openaiBase(baseUrl: string): string {
  const b = clean(baseUrl).replace(/\/chat\/completions$/i, "");
  // 只写了域名时补 /v1；已经带路径的（/api/v3、/compatible-mode/v1、/v1beta/openai…）保持原样
  const path = new URL(b).pathname;
  return path === "" || path === "/" ? b + "/v1" : b;
}

function anthropicBase(baseUrl: string): string {
  return clean(baseUrl)
    .replace(/\/messages$/i, "")
    .replace(/\/v1$/i, "");
}

function geminiBase(baseUrl: string): string {
  return clean(baseUrl).replace(/\/v1(beta)?(\/models.*)?$/i, "");
}

function geminiModel(model: string): string {
  return encodeURIComponent(model.replace(/^models\//, ""));
}

// ---------------------------------------------------------------- 请求构造

interface Variant {
  /** 是否发送 temperature；部分推理模型只接受默认值 */
  temperature: boolean;
  /** OpenAI 新模型要求 max_completion_tokens */
  maxField: "max_tokens" | "max_completion_tokens";
  /** 部分兼容接口不认 stream_options */
  streamOptions: boolean;
}

const BASE_VARIANT: Variant = {
  temperature: true,
  maxField: "max_tokens",
  streamOptions: true,
};

/** 上游因参数不兼容返回 400 时，调整参数再试一次 */
function nextVariant(v: Variant, body: string): Variant | null {
  if (v.temperature && /temperature/i.test(body)) return { ...v, temperature: false };
  if (v.maxField === "max_tokens" && /max_tokens/i.test(body)) {
    return { ...v, maxField: "max_completion_tokens" };
  }
  if (v.streamOptions && /stream_options/i.test(body)) return { ...v, streamOptions: false };
  return null;
}

function buildRequest(
  t: Target,
  req: ChatRequest,
  stream: boolean,
  v: Variant,
): { url: string; headers: Record<string, string>; body: unknown } {
  const temperature = v.temperature ? (req.temperature ?? 0) : undefined;

  if (t.protocol === "anthropic") {
    return {
      url: anthropicBase(t.baseUrl) + "/v1/messages",
      headers: {
        "x-api-key": t.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: t.model,
        max_tokens: req.maxTokens ?? 2048,
        ...(req.system ? { system: req.system } : {}),
        messages: req.messages,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(req.tools?.length
          ? {
              tools: req.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
              })),
            }
          : {}),
        ...(stream ? { stream: true } : {}),
      },
    };
  }

  if (t.protocol === "gemini") {
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return {
      url: `${geminiBase(t.baseUrl)}/v1beta/models/${geminiModel(t.model)}:${action}`,
      headers: { "x-goog-api-key": t.apiKey },
      body: {
        contents: req.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        generationConfig: {
          ...(temperature !== undefined ? { temperature } : {}),
          // Gemini 思考模型的思考 token 也计入上限，设小了会返回空回答，因此默认不设
          ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
        },
        ...(req.tools?.length
          ? {
              tools: [
                {
                  functionDeclarations: req.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  })),
                },
              ],
            }
          : {}),
      },
    };
  }

  return {
    url: openaiBase(t.baseUrl) + "/chat/completions",
    headers: { Authorization: `Bearer ${t.apiKey}` },
    body: {
      model: t.model,
      messages: [...(req.system ? [{ role: "system", content: req.system }] : []), ...req.messages],
      ...(temperature !== undefined ? { temperature } : {}),
      ...(req.maxTokens ? { [v.maxField]: req.maxTokens } : {}),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
      ...(stream ? { stream: true, ...(v.streamOptions ? { stream_options: { include_usage: true } } : {}) } : {}),
    },
  };
}

/** 发请求；遇到参数不兼容的 400 自动调整后重试 */
async function send(t: Target, req: ChatRequest, stream: boolean, signal: AbortSignal): Promise<Response> {
  let variant: Variant | null = BASE_VARIANT;
  let lastError: UpstreamError | undefined;

  for (let attempt = 0; attempt < 4 && variant; attempt++) {
    const { url, headers, body } = buildRequest(t, req, stream, variant);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
    if (res.ok) return res;

    const text = await res.text().catch(() => "");
    lastError = new UpstreamError(res.status, text);
    variant = res.status === 400 ? nextVariant(variant, text) : null;
  }
  throw lastError ?? new UpstreamError(0, "请求失败");
}

async function withTimeout<T>(timeoutMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (e) {
    if (controller.signal.aborted) {
      throw new UpstreamTimeout(0, `请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    if (e instanceof UpstreamError) throw e;
    throw new UpstreamError(0, `无法连接上游：${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- 对外函数

/** 单次对话（非流式） */
export async function chat(t: Target, req: ChatRequest): Promise<ChatResponse> {
  const started = Date.now();
  return withTimeout(req.timeoutMs ?? DEFAULT_TIMEOUT, async (signal) => {
    const res = await send(t, req, false, signal);
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!json) throw new UpstreamError(res.status, "响应不是合法 JSON");
    return { ...parseResponse(t.protocol, json), latencyMs: Date.now() - started };
  });
}

/** 流式对话：统计增量块数与到达时间，用于识别「假流式」 */
export async function chatStream(t: Target, req: ChatRequest): Promise<StreamResponse> {
  const started = Date.now();
  return withTimeout(req.timeoutMs ?? DEFAULT_TIMEOUT, async (signal) => {
    const res = await send(t, req, true, signal);
    if (!res.body) throw new UpstreamError(res.status, "上游没有返回响应体");

    const out: StreamResponse = { text: "", chunks: 0, latencyMs: 0 };
    for await (const event of readSse(res.body)) {
      const { text, usage } = parseStreamEvent(t.protocol, event);
      if (usage) out.usage = { ...out.usage, ...usage };
      if (text) {
        req.onText?.(text);
        const at = Date.now() - started;
        out.text += text;
        out.chunks += 1;
        out.firstChunkMs ??= at;
        out.lastChunkMs = at;
      }
    }
    out.latencyMs = Date.now() - started;
    return out;
  });
}

/**
 * 长回答用流式拿完整文本。非流式请求在模型生成完之前连接上没有任何数据，
 * 部分中转站和网关会在空闲一分钟左右直接断开（实测 ~72s 后 ETIMEDOUT）；流式有持续数据，不会被断。
 * 上游拒绝流式请求（HTTP 错误）时退回普通请求，超时和断连不退回，避免把时间花两遍。
 */
export async function chatLong(t: Target, req: ChatRequest): Promise<ChatResponse> {
  try {
    const res = await chatStream(t, req);
    return { text: res.text, usage: res.usage, toolCalls: [], latencyMs: res.latencyMs };
  } catch (e) {
    if (e instanceof UpstreamError && e.status > 0) return chat(t, req);
    throw e;
  }
}

/** 列出接口可用的模型 */
export async function listModels(t: Omit<Target, "model">): Promise<string[]> {
  return withTimeout(20_000, async (signal) => {
    let url: string;
    let headers: Record<string, string>;
    if (t.protocol === "anthropic") {
      url = anthropicBase(t.baseUrl) + "/v1/models?limit=1000";
      headers = { "x-api-key": t.apiKey, "anthropic-version": "2023-06-01" };
    } else if (t.protocol === "gemini") {
      url = geminiBase(t.baseUrl) + "/v1beta/models?pageSize=1000";
      headers = { "x-goog-api-key": t.apiKey };
    } else {
      url = openaiBase(t.baseUrl) + "/models";
      headers = { Authorization: `Bearer ${t.apiKey}` };
    }

    const res = await fetch(url, { headers, signal, cache: "no-store" });
    const text = await res.text();
    if (!res.ok) throw new UpstreamError(res.status, text);

    const json = safeJson(text) as {
      data?: Array<{ id?: string }>;
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    } | null;

    const ids =
      t.protocol === "gemini"
        ? (json?.models ?? [])
            .filter((m) => m.supportedGenerationMethods?.includes("generateContent") ?? true)
            .map((m) => (m.name ?? "").replace(/^models\//, ""))
        : (json?.data ?? []).map((m) => m.id ?? "");

    return [...new Set(ids.filter(Boolean))].sort();
  });
}

/** 上游是否在说「不支持该功能」，而不是出错 */
export function isUnsupported(e: unknown): boolean {
  if (!(e instanceof UpstreamError)) return false;
  if (![400, 404, 405, 422, 501].includes(e.status)) return false;
  return /not\s+support|unsupported|不支持|unknown (field|parameter|name)|unrecognized|extra.*not permitted|invalid.*tool/i.test(
    e.body,
  );
}

// ---------------------------------------------------------------- 响应解析

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function parseResponse(protocol: Protocol, json: Json): Omit<ChatResponse, "latencyMs"> {
  if (protocol === "anthropic") {
    const blocks: Json[] = Array.isArray(json.content) ? json.content : [];
    return {
      text: blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join(""),
      model: json.model,
      usage: json.usage ? { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens } : undefined,
      toolCalls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ name: b.name, arguments: b.input })),
    };
  }

  if (protocol === "gemini") {
    const parts: Json[] = json.candidates?.[0]?.content?.parts ?? [];
    const meta = json.usageMetadata;
    return {
      text: parts
        .filter((p) => !p.thought && typeof p.text === "string")
        .map((p) => p.text)
        .join(""),
      model: json.modelVersion,
      usage: meta ? { inputTokens: meta.promptTokenCount, outputTokens: meta.candidatesTokenCount } : undefined,
      toolCalls: parts
        .filter((p) => p.functionCall)
        .map((p) => ({ name: p.functionCall.name, arguments: p.functionCall.args })),
    };
  }

  const message: Json = json.choices?.[0]?.message ?? {};
  const content = message.content;
  return {
    text:
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((p: Json) => p.text ?? "").join("")
          : (json.choices?.[0]?.text ?? ""),
    model: json.model,
    usage: json.usage
      ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
      : undefined,
    toolCalls: (message.tool_calls ?? []).map((c: Json) => ({
      name: c.function?.name,
      arguments: safeJson(c.function?.arguments) ?? c.function?.arguments,
    })),
  };
}

function parseStreamEvent(protocol: Protocol, e: Json): { text?: string; usage?: Usage } {
  if (protocol === "anthropic") {
    if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
      return { text: e.delta.text };
    }
    if (e.type === "message_start" && e.message?.usage) {
      return { usage: { inputTokens: e.message.usage.input_tokens } };
    }
    if (e.type === "message_delta" && e.usage) {
      return { usage: { outputTokens: e.usage.output_tokens } };
    }
    return {};
  }

  if (protocol === "gemini") {
    const parts: Json[] = e.candidates?.[0]?.content?.parts ?? [];
    const meta = e.usageMetadata;
    return {
      text: parts
        .filter((p) => !p.thought && typeof p.text === "string")
        .map((p) => p.text)
        .join(""),
      usage: meta ? { inputTokens: meta.promptTokenCount, outputTokens: meta.candidatesTokenCount } : undefined,
    };
  }

  return {
    text: e.choices?.[0]?.delta?.content ?? undefined,
    usage: e.usage ? { inputTokens: e.usage.prompt_tokens, outputTokens: e.usage.completion_tokens } : undefined,
  };
}

/** 逐条读取 SSE 的 data 负载（已解析为 JSON） */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<Json> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
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
      if (!payload || payload === "[DONE]") continue;
      const json = safeJson(payload);
      if (json && typeof json === "object") yield json as Json;
    }
  }
}

function safeJson(s: unknown): unknown {
  if (typeof s !== "string") return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 从上游错误体里取出可读信息 */
function summarizeError(body: string): string {
  const json = safeJson(body) as Json | null;
  const msg =
    json?.error?.message ??
    (typeof json?.error === "string" ? json.error : undefined) ??
    json?.message ??
    json?.[0]?.error?.message;
  return (
    String(msg ?? body ?? "")
      .replace(/\s+/g, " ")
      .slice(0, 300) || "无响应内容"
  );
}
