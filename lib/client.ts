/**
 * 极薄的 API 客户端。
 * 前端不做任何计算，只负责调用 /api/v1/* 并渲染返回值。
 */
export interface ApiEnvelope<T> {
  ok: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const json = (await res.json()) as ApiEnvelope<T>;
  if (!json.ok || json.data === null) {
    throw new Error(json.error?.message ?? `请求失败 (${res.status})`);
  }
  return json.data;
}

export interface CategoryInfo {
  id: string;
  label: string;
  totalQuestions: number;
  maxScore: number;
  difficulties: number[];
}

export interface QuestionInfo {
  id: string;
  category: string;
  categoryLabel: string;
  prompt: string;
  match: string;
  weight: number;
  difficulty: number;
}

export interface CategoryScoreView {
  category: string;
  label: string;
  percent: number;
  passed: number;
  total: number;
}

export interface RunSummary {
  id: string;
  status: string;
  score: number | null;
  configuredModel: string;
  createdAt: string;
  finishedAt?: string;
  baseUrl: string;
  totalLatencyMs: number | null;
  categories: CategoryScoreView[];
}

export interface AnswerView {
  questionId: string;
  category: string;
  prompt: string;
  output: string;
  passed: boolean;
  score: number;
  weight: number;
  error?: string;
  latencyMs: number;
}

export interface RunDetail extends RunSummary {
  error: string | null;
  questionIds: string[];
  answers: AnswerView[];
  meta: {
    engineVersion: string;
    bankVersion: string;
    baseUrlMasked: string;
    totalLatencyMs?: number;
  };
}

export interface LeaderboardEntry {
  rank: number;
  model: string;
  baseUrl: string;
  runs: number;
  avgScore: number;
  bestScore: number;
  avgLatencyMs: number | null;
  lastRunAt: string;
  categories: Array<{ category: string; label: string; avgPercent: number }>;
}

export interface DetectResult {
  model: string;
  verdict: "clean" | "suspicious" | "tampered";
  identityMatch: boolean;
  systemPromptHonored: boolean;
  streamingReal: boolean;
  usagePresent: boolean;
  signals: Array<{ name: string; ok: boolean; detail: string }>;
  detectedAt: string;
  explanation: string;
}

export interface RunRequestBody {
  model: string;
  baseUrl: string;
  apiKey: string;
  limit?: number;
  categories?: string[];
  seed?: number;
  concurrency?: number;
  timeoutMs?: number;
}

export interface DetectRequestBody {
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface StorageInfo {
  backend: "redis" | "memory";
  persistent: boolean;
  ok: boolean;
  error: string | null;
  note: string;
}

export const api = {
  index: () =>
    request<{
      name: string;
      version: string;
      engineVersion: string;
      bankVersion: string;
      totalQuestions: number;
      endpoints: Array<{ method: string; path: string; desc: string }>;
      categories: Array<{ id: string; label: string }>;
    }>("/api/v1"),

  health: () =>
    request<{
      status: string;
      time: string;
      totalQuestions: number;
      storage: StorageInfo;
    }>("/api/v1/health"),

  categories: () =>
    request<{ total: number; categories: CategoryInfo[] }>("/api/v1/categories"),

  questions: (params?: { category?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.limit) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{ total: number; questions: QuestionInfo[] }>(
      `/api/v1/questions${suffix}`,
    );
  },

  createRun: (body: RunRequestBody) =>
    request<RunSummary & { answers: AnswerView[]; error: string | null }>(
      "/api/v1/runs",
      { method: "POST", body: JSON.stringify(body) },
    ),

  listRuns: (limit = 20) =>
    request<{ total: number; runs: RunSummary[] }>(`/api/v1/runs?limit=${limit}`),

  getRun: (id: string) => request<RunDetail>(`/api/v1/runs/${id}`),

  deleteRun: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/api/v1/runs/${id}`, { method: "DELETE" }),

  leaderboard: () =>
    request<{ total: number; basedOnRuns: number; leaderboard: LeaderboardEntry[] }>(
      "/api/v1/leaderboard",
    ),

  detect: (body: DetectRequestBody) =>
    request<DetectResult>("/api/v1/detect", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
