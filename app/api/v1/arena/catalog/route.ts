import { catalogOf } from "@/lib/arena/run";
import { fail, ok, preflight, readJson, readTarget, type TargetBody } from "@/lib/http";
import { stampsEnabled, verify } from "@/lib/stamp";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** POST /api/v1/arena/catalog —— 两条赛道的题目目录（标题和标签，不含题面）。同样要解锁令牌 */
export async function POST(req: Request) {
  if (!stampsEnabled()) return fail("这里什么都没有", 404, "not_found");
  const body = await readJson<TargetBody & { token?: string }>(req);
  if (body instanceof Response) return body;
  const target = readTarget(req, body);
  if (target instanceof Response) return target;
  if (!verify(body.token, "unlock", target)) return fail("这里什么都没有", 403, "locked");
  return ok({ algo: catalogOf("algo"), frontend: catalogOf("frontend") });
}
