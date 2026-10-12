import { ok, preflight } from "@/lib/http";
import { ALL_CATEGORIES, CATEGORY_LABELS, QUESTIONS } from "@/lib/bank";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export function GET() {
  const data = ALL_CATEGORIES.map((c) => {
    const items = QUESTIONS.filter((q) => q.category === c);
    return {
      id: c,
      label: CATEGORY_LABELS[c],
      totalQuestions: items.length,
      maxScore: items.reduce((s, q) => s + q.weight, 0),
      difficulties: [...new Set(items.map((q) => q.difficulty))].sort(),
    };
  });
  return ok({ total: data.length, categories: data });
}
