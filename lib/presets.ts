import type { Protocol } from "./types";

export interface Preset {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  /** 常用模型 ID，仅作输入提示；以「获取模型列表」拉到的为准 */
  models: string[];
}

/**
 * 常见服务商预设。没有列出的服务只要兼容其中一种协议，选「自定义」填地址即可。
 */
export const PRESETS: Preset[] = [
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: [],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "moonshot",
    name: "Kimi（月之暗面）",
    protocol: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    models: [],
  },
  {
    id: "dashscope",
    name: "通义千问（阿里云百炼）",
    protocol: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-max", "qwen-plus", "qwen-turbo"],
  },
  {
    id: "volcengine",
    name: "豆包（火山方舟）",
    protocol: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: [],
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    protocol: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: [],
  },
  {
    id: "xai",
    name: "xAI Grok",
    protocol: "openai",
    baseUrl: "https://api.x.ai/v1",
    models: [],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [],
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    protocol: "openai",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: [],
  },
  {
    id: "custom",
    name: "自定义 / 中转站",
    protocol: "openai",
    baseUrl: "",
    models: [],
  },
];

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic Messages",
  gemini: "Gemini",
};
