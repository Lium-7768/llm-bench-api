import { ok, preflight } from "@/lib/http";
import { ENGINE_VERSION } from "@/lib/scoring";
import { BANK_VERSION, QUESTIONS } from "@/lib/bank";
import { isPersistent, listRuns, storeBackend } from "@/lib/store";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET() {
  // 真实探测存储可用性，而不是无脑报 healthy
  const persistent = isPersistent();
  let storageOk = true;
  let storageError: string | null = null;
  try {
    await listRuns(1);
  } catch (e) {
    storageOk = false;
    storageError = (e as Error).message;
  }

  return ok(
    {
      status: storageOk ? "healthy" : "degraded",
      time: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      runtime: `node ${process.version}`,
      engineVersion: ENGINE_VERSION,
      bankVersion: BANK_VERSION,
      totalQuestions: QUESTIONS.length,
      storage: {
        backend: storeBackend(),
        persistent,
        ok: storageOk,
        error: storageError,
        note: !storageOk
          ? "存储不可用：评测结果无法保存或读取。请检查 Redis 配置。"
          : persistent
            ? "已启用 Redis 持久化，记录不会因冷启动丢失。"
            : "使用进程内存，Serverless 冷启动会清空记录。配置 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 即可持久化。",
      },
    },
    { status: storageOk ? 200 : 503 },
  );
}
