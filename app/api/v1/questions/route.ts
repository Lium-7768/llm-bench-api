import { ALL_CATEGORIES, BANK_VERSION, CATEGORY_LABELS, QUESTIONS } from "@/lib/bank";
import { fail, ok, preflight } from "@/lib/http";
import type { Category } from "@/lib/types";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** GET /api/v1/questions?category=reasoning&withAnswers=true */
export function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const withAnswers = url.searchParams.get("withAnswers") === "true";

  if (category && !ALL_CATEGORIES.includes(category as Category)) {
    return fail(`未知 category：${category}，可选 ${ALL_CATEGORIES.join(" / ")}`, 400, "invalid_category");
  }

  const items = category ? QUESTIONS.filter((q) => q.category === category) : QUESTIONS;
  return ok({
    bankVersion: BANK_VERSION,
    total: items.length,
    questions: items.map((q) => ({
      id: q.id,
      category: q.category,
      categoryLabel: CATEGORY_LABELS[q.category],
      prompt: q.prompt,
      match: q.match,
      weight: q.weight,
      difficulty: q.difficulty,
      ...(withAnswers ? { expected: q.expected ?? null, accept: q.accept ?? [] } : {}),
    })),
  });
}
