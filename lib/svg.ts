import type { SvgAnalysis, SvgFormat } from "./types";

/**
 * 分析模型画出的 SVG：是否按要求只输出 SVG，是静态还是动态。
 * 纯函数，前后端共用：服务端写进报告，前端给没有分析结果的旧报告补算。
 */

const SVG_BLOCK = /<svg[\s\S]*?<\/svg>/gi;
/** 允许出现在 <svg> 前面的 XML 声明、DOCTYPE 和注释，它们都属于合法的 SVG 文件 */
const PROLOG = /^(?:\s*(?:<\?xml[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->))*\s*/i;
/** 整段回答被一个代码块包住，如 ```svg … ``` */
const FENCED = /^\s*```[\w-]*\s*\n([\s\S]*?)\n?\s*```\s*$/;

const SMIL = /<(?:animate|animateTransform|animateMotion|set)\b/i;
const CSS_ANIMATION = /@keyframes\b|\banimation(?:-name)?\s*:/i;
const SCRIPT = /<script\b|\son[a-z]+\s*=/i;

/** 从回答里取出第一个完整的 <svg>…</svg>；没写 xmlns 时补上，否则浏览器不会把它当图片渲染 */
export function extractSvg(text: string): string | null {
  const match = text.match(/<svg[\s\S]*?<\/svg>/i);
  if (!match) return null;
  let svg = match[0];
  if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

/** 回答是否遵守「只输出 SVG」 */
export function svgFormat(raw: string): SvgFormat {
  const blocks = raw.match(SVG_BLOCK) ?? [];
  if (!blocks.length) return /<svg\b/i.test(raw) ? "truncated" : "none";
  const isOnly = (s: string) => blocks.length === 1 && s.replace(PROLOG, "").trim() === blocks[0];
  if (isOnly(raw)) return "pure";
  const fenced = raw.match(FENCED);
  if (fenced && isOnly(fenced[1])) return "fenced";
  return "extra";
}

/** 分析动画。只看 SVG 本身，不看回答里的其他文字 */
export function svgMotion(svg: string | null): Pick<SvgAnalysis, "animated" | "animation" | "script"> {
  if (!svg) return { animated: false, animation: [], script: false };
  const animation: SvgAnalysis["animation"] = [];
  if (SMIL.test(svg)) animation.push("smil");
  if (CSS_ANIMATION.test(svg)) animation.push("css");
  return { animated: animation.length > 0, animation, script: SCRIPT.test(svg) };
}

export function analyzeSvg(raw: string, svg: string | null): SvgAnalysis {
  return { format: svgFormat(raw), ...svgMotion(svg) };
}

/** 报告里的分析结果；旧报告没有这个字段且原始回答已丢弃，只能补算动画，格式未知 */
export function analysisOf(p: { svg: string | null; analysis?: SvgAnalysis }): SvgAnalysis & { known: boolean } {
  if (p.analysis) return { ...p.analysis, known: true };
  return { format: p.svg ? "pure" : "none", ...svgMotion(p.svg), known: false };
}

export const FORMAT_LABEL: Record<SvgFormat, string> = {
  pure: "纯 SVG",
  fenced: "带代码块",
  extra: "带多余文字",
  truncated: "被截断",
  none: "没有 SVG",
};

export const FORMAT_HINT: Record<SvgFormat, string> = {
  pure: "回答只有 SVG 代码，遵守了「只输出 SVG」",
  fenced: "SVG 外面包了一层 Markdown 代码块，没有完全遵守「只输出 SVG」",
  extra: "SVG 前后还有说明文字，或者给了不止一段 SVG",
  truncated: "回答里有 <svg> 开头但没有结尾，通常是输出太长被截断",
  none: "回答里没有 SVG",
};

export const ANIMATION_LABEL: Record<SvgAnalysis["animation"][number], string> = {
  smil: "SMIL",
  css: "CSS",
};
