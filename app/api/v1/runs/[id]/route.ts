import { fail, ok, preflight, withStore } from "@/lib/http";
import { deleteRun, getRun } from "@/lib/store";
import { summarizeRun } from "@/lib/runner";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function OPTIONS() {
  return preflight();
}

/** GET /api/v1/runs/{id} —— 含完整作答明细 */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withStore(
    () => getRun(id),
    (run) => {
      if (!run) return fail(`未找到评测记录: ${id}`, 404, "not_found");
      return ok({
        ...summarizeRun(run),
        error: run.error ?? null,
        meta: run.meta,
        questionIds: run.questionIds,
        answers: run.answers,
      });
    },
  );
}

/** DELETE /api/v1/runs/{id} */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withStore(
    () => deleteRun(id),
    (existed) =>
      existed
        ? ok({ id, deleted: true })
        : fail(`未找到评测记录: ${id}`, 404, "not_found"),
  );
}
