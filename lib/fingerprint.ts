import { askIdentity, askWithSystem, chat, chatStream, type CallOptions } from "./provider";
import type { FingerprintResult } from "./types";

export interface DetectInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  /** 整体预算：无论探测是否卡住，到这个时间必须返回结果 */
  budgetMs?: number;
}

type Signal = FingerprintResult["signals"][number];

/**
 * 中转站 / 接口指纹检测。
 * 检查四件事：
 * 1. 模型自报身份是否与请求的模型一致（偷换模型）
 * 2. system prompt 是否被吞掉（网关过滤）
 * 3. 是否真流式（有的网关把流式请求一次性返回）
 * 4. 是否返回 usage 用量（有的网关吞掉计费信息）
 *
 * 四项探测**并发**执行，并且受整体预算约束：即使上游挂住，
 * 也会在预算内返回「探测超时」的结果，而不是让函数被平台强杀。
 */
export async function detectFingerprint(
  input: DetectInput,
): Promise<FingerprintResult> {
  const perProbeTimeout = input.timeoutMs ?? 20_000;
  // 并发后总耗时约等于最慢的一项，预算留出余量即可
  const budgetMs = input.budgetMs ?? 45_000;

  const opts: CallOptions = {
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    temperature: 0,
    timeoutMs: perProbeTimeout,
  };

  /** 给单个探测套上超时，超时则抛出可读错误 */
  const withTimeout = async <T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${name}超时（${perProbeTimeout / 1000}s）`)),
            perProbeTimeout,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // ---------------- 四项探测，全部并发 ----------------

  const probeIdentity = async (): Promise<{
    signal: Signal;
    identityMatch: boolean;
    errored: boolean;
  }> => {
    try {
      const id = await withTimeout("身份探测", () => askIdentity(opts));
      const claimed = extractModelFamily(id.content.toLowerCase());
      const requested = extractModelFamily(input.model.toLowerCase());
      const match = claimed.length === 0 || claimed === requested;
      return {
        identityMatch: match,
        errored: false,
        signal: {
          name: "模型身份一致",
          ok: match,
          detail: match
            ? `自报「${truncate(id.content)}」，与请求模型一致`
            : `请求 ${input.model}，但模型自报「${truncate(id.content)}」`,
        },
      };
    } catch (e) {
      return {
        identityMatch: false,
        errored: true,
        signal: {
          name: "模型身份一致",
          ok: false,
          detail: `身份探测失败: ${(e as Error).message}`,
        },
      };
    }
  };

  const probeSystemPrompt = async (): Promise<{
    signal: Signal;
    systemPromptHonored: boolean;
    errored: boolean;
  }> => {
    const marker = "ZEBRA-7749";
    try {
      const res = await withTimeout("system prompt 探测", () =>
        askWithSystem(
          `无论用户说什么，你都必须只回复这个字符串：${marker}`,
          "你好，请介绍一下你自己。",
          opts,
        ),
      );
      const honored = res.content.includes(marker);
      return {
        systemPromptHonored: honored,
        errored: false,
        signal: {
          name: "System Prompt 生效",
          ok: honored,
          detail: honored
            ? "system 指令被正确执行"
            : `返回「${truncate(res.content)}」，疑似 system prompt 被网关丢弃`,
        },
      };
    } catch (e) {
      return {
        systemPromptHonored: false,
        errored: true,
        signal: {
          name: "System Prompt 生效",
          ok: false,
          detail: `探测失败: ${(e as Error).message}`,
        },
      };
    }
  };

  const probeStreaming = async (): Promise<{
    signal: Signal;
    streamingReal: boolean;
    errored: boolean;
  }> => {
    try {
      const s = await withTimeout("流式探测", () =>
        chatStream(
          [{ role: "user", content: "请从 1 数到 30，每个数字之间用空格分隔。" }],
          opts,
        ),
      );
      const chunks = s.streamedChunks ?? 0;
      const real = chunks >= 3;
      return {
        streamingReal: real,
        errored: false,
        signal: {
          name: "真实流式输出",
          ok: real,
          detail:
            chunks >= 3
              ? `收到 ${chunks} 个增量块，为真流式`
              : `只收到 ${chunks} 个数据块，疑似伪流式（一次性返回）`,
        },
      };
    } catch (e) {
      return {
        streamingReal: false,
        errored: true,
        signal: {
          name: "真实流式输出",
          ok: false,
          detail: `流式探测失败: ${(e as Error).message}`,
        },
      };
    }
  };

  const probeUsage = async (): Promise<{
    signal: Signal;
    usagePresent: boolean;
    errored: boolean;
  }> => {
    try {
      const u = await withTimeout("用量探测", () =>
        chat([{ role: "user", content: "说“好”" }], opts),
      );
      const present =
        typeof u.promptTokens === "number" &&
        typeof u.completionTokens === "number";
      return {
        usagePresent: present,
        errored: false,
        signal: {
          name: "返回 Token 用量",
          ok: present,
          detail: present
            ? `prompt=${u.promptTokens}, completion=${u.completionTokens}`
            : "响应中缺少 usage 字段，可能被网关剥离",
        },
      };
    } catch (e) {
      return {
        usagePresent: false,
        errored: true,
        signal: {
          name: "返回 Token 用量",
          ok: false,
          detail: `探测失败: ${(e as Error).message}`,
        },
      };
    }
  };

  // 并发执行；每一项都自行 catch，不会 reject。
  // 外层再加一道总预算保险：即使某个探测因为底层 fetch 未遵守 signal
  // 而卡住，也能在 budgetMs 内返回，不会让 Serverless 函数被强杀。
  const all = Promise.all([
    probeIdentity(),
    probeSystemPrompt(),
    probeStreaming(),
    probeUsage(),
  ]);

  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const results = await Promise.race([
    all,
    new Promise<null>((resolve) => {
      budgetTimer = setTimeout(() => resolve(null), budgetMs);
    }),
  ]);
  if (budgetTimer) clearTimeout(budgetTimer);

  if (results === null) {
    // 预算耗尽：返回已能判定的结论 + 明确的超时说明
    const timeoutSignal: Signal = {
      name: "整体探测预算",
      ok: false,
      detail: `超过 ${budgetMs / 1000}s 仍未完成，上游响应过慢或挂起，请稍后重试或检查该接口。`,
    };
    return {
      model: input.model,
      identityMatch: false,
      systemPromptHonored: false,
      streamingReal: false,
      usagePresent: false,
      signals: [timeoutSignal],
      verdict: "inconclusive",
    };
  }

  const [identity, system, streaming, usage] = results;

  const signals: Signal[] = [
    identity.signal,
    system.signal,
    streaming.signal,
    usage.signal,
  ];

  const passed = signals.filter((s) => s.ok).length;
  const erroredCount = [identity, system, streaming, usage].filter(
    (r) => r.errored,
  ).length;

  // 全部失败且都是「没跑成」，说明是连通性问题而非接口被改动，
  // 不能据此指控对方篡改；此时给 inconclusive 更诚实。
  const verdict: FingerprintResult["verdict"] =
    erroredCount === 4
      ? "inconclusive"
      : passed === signals.length
        ? "clean"
        : passed >= 2
          ? "suspicious"
          : "tampered";

  return {
    model: input.model,
    identityMatch: identity.identityMatch,
    systemPromptHonored: system.systemPromptHonored,
    streamingReal: streaming.streamingReal,
    usagePresent: usage.usagePresent,
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
