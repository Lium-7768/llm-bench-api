import { fail, ok, preflight, readJson, readTarget, type TargetBody } from "@/lib/http";
import { sign, stampsEnabled, verify } from "@/lib/stamp";
import type { Stage } from "@/lib/types";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

interface UnlockBody extends TargetBody {
  /** 各步骤 stage.done 事件里的 stamp */
  stamps?: unknown[];
}

/**
 * POST /api/v1/unlock —— 编程彩蛋的入口。不在文档里公开。
 * 交上同一个接口和模型的五步凭证：五步都跑完、计分步骤都有分、糖果测试全对，换一张 1 小时有效的解锁令牌。
 */
export async function POST(req: Request) {
  if (!stampsEnabled()) return fail("这里什么都没有", 404, "not_found");
  const body = await readJson<UnlockBody>(req);
  if (body instanceof Response) return body;
  const target = readTarget(req, body);
  if (target instanceof Response) return target;

  const got = new Map<Stage, number | null>();
  for (const token of (body.stamps ?? []).slice(0, 20)) {
    const p = verify<{ s: Stage; v: number | null }>(token, "stage", target);
    if (p) got.set(p.s, p.v);
  }
  const scored = (s: Stage) => got.has(s) && got.get(s) !== null;
  const qualified =
    scored("detect") && scored("basic") && scored("inference") && got.has("pelican") && got.get("candy") === 100;
  if (!qualified) return fail("条件未满足", 403, "locked");

  // 存进报告里长期使用：30 天内从历史记录打开这份报告都能进入
  const ttl = 30 * 24 * 3600;
  return ok({
    token: sign("unlock", target, ttl, {}),
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  });
}
