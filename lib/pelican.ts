import { chatLong, hostOf } from "./llm";
import { analyzeSvg, extractSvg } from "./svg";
import type { PelicanResult, Target } from "./types";

export const PELICAN_PROMPT = "Generate an SVG of a pelican riding a bicycle. Output only the SVG code, nothing else.";

/** 让模型画一只骑自行车的鹈鹕。不打分，只把 SVG 交给人看 */
export async function runPelican(
  target: Target,
  opts: { prompt?: string; timeoutMs?: number } = {},
): Promise<PelicanResult> {
  const startedAt = new Date();
  const prompt = opts.prompt?.trim() || PELICAN_PROMPT;

  // SVG 很长，生成要一两分钟，用流式避免被中转站按空闲连接断开
  const res = await chatLong(target, {
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    maxTokens: target.protocol === "anthropic" ? 8192 : undefined,
    timeoutMs: opts.timeoutMs ?? 120_000,
  });

  const svg = extractSvg(res.text);
  return {
    id: crypto.randomUUID(),
    model: target.model,
    protocol: target.protocol,
    host: hostOf(target.baseUrl),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    prompt,
    svg,
    raw: res.text,
    analysis: analyzeSvg(res.text, svg),
    usage: res.usage,
  };
}
