import { ok, fail, preflight } from "@/lib/http";
import { ALL_CATEGORIES, BANK_VERSION, CATEGORY_LABELS, QUESTIONS } from "@/lib/bank";
import type { Category } from "@/lib/types";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * GET /api/v1/questions?category=reasoning&limit=5&difficulty=2&withAnswers=false
 * 默认不返回答案，防止刷分；传 withAnswers=true 才返回期望答案。
 */
export function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const limit = Number(url.searchParams.get("limit") ?? "0");
  const difficulty = url.searchParams.get("difficulty");
  const withAnswers = url.searchParams.get("withAnswers") === "true";

  if (category && !ALL_CATEGORIES.includes(category as Category)) {
    return fail(
      `未知 category: ${category}`,
      400,
      "invalid_category",
      { allowed: ALL_CATEGORIES },
    );
  }

  let items = QUESTIONS.slice();
  if (category) items = items.filter((q) => q.category === category);
  if (difficulty) items = items.filter((q) => q.difficulty === Number(difficulty));
  if (limit > 0) items = items.slice(0, limit);

  return ok({
    total: items.length,
    bankVersion: BANK_VERSION,
    questions: items.map((q) => ({
      id: q.id,
      category: q.category,
      categoryLabel: CATEGORY_LABELS[q.category],
      prompt: q.prompt,
      match: q.match,
      weight: q.weight,
      difficulty: q.difficulty,
      ...(withAnswers
        ? { expected: q.expected ?? null, accept: q.accept ?? [], rubric: q.rubric ?? null }
        : {}),
    })),
  });
}
