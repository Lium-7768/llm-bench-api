import { ok, preflight, withStore } from "@/lib/http";
import { listRuns } from "@/lib/store";
import { CATEGORY_LABELS } from "@/lib/bank";
import type { Category } from "@/lib/types";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

interface Group {
  model: string;
  baseUrl: string;
  scores: number[];
  categoryScores: Map<Category, number[]>;
  totalLatencyMs: number[];
  runs: number;
  lastAt: string;
}

/**
 * GET /api/v1/leaderboard
 * 把历史上成功完成的评测按「模型 + baseUrl」聚合，得到平均分排名。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50") || 50, 200);

  return withStore(
    async () => (await listRuns(200)).filter((r) => r.status === "succeeded"),
    (runs) => {
      const groups = new Map<string, Group>();

      for (const r of runs) {
        const key = `${r.config.model}@${r.meta.baseUrlMasked}`;
        const fallback: Group = {
          model: r.config.model,
          baseUrl: r.meta.baseUrlMasked,
          scores: [],
          categoryScores: new Map<Category, number[]>(),
          totalLatencyMs: [],
          runs: 0,
          lastAt: r.createdAt,
        };
        const g: Group = groups.get(key) ?? fallback;
        g.scores.push(r.score ?? 0);
        g.runs += 1;
        if (r.meta.totalLatencyMs) g.totalLatencyMs.push(r.meta.totalLatencyMs);
        for (const c of r.categories ?? []) {
          const arr = g.categoryScores.get(c.category) ?? [];
          arr.push(c.percent);
          g.categoryScores.set(c.category, arr);
        }
        if (r.createdAt > g.lastAt) g.lastAt = r.createdAt;
        groups.set(key, g);
      }

      const entries = [...groups.values()]
        .map((g) => ({
          model: g.model,
          baseUrl: g.baseUrl,
          runs: g.runs,
          avgScore: avg(g.scores),
          bestScore: Math.max(...g.scores),
          avgLatencyMs: g.totalLatencyMs.length
            ? Math.round(avg(g.totalLatencyMs))
            : null,
          lastRunAt: g.lastAt,
          categories: [...g.categoryScores.entries()]
            .map(([category, arr]) => ({
              category,
              label: CATEGORY_LABELS[category],
              avgPercent: avg(arr),
            }))
            .sort((a, b) => b.avgPercent - a.avgPercent),
        }))
        .sort((a, b) => b.avgScore - a.avgScore)
        .slice(0, limit)
        .map((e, i) => ({ rank: i + 1, ...e }));

      return ok({
        total: entries.length,
        basedOnRuns: runs.length,
        note:
          entries.length === 0
            ? "还没有成功的评测记录，先调用 POST /api/v1/runs。"
            : null,
        leaderboard: entries,
      });
    },
  );
}

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return Math.round((arr.reduce((s, n) => s + n, 0) / arr.length) * 100) / 100;
}
