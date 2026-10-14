import { ARENA_LANGUAGES } from "@/lib/arena/meta";
import { catalogOf, MAX_PER_RUN, runProblems } from "@/lib/arena/run";
import { fail, preflight, readJson, readTarget, sse, type TargetBody } from "@/lib/http";
import { stampsEnabled, verify } from "@/lib/stamp";
import type { ArenaLanguage, ArenaTrack } from "@/lib/types";

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
  /** 要跑的题目 id，最多 3 道，见 /api/v1/arena/catalog */
  problems?: unknown;
}

/**
 * POST /api/v1/arena —— 编程段位赛：跑指定的几道题，以 SSE 推送进度。不在文档里公开。
 * 要解锁令牌。题目任选，网页按档位从低到高分批请求，每批最多 3 道（共用一次函数时限）。
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
  if (!ARENA_LANGUAGES.includes(language)) return fail(`language 只能是 ${ARENA_LANGUAGES.join(" / ")}`);

  const known = new Set(catalogOf(track).map((p) => p.id));
  const ids = Array.isArray(body.problems) ? [...new Set(body.problems)] : [];
  if (!ids.length || ids.length > MAX_PER_RUN || !ids.every((id) => typeof id === "string" && known.has(id))) {
    return fail(`problems 要给 1 到 ${MAX_PER_RUN} 道这条赛道里的题目 id`);
  }

  return sse(runProblems({ target, track, language, ids: ids as string[], signal: req.signal }));
}
