import type { FingerprintResult, Run } from "./types";

/**
 * 存储层。
 *
 * 两种后端，自动选择：
 * 1. 未配置 Redis  → 进程内存（零配置，适合本地开发；Serverless 冷启动会丢）
 * 2. 配置了 Redis  → Upstash Redis REST（生产推荐，数据持久）
 *
 * 启用持久化只需在 Vercel 项目里设置两个环境变量：
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 * （在 Vercel 控制台 Integrations 里一键接入 Upstash 即可自动注入）
 *
 * 对外函数签名与之前完全一致，调用方无需改动。
 */

declare global {
  // eslint-disable-next-line no-var
  var __BENCH_RUNS__: Map<string, Run> | undefined;
  // eslint-disable-next-line no-var
  var __BENCH_FP__: Map<string, FingerprintResult> | undefined;
}

const memoryRuns: Map<string, Run> =
  globalThis.__BENCH_RUNS__ ?? (globalThis.__BENCH_RUNS__ = new Map());
const memoryFingerprints: Map<string, FingerprintResult> =
  globalThis.__BENCH_FP__ ?? (globalThis.__BENCH_FP__ = new Map());

/** 内存模式下的最大保留条数，防止无限增长 */
const MAX_RUNS = 200;
/** Redis 模式下的键前缀与过期时间 */
const RUN_PREFIX = "bench:run:";
const FP_PREFIX = "bench:fp:";
const RUN_INDEX = "bench:runs:index";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 天

// ---------------------------------------------------------------- Redis 客户端

interface RedisConfig {
  url: string;
  token: string;
}

function redisConfig(): RedisConfig | undefined {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return undefined;
  return { url: url.replace(/\/+$/, ""), token };
}

/** 是否已启用持久化存储 */
export function isPersistent(): boolean {
  return redisConfig() !== undefined;
}

export function storeBackend(): "redis" | "memory" {
  return isPersistent() ? "redis" : "memory";
}

/** 执行一条 Redis 命令（Upstash REST 协议） */
async function redisCommand<T = unknown>(command: unknown[]): Promise<T> {
  const cfg = redisConfig();
  if (!cfg) throw new Error("Redis 未配置");

  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Redis ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { result?: T; error?: string };
  if (json.error) throw new Error(`Redis error: ${json.error}`);
  return json.result as T;
}

// ---------------------------------------------------------------- 公共接口

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export async function saveRun(run: Run): Promise<Run> {
  if (!isPersistent()) {
    memoryRuns.set(run.id, run);
    if (memoryRuns.size > MAX_RUNS) {
      const oldest = [...memoryRuns.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, memoryRuns.size - MAX_RUNS);
      for (const r of oldest) memoryRuns.delete(r.id);
    }
    return run;
  }

  await redisCommand([
    "SET",
    RUN_PREFIX + run.id,
    JSON.stringify(run),
    "EX",
    String(TTL_SECONDS),
  ]);
  // 维护一个按时间排序的索引（score = 创建时间戳）
  await redisCommand([
    "ZADD",
    RUN_INDEX,
    String(new Date(run.createdAt).getTime()),
    run.id,
  ]);
  // 只保留最近 MAX_RUNS 条索引，避免无限增长
  await redisCommand(["ZREMRANGEBYRANK", RUN_INDEX, "0", String(-MAX_RUNS - 1)]);
  return run;
}

export async function getRun(id: string): Promise<Run | undefined> {
  if (!isPersistent()) return memoryRuns.get(id);

  const raw = await redisCommand<string | null>(["GET", RUN_PREFIX + id]);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Run;
  } catch {
    return undefined;
  }
}

export async function listRuns(limit = 50): Promise<Run[]> {
  if (!isPersistent()) {
    return [...memoryRuns.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  // 索引按时间倒序取最近 limit 个 id
  const ids = await redisCommand<string[]>([
    "ZREVRANGE",
    RUN_INDEX,
    "0",
    String(Math.max(0, limit - 1)),
  ]);
  if (!ids?.length) return [];

  const raws = await redisCommand<(string | null)[]>([
    "MGET",
    ...ids.map((id) => RUN_PREFIX + id),
  ]);

  return (raws ?? [])
    .map((raw) => {
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as Run;
      } catch {
        return undefined;
      }
    })
    .filter((r): r is Run => r !== undefined);
}

export async function deleteRun(id: string): Promise<boolean> {
  if (!isPersistent()) return memoryRuns.delete(id);

  const existed = await redisCommand<number>(["EXISTS", RUN_PREFIX + id]);
  await redisCommand(["DEL", RUN_PREFIX + id]);
  await redisCommand(["ZREM", RUN_INDEX, id]);
  return existed === 1;
}

export async function saveFingerprint(
  id: string,
  result: FingerprintResult,
): Promise<void> {
  if (!isPersistent()) {
    memoryFingerprints.set(id, result);
    return;
  }
  await redisCommand([
    "SET",
    FP_PREFIX + id,
    JSON.stringify(result),
    "EX",
    String(TTL_SECONDS),
  ]);
}

export async function getFingerprint(
  id: string,
): Promise<FingerprintResult | undefined> {
  if (!isPersistent()) return memoryFingerprints.get(id);

  const raw = await redisCommand<string | null>(["GET", FP_PREFIX + id]);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as FingerprintResult;
  } catch {
    return undefined;
  }
}
