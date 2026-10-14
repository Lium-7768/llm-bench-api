import { ARENA_LANGUAGES, PASS_PER_TIER, TIERS } from "@/lib/arena/meta";
import { runTier } from "@/lib/arena/run";
import { fail, preflight, readJson, readTarget, sse, type TargetBody } from "@/lib/http";
import { sign, stampsEnabled, verify } from "@/lib/stamp";
import type { ArenaLanguage, ArenaTier, ArenaTrack, Target } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function OPTIONS() {
  return preflight();
}

interface ArenaBody extends TargetBody {
  /** /api/v1/unlock 发的解锁令牌 */
  token?: string;
  /** algo（默认）或 frontend */
  track?: string;
  /** 算法赛道的语言；前端赛道固定 javascript */
  language?: string;
  tier?: string;
  /** 上一档 result 事件里的 stamp；青铜不需要 */
  prev?: string;
  /** 前端赛道：上一档里浏览器判定通过的 UI 题 id */
  uiPassed?: unknown;
}

/** 凭证内容：i 档位序号，l 语言（前端赛道为 "frontend"）；前端赛道另有 ok（逻辑题通过数）和 ui（待浏览器判定的 UI 题） */
interface TierStamp {
  i: number;
  l: string;
  ok?: number;
  ui?: string[];
}

/**
 * POST /api/v1/arena —— 编程段位赛，每次跑一档，以 SSE 推送进度。不在文档里公开。
 * 要解锁令牌；青铜以上还要上一档的凭证，同一赛道、同一种语言，不能跳档。
 * 前端赛道的 UI 题在浏览器里判，进下一档时由浏览器报告哪些 UI 题通过了：这部分无法在服务端核实，见 AGENTS.md。
 */
export async function POST(req: Request) {
  if (!stampsEnabled()) return fail("这里什么都没有", 404, "not_found");
  const body = await readJson<ArenaBody>(req);
  if (body instanceof Response) return body;
  const target = readTarget(req, body);
  if (target instanceof Response) return target;

  if (!verify(body.token, "unlock", target)) return fail("这里什么都没有", 403, "locked");
  const track: ArenaTrack = body.track === "frontend" ? "frontend" : "algo";
  const language = (track === "frontend" ? "javascript" : body.language) as ArenaLanguage;
  const tier = body.tier as ArenaTier;
  if (!ARENA_LANGUAGES.includes(language)) return fail(`language 只能是 ${ARENA_LANGUAGES.join(" / ")}`);
  const index = TIERS.indexOf(tier);
  if (index < 0) return fail(`tier 只能是 ${TIERS.join(" / ")}`);
  const label = track === "frontend" ? "frontend" : language;
  if (index > 0) {
    const prev = verify<TierStamp>(body.prev, "tier", target);
    if (!prev || prev.i !== index - 1 || prev.l !== label) return fail("要先通过上一档", 403, "locked");
    if (track === "frontend") {
      const claimed = new Set(Array.isArray(body.uiPassed) ? body.uiPassed.filter((x) => typeof x === "string") : []);
      const ui = (prev.ui ?? []).filter((id) => claimed.has(id)).length;
      if ((prev.ok ?? 0) + ui < PASS_PER_TIER) return fail("要先通过上一档", 403, "locked");
    }
  }

  return sse(withStamp(runTier({ target, track, language, tier, signal: req.signal }), index, label, target));
}

/**
 * 在 result 事件里附上进入下一档的凭证。
 * 算法赛道只在通过时发；前端赛道是否通过要等浏览器判完 UI 题，所以没出错就发，带上逻辑题通过数和待判的 UI 题。
 */
async function* withStamp(events: ReturnType<typeof runTier>, index: number, label: string, target: Target) {
  for await (const e of events) {
    if (e.type !== "result") {
      yield e;
      continue;
    }
    const r = e.result;
    if (label === "frontend" && !r.error) {
      const ok = r.problems.filter((p) => p.verdict === "accepted").length;
      const ui = r.problems.filter((p) => p.verdict === "pending").map((p) => p.id);
      yield { ...e, stamp: sign("tier", target, 3600, { i: index, l: label, ok, ui }) };
    } else if (r.passed) yield { ...e, stamp: sign("tier", target, 3600, { i: index, l: label }) };
    else yield e;
  }
}
