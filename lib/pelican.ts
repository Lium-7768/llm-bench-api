import { chat, hostOf } from "./llm";
import type { PelicanResult, Target } from "./types";

export const PELICAN_PROMPT = "Generate an SVG of a pelican riding a bicycle. Output only the SVG code, nothing else.";

/** 让模型画一只骑自行车的鹈鹕。不打分，只把 SVG 交给人看 */
export async function runPelican(
  target: Target,
  opts: { prompt?: string; timeoutMs?: number } = {},
): Promise<PelicanResult> {
  const startedAt = new Date();
  const prompt = opts.prompt?.trim() || PELICAN_PROMPT;

  const res = await chat(target, {
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    maxTokens: target.protocol === "anthropic" ? 8192 : undefined,
    timeoutMs: opts.timeoutMs ?? 120_000,
  });

  return {
    id: crypto.randomUUID(),
    model: target.model,
    protocol: target.protocol,
    host: hostOf(target.baseUrl),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    prompt,
    svg: extractSvg(res.text),
    raw: res.text,
    usage: res.usage,
  };
}

/** 从回答里取出第一个完整的 <svg>…</svg> */
export function extractSvg(text: string): string | null {
  const match = text.match(/<svg[\s\S]*?<\/svg>/i);
  if (!match) return null;
  let svg = match[0];
  // 没写 xmlns 时浏览器不会把它当作图片渲染
  if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}
