import { ok, preflight } from "@/lib/http";
import { ENGINE_VERSION } from "@/lib/scoring";
import { BANK_VERSION, QUESTIONS } from "@/lib/bank";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export function GET() {
  return ok({
    status: "healthy",
    time: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    runtime: `node ${process.version}`,
    engineVersion: ENGINE_VERSION,
    bankVersion: BANK_VERSION,
    totalQuestions: QUESTIONS.length,
  });
}
