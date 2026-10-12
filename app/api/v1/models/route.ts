import { fail, ok, preflight, readJson, readTarget, type TargetBody } from "@/lib/http";
import { listModels } from "@/lib/llm";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** POST /api/v1/models —— 列出被测接口可用的模型 */
export async function POST(req: Request) {
  const body = await readJson<TargetBody>(req);
  if (body instanceof Response) return body;
  const target = readTarget(req, body, { requireModel: false });
  if (target instanceof Response) return target;

  try {
    const models = await listModels(target);
    return ok({ protocol: target.protocol, total: models.length, models });
  } catch (e) {
    return fail((e as Error).message, 502, "upstream_error");
  }
}
