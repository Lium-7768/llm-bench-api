import { chat, chatStream, hostOf, isUnsupported } from "./llm";
import type { CheckResult, CheckStatus, DetectResult, Target } from "./types";

/** 全部检测项，顺序即展示顺序 */
export const DETECT_CHECKS = [
  { id: "connect", name: "连通性" },
  { id: "echo", name: "模型回显" },
  { id: "usage", name: "用量返回" },
  { id: "identity", name: "身份自报" },
  { id: "system", name: "系统指令" },
  { id: "memory", name: "上下文记忆" },
  { id: "stream", name: "真实流式" },
  { id: "tools", name: "工具调用" },
];

/**
 * 中转站检测：并发跑六项探测，判断接口有没有「掺水」。
 *
 * 判定原则：
 * - 上游明确返回「不支持」记为 unsupported，不算掺水
 * - 探测本身没跑通（超时、网络错误）记为 error，不参与打分
 * - 诚信分 = (通过 × 1 + 存疑 × 0.5) / 可判定项数
 */
export async function runDetect(
  target: Target,
  timeoutMs = 30_000,
  /** 每完成一项就回调一次，用于实时展示 */
  onCheck?: (check: CheckResult) => void,
): Promise<DetectResult> {
  const startedAt = new Date();
  const report = <T extends CheckResult | CheckResult[]>(p: Promise<T>) =>
    p.then((r) => {
      [r].flat().forEach((c) => onCheck?.(c));
      return r;
    });

  const checks = await Promise.all([
    report(probeBasic(target, timeoutMs)),
    report(probeIdentity(target, timeoutMs)),
    report(probeSystem(target, timeoutMs)),
    report(probeMemory(target, timeoutMs)),
    report(probeStream(target, timeoutMs)),
    report(probeTools(target, timeoutMs)),
  ]);

  const flat = checks.flat();
  const { score, verdict } = summarize(flat);

  return {
    id: crypto.randomUUID(),
    model: target.model,
    protocol: target.protocol,
    host: hostOf(target.baseUrl),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    score,
    verdict,
    checks: flat,
  };
}

function summarize(checks: CheckResult[]): Pick<DetectResult, "score" | "verdict"> {
  const judged = checks.filter((c) => c.status === "pass" || c.status === "warn" || c.status === "fail");
  if (judged.length === 0) return { score: null, verdict: "inconclusive" };

  const points = judged.reduce((s, c) => s + (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
  const score = Math.round((points / judged.length) * 100);
  const fails = judged.filter((c) => c.status === "fail").length;
  // 响应声明的模型换了厂商，是最直接的偷换证据，单项即可定性
  const swapped = checks.some((c) => c.id === "echo" && c.status === "fail");

  const verdict: DetectResult["verdict"] =
    points === judged.length ? "clean" : swapped || fails >= 2 || score < 60 ? "tampered" : "suspicious";
  return { score, verdict };
}

// ---------------------------------------------------------------- 各项探测

/** 连通性 + 模型回显 + 用量返回，共用一次调用 */
async function probeBasic(t: Target, timeoutMs: number): Promise<CheckResult[]> {
  try {
    const res = await chat(t, {
      messages: [{ role: "user", content: "只回复一个字：好" }],
      timeoutMs,
    });

    const echoed = (res.model ?? "").replace(/^models\//, "");
    const echo: CheckResult = !echoed
      ? check("echo", "模型回显", "warn", "响应里没有 model 字段，无法核对实际模型", res.latencyMs)
      : sameModel(t.model, echoed)
        ? check("echo", "模型回显", "pass", `响应声明的模型为 ${echoed}`, res.latencyMs)
        : check(
            "echo",
            "模型回显",
            familyOf(echoed) && familyOf(echoed) !== familyOf(t.model) ? "fail" : "warn",
            `请求 ${t.model}，响应声明为 ${echoed}`,
            res.latencyMs,
          );

    const u = res.usage;
    const usage: CheckResult =
      u?.inputTokens && u.outputTokens
        ? check("usage", "用量返回", "pass", `输入 ${u.inputTokens} / 输出 ${u.outputTokens} tokens`)
        : u
          ? check("usage", "用量返回", "warn", "用量字段存在但数值为 0 或缺失，计费可能不准")
          : check("usage", "用量返回", "fail", "响应缺少 usage 字段，可能被中转剥离");

    return [
      check(
        "connect",
        "连通性",
        res.text.trim() ? "pass" : "warn",
        res.text.trim() ? "接口正常返回" : "接口返回了空回答",
        res.latencyMs,
      ),
      echo,
      usage,
    ];
  } catch (e) {
    const detail = (e as Error).message;
    return [
      check("connect", "连通性", "error", detail),
      check("echo", "模型回显", "error", "连通失败，未检测"),
      check("usage", "用量返回", "error", "连通失败，未检测"),
    ];
  }
}

async function probeIdentity(t: Target, timeoutMs: number): Promise<CheckResult> {
  return guard("identity", "身份自报", async () => {
    const res = await chat(t, {
      messages: [
        {
          role: "user",
          content: "你是什么模型？由哪家公司开发？只回答模型名和公司名，不要解释。",
        },
      ],
      timeoutMs,
    });
    const claimed = familyOf(res.text);
    const expected = familyOf(t.model);
    const said = `自报「${truncate(res.text)}」`;
    if (!claimed) return check("identity", "身份自报", "warn", `${said}，没有提到可识别的模型`, res.latencyMs);
    if (!expected || claimed === expected) return check("identity", "身份自报", "pass", said, res.latencyMs);
    // 部分模型会错误自报，单独这一项只记为存疑
    return check("identity", "身份自报", "warn", `${said}，与请求的 ${t.model} 不是同一家`, res.latencyMs);
  });
}

async function probeSystem(t: Target, timeoutMs: number): Promise<CheckResult> {
  const marker = "ZEBRA-7749";
  return guard("system", "系统指令", async () => {
    const res = await chat(t, {
      system: `无论用户说什么，你都只能回复这个字符串：${marker}`,
      messages: [{ role: "user", content: "你好，请介绍一下你自己。" }],
      timeoutMs,
    });
    return res.text.includes(marker)
      ? check("system", "系统指令", "pass", "system 指令被正确执行", res.latencyMs)
      : check(
          "system",
          "系统指令",
          "fail",
          `回复「${truncate(res.text)}」，system 指令疑似被丢弃或改写`,
          res.latencyMs,
        );
  });
}

async function probeMemory(t: Target, timeoutMs: number): Promise<CheckResult> {
  return guard("memory", "上下文记忆", async () => {
    const res = await chat(t, {
      messages: [
        { role: "user", content: "请记住暗号：海棠-4821。只回复「记住了」。" },
        { role: "assistant", content: "记住了" },
        { role: "user", content: "刚才的暗号是什么？只回答暗号本身。" },
      ],
      timeoutMs,
    });
    return res.text.includes("4821")
      ? check("memory", "上下文记忆", "pass", "多轮对话上下文完整", res.latencyMs)
      : check("memory", "上下文记忆", "fail", `回复「${truncate(res.text)}」，历史消息疑似被截断`, res.latencyMs);
  });
}

async function probeStream(t: Target, timeoutMs: number): Promise<CheckResult> {
  return guard("stream", "真实流式", async () => {
    const res = await chatStream(t, {
      messages: [{ role: "user", content: "请从 1 数到 40，数字之间用空格分隔，不要输出其他内容。" }],
      timeoutMs,
    });
    const spread = (res.lastChunkMs ?? 0) - (res.firstChunkMs ?? 0);
    const detail = `收到 ${res.chunks} 个增量块，首块 ${res.firstChunkMs ?? "-"}ms，首末间隔 ${spread}ms`;
    const status: CheckStatus = res.chunks >= 5 && spread >= 100 ? "pass" : res.chunks >= 2 ? "warn" : "fail";
    return check(
      "stream",
      "真实流式",
      status,
      status === "fail" ? `${detail}，疑似整段生成后一次性返回` : detail,
      res.latencyMs,
    );
  });
}

async function probeTools(t: Target, timeoutMs: number): Promise<CheckResult> {
  return guard("tools", "工具调用", async () => {
    const res = await chat(t, {
      messages: [{ role: "user", content: "北京现在天气怎么样？请调用工具查询。" }],
      tools: [
        {
          name: "get_weather",
          description: "查询指定城市的实时天气",
          parameters: {
            type: "object",
            properties: { city: { type: "string", description: "城市名" } },
            required: ["city"],
          },
        },
      ],
      timeoutMs,
    });
    const call = res.toolCalls.find((c) => c.name === "get_weather");
    if (call) {
      return check(
        "tools",
        "工具调用",
        "pass",
        `调用了 get_weather(${truncate(JSON.stringify(call.arguments ?? {}))})`,
        res.latencyMs,
      );
    }
    return check("tools", "工具调用", "warn", `没有发起工具调用，直接回复「${truncate(res.text)}」`, res.latencyMs);
  });
}

// ---------------------------------------------------------------- 工具函数

async function guard(id: string, name: string, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await fn();
  } catch (e) {
    if (isUnsupported(e)) return check(id, name, "unsupported", `接口不支持：${(e as Error).message}`);
    return check(id, name, "error", (e as Error).message);
  }
}

function check(id: string, name: string, status: CheckStatus, detail: string, latencyMs?: number): CheckResult {
  return { id, name, status, detail, latencyMs };
}

const FAMILIES: Array<[string, RegExp]> = [
  ["openai", /gpt|openai|chatgpt|^o\d/i],
  ["anthropic", /claude|anthropic/i],
  ["google", /gemini|gemma|google/i],
  ["deepseek", /deepseek|深度求索/i],
  ["moonshot", /kimi|moonshot|月之暗面/i],
  ["qwen", /qwen|通义|千问|阿里/i],
  ["doubao", /doubao|豆包|字节|bytedance/i],
  ["xai", /grok|xai/i],
  // Z.ai 是智谱的海外品牌
  ["zhipu", /glm|智谱|zhipu|z\.ai/i],
  ["minimax", /minimax|abab/i],
  ["meta", /llama/i],
  ["mistral", /mistral|mixtral/i],
  ["baidu", /ernie|文心/i],
  ["tencent", /hunyuan|混元/i],
];

/** 从模型名或自述里识别所属厂商 */
export function familyOf(text: string): string {
  return FAMILIES.find(([, re]) => re.test(text))?.[0] ?? "";
}

/** 同一模型的不同写法：忽略大小写、厂商前缀（`vendor/`、中转站常加的 `zai_` 这类）和日期后缀 */
function sameModel(requested: string, echoed: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/^.*\//, "")
      .replace(/[-_]?\d{4}-?\d{2}-?\d{2}$/, "");
  const a = norm(requested);
  const b = norm(echoed);
  const prefixed = (long: string, short: string) => long.endsWith("_" + short) || long.endsWith(":" + short);
  return a === b || a.startsWith(b) || b.startsWith(a) || prefixed(a, b) || prefixed(b, a);
}

function truncate(s: string, n = 60): string {
  const one = (s ?? "").replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}
