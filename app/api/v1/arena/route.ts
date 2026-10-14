import { ARENA_LANGUAGES, TIERS } from "@/lib/arena/meta";
import { runTier } from "@/lib/arena/run";
import { fail, preflight, readJson, readTarget, sse, type TargetBody } from "@/lib/http";
import { sign, stampsEnabled, verify } from "@/lib/stamp";
import type { ArenaLanguage, ArenaTier } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function OPTIONS() {
  return preflight();
}

interface ArenaBody extends TargetBody {
  /** /api/v1/unlock 发的解锁令牌 */
  token?: string;
  language?: string;
  tier?: string;
  /** 上一档通过时 result 事件里的 stamp；青铜不需要 */
  prev?: string;
}

/**
 * POST /api/v1/arena —— 编程段位赛，每次跑一档，以 SSE 推送进度。不在文档里公开。
 * 要解锁令牌；青铜以上还要上一档通过的凭证，同一种语言，不能跳档。
 */
export async function POST(req: Request) {
  if (!stampsEnabled()) return fail("这里什么都没有", 404, "not_found");
  const body = await readJson<ArenaBody>(req);
  if (body instanceof Response) return body;
  const target = readTarget(req, body);
  if (target instanceof Response) return target;

  if (!verify(body.token, "unlock", target)) return fail("这里什么都没有", 403, "locked");
  const language = body.language as ArenaLanguage;
  const tier = body.tier as ArenaTier;
  if (!ARENA_LANGUAGES.includes(language)) return fail(`language 只能是 ${ARENA_LANGUAGES.join(" / ")}`);
  const index = TIERS.indexOf(tier);
  if (index < 0) return fail(`tier 只能是 ${TIERS.join(" / ")}`);
  if (index > 0) {
    const prev = verify<{ i: number; l: string }>(body.prev, "tier", target);
    if (!prev || prev.i !== index - 1 || prev.l !== language) return fail("要先通过上一档", 403, "locked");
  }

  return sse(withStamp(runTier({ target, language, tier, signal: req.signal }), index, language, target));
}

/** 通过这一档时，在 result 事件里附上进入下一档的凭证 */
async function* withStamp(
  events: ReturnType<typeof runTier>,
  index: number,
  language: ArenaLanguage,
  target: Parameters<typeof sign>[1],
) {
  for await (const e of events) {
    if (e.type === "result" && e.result.passed)
      yield { ...e, stamp: sign("tier", target, 3600, { i: index, l: language }) };
    else yield e;
  }
}
