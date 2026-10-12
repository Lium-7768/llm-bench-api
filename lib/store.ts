import type { FingerprintResult, Run } from "./types";

/**
 * 极简内存存储。
 * 注意：Vercel 的 Serverless 实例是无状态的，冷启动会丢失。
 * 生产环境请把这里换成 Vercel KV / Postgres / Upstash，接口保持一致即可。
 */
declare global {
  // eslint-disable-next-line no-var
  var __BENCH_RUNS__: Map<string, Run> | undefined;
  // eslint-disable-next-line no-var
  var __BENCH_FP__: Map<string, FingerprintResult> | undefined;
}

const runs: Map<string, Run> =
  globalThis.__BENCH_RUNS__ ?? (globalThis.__BENCH_RUNS__ = new Map());
const fingerprints: Map<string, FingerprintResult> =
  globalThis.__BENCH_FP__ ?? (globalThis.__BENCH_FP__ = new Map());

/** 最多保留的历史记录条数，防止内存无限增长 */
const MAX_RUNS = 200;

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function saveRun(run: Run): Run {
  runs.set(run.id, run);
  if (runs.size > MAX_RUNS) {
    const oldest = [...runs.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, runs.size - MAX_RUNS);
    for (const r of oldest) runs.delete(r.id);
  }
  return run;
}

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

export function listRuns(limit = 50): Run[] {
  return [...runs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function deleteRun(id: string): boolean {
  return runs.delete(id);
}

export function saveFingerprint(id: string, result: FingerprintResult): void {
  fingerprints.set(id, result);
}

export function getFingerprint(id: string): FingerprintResult | undefined {
  return fingerprints.get(id);
}
