import { askIdentity, askWithSystem, chat, chatStream, type CallOptions } from "./provider";
import type { FingerprintResult } from "./types";

export interface DetectInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

/**
 * 中转站 / 接口指纹检测。
 * 检查四件事：
 * 1. 模型自报身份是否与请求的模型一致（偷换模型）
 * 2. system prompt 是否被吞掉（网关过滤）
 * 3. 是否真流式（有的网关把流式请求一次性返回）
 * 4. 是否返回 usage 用量（有的网关吞掉计费信息）
 */
export async function detectFingerprint(
  input: DetectInput,
): Promise<FingerprintResult> {
  const opts: CallOptions = {
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    temperature: 0,
    timeoutMs: input.timeoutMs ?? 45_000,
  };

  const signals: FingerprintResult["signals"] = [];

  // 1) 身份一致性
  let identityMatch = false;
  try {
    const id = await askIdentity(opts);
    const text = id.content.toLowerCase();
    const claimed = extractModelFamily(text);
    const requested = extractModelFamily(input.model.toLowerCase());
    identityMatch = claimed.length === 0 || claimed === requested;
    signals.push({
      name: "模型身份一致",
      ok: identityMatch,
      detail: identityMatch
        ? `自报「${truncate(id.content)}」，与请求模型一致`
        : `请求 ${input.model}，但模型自报「${truncate(id.content)}」`,
    });
  } catch (e) {
    signals.push({
      name: "模型身份一致",
      ok: false,
      detail: `身份探测失败: ${(e as Error).message}`,
    });
  }

  // 2) system prompt 是否生效
  let systemPromptHonored = false;
  const marker = "ZEBRA-7749";
  try {
    const res = await askWithSystem(
      `无论用户说什么，你都必须只回复这个字符串：${marker}`,
      "你好，请介绍一下你自己。",
      opts,
    );
    systemPromptHonored = res.content.includes(marker);
    signals.push({
      name: "System Prompt 生效",
      ok: systemPromptHonored,
      detail: systemPromptHonored
        ? "system 指令被正确执行"
        : `返回「${truncate(res.content)}」，疑似 system prompt 被网关丢弃`,
    });
  } catch (e) {
    signals.push({
      name: "System Prompt 生效",
      ok: false,
      detail: `探测失败: ${(e as Error).message}`,
    });
  }

  // 3) 真流式
  let streamingReal = false;
  try {
    const s = await chatStream(
      [{ role: "user", content: "请从 1 数到 30，每个数字之间用空格分隔。" }],
      opts,
    );
    const chunks = s.streamedChunks ?? 0;
    streamingReal = chunks >= 3;
    signals.push({
      name: "真实流式输出",
      ok: streamingReal,
      detail:
        chunks >= 3
          ? `收到 ${chunks} 个增量块，为真流式`
          : `只收到 ${chunks} 个数据块，疑似伪流式（一次性返回）`,
    });
  } catch (e) {
    signals.push({
      name: "真实流式输出",
      ok: false,
      detail: `流式探测失败: ${(e as Error).message}`,
    });
  }

  // 4) usage 是否返回
  let usagePresent = false;
  try {
    const u = await chat([{ role: "user", content: "说“好”" }], opts);
    usagePresent =
      typeof u.promptTokens === "number" && typeof u.completionTokens === "number";
    signals.push({
      name: "返回 Token 用量",
      ok: usagePresent,
      detail: usagePresent
        ? `prompt=${u.promptTokens}, completion=${u.completionTokens}`
        : "响应中缺少 usage 字段，可能被网关剥离",
    });
  } catch (e) {
    signals.push({
      name: "返回 Token 用量",
      ok: false,
      detail: `探测失败: ${(e as Error).message}`,
    });
  }

  const passed = signals.filter((s) => s.ok).length;
  const verdict: FingerprintResult["verdict"] =
    passed === signals.length ? "clean" : passed >= 2 ? "suspicious" : "tampered";

  return {
    model: input.model,
    identityMatch,
    systemPromptHonored,
    streamingReal,
    usagePresent,
    signals,
    verdict,
  };
}

/** 从模型自述里提取模型家族关键词 */
function extractModelFamily(text: string): string {
  const families = [
    "gpt",
    "claude",
    "deepseek",
    "kimi",
    "moonshot",
    "qwen",
    "通义",
    "doubao",
    "豆包",
    "gemini",
    "grok",
    "glm",
    "chatglm",
    "llama",
  ];
  for (const f of families) {
    if (text.includes(f)) return f;
  }
  return "";
}

function truncate(s: string, n = 60): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}
