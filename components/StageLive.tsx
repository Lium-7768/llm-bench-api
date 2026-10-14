"use client";

import { Check, LoaderCircle, Minus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { StagePlan } from "@/lib/check";
import type { AnswerResult, CheckResult, PelicanResult } from "@/lib/types";
import { STATUS_LABEL, formatMs } from "@/lib/web/format";
import { PelicanImage, SvgBadges } from "./Report";
import { STAGE_INFO } from "./StageIcon";
import { Pill, cx } from "./ui";

export interface LiveData {
  answers: Record<string, AnswerResult>;
  checks: Record<string, CheckResult>;
  pelican?: PelicanResult;
}

/** 当前步骤的实时详情：每一步有自己的动画 */
export function StageLive({ plan, live, elapsed }: { plan: StagePlan; live: LiveData; elapsed: number }) {
  const info = STAGE_INFO[plan.id];
  const done =
    plan.id === "detect"
      ? plan.items.filter((i) => live.checks[i.id]).length
      : plan.id === "pelican"
        ? live.pelican
          ? 1
          : 0
        : plan.items.filter((i) => live.answers[i.id]).length;

  return (
    <motion.div
      key={plan.id}
      initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -16, filter: "blur(8px)" }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
      className="flex flex-col gap-5"
    >
      <header className="flex flex-wrap items-center gap-4">
        <span className="grid size-11 place-items-center rounded-2xl" style={{ background: `${info.hex}14` }}>
          <info.Icon size={22} className={info.color} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold">{info.name}</h2>
          <p className="text-sm text-readout">{info.desc}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-semibold tabular-nums">
            {done}
            <span className="text-faint">/{plan.total}</span>
          </p>
          <p className="text-xs text-faint tabular-nums">{(elapsed / 1000).toFixed(1)}s</p>
        </div>
      </header>

      <FlowBar value={plan.total ? done / plan.total : 0} color={info.hex} />

      {plan.id === "detect" && <DetectLive plan={plan} checks={live.checks} />}
      {(plan.id === "basic" || plan.id === "candy" || plan.id === "inference") && (
        <AnswersLive plan={plan} answers={live.answers} />
      )}
      {plan.id === "pelican" && <PelicanLive result={live.pelican} />}
    </motion.div>
  );
}

/** 流光进度条：步内进度 */
export function FlowBar({ value, color, tall }: { value: number; color?: string; tall?: boolean }) {
  return (
    <div className={cx("relative overflow-hidden rounded-full bg-tint-2", tall ? "h-2" : "h-1.5")}>
      <motion.div
        className="relative h-full animate-flow overflow-hidden rounded-full spectrum-bg"
        style={color ? { boxShadow: `0 0 12px ${color}66` } : undefined}
        initial={false}
        animate={{ width: `${Math.max(3, value * 100)}%` }}
        transition={{ type: "spring", stiffness: 70, damping: 20 }}
      >
        <span className="absolute inset-0 animate-sweep bg-gradient-to-r from-transparent via-white/80 to-transparent" />
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------- 指纹检测：八项依次点亮

function DetectLive({ plan, checks }: { plan: StagePlan; checks: Record<string, CheckResult> }) {
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {plan.items.map((item, i) => {
        const c = checks[item.id];
        return (
          <motion.li
            key={item.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className={cx(
              "relative flex items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 transition-colors duration-500",
              c ? "border-line bg-surface" : "border-dashed border-tint-2 bg-paper",
            )}
          >
            {!c && <Shimmer />}
            <StatusDot status={c?.status} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{item.label}</p>
              <AnimatePresence>
                {c && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="truncate text-xs text-readout"
                    title={c.detail}
                  >
                    {c.detail}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
            <AnimatePresence>
              {c && (
                <motion.span
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 420, damping: 16 }}
                >
                  <Pill
                    tone={
                      c.status === "pass"
                        ? "pass"
                        : c.status === "warn"
                          ? "warn"
                          : c.status === "fail"
                            ? "fail"
                            : "muted"
                    }
                  >
                    {STATUS_LABEL[c.status]}
                  </Pill>
                </motion.span>
              )}
            </AnimatePresence>
          </motion.li>
        );
      })}
    </ul>
  );
}

function StatusDot({ status }: { status?: CheckResult["status"] }) {
  if (!status) return <LoaderCircle size={18} className="shrink-0 animate-spin text-faint" />;
  const map = {
    pass: ["bg-mint", <Check key="i" size={12} strokeWidth={3.5} />],
    warn: ["bg-amber", <Minus key="i" size={12} strokeWidth={3.5} />],
    fail: ["bg-rose", <X key="i" size={12} strokeWidth={3.5} />],
    unsupported: ["bg-faint", <Minus key="i" size={12} strokeWidth={3.5} />],
    error: ["bg-faint", <X key="i" size={12} strokeWidth={3.5} />],
  } as const;
  const [bg, icon] = map[status];
  return (
    <motion.span
      initial={{ scale: 0, rotate: -120 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 15 }}
      className={cx("grid size-[18px] shrink-0 place-items-center rounded-full text-white", bg)}
    >
      {icon}
    </motion.span>
  );
}

// ---------------------------------------------------------------- 基础 / 糖果：题目格子 + 最新作答滚入

function AnswersLive({ plan, answers }: { plan: StagePlan; answers: Record<string, AnswerResult> }) {
  const order = new Map(plan.items.map((i, idx) => [i.id, idx]));
  const recent = Object.values(answers)
    .sort((a, b) => (order.get(b.questionId) ?? 0) - (order.get(a.questionId) ?? 0))
    .slice(0, 6);
  const scored = Object.values(answers).filter((a) => !a.errored);
  const passed = scored.filter((a) => a.passed).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-6 gap-2">
          {plan.items.map((item) => {
            const a = answers[item.id];
            return (
              <div
                key={item.id}
                className="relative aspect-square overflow-hidden rounded-lg bg-tint"
                title={item.label}
              >
                {!a && <Shimmer />}
                <AnimatePresence>
                  {a && (
                    <motion.div
                      initial={{ scale: 0, borderRadius: "50%" }}
                      animate={{ scale: 1, borderRadius: "8px" }}
                      transition={{ type: "spring", stiffness: 380, damping: 18 }}
                      className={cx(
                        "absolute inset-0 grid place-items-center text-white",
                        a.errored
                          ? "bg-faint"
                          : a.passed
                            ? "bg-gradient-to-br from-blue to-cyan"
                            : "bg-gradient-to-br from-rose to-amber",
                      )}
                    >
                      {a.errored ? (
                        <Minus size={14} />
                      ) : a.passed ? (
                        <Check size={14} strokeWidth={3} />
                      ) : (
                        <X size={14} strokeWidth={3} />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
        <p className="text-sm text-readout">
          已通过 <span className="font-display font-semibold text-ink tabular-nums">{passed}</span> 题
          {scored.length > 0 && `，通过率 ${Math.round((passed / scored.length) * 100)}%`}
        </p>
      </div>

      <ul className="relative flex min-h-64 flex-col gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {recent.map((a) => (
            <motion.li
              key={a.questionId}
              layout
              initial={{ opacity: 0, y: -24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-[0_6px_20px_-14px_rgb(37_99_235/0.4)]"
            >
              <Pill tone={a.errored ? "muted" : a.passed ? "pass" : "fail"}>
                {a.errored ? "失败" : a.passed ? "通过" : "答错"}
              </Pill>
              <span className="min-w-0 flex-1 truncate text-sm">{a.prompt}</span>
              <span className="text-xs text-faint tabular-nums">{a.latencyMs ? formatMs(a.latencyMs) : ""}</span>
            </motion.li>
          ))}
        </AnimatePresence>
        {recent.length === 0 && (
          <li className="flex flex-1 items-center justify-center gap-2 text-sm text-faint">
            <LoaderCircle size={16} className="animate-spin" /> 题目已发出，等待第一份回答
          </li>
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- 鹈鹕：扫描线 → 成图显影

function PelicanLive({ result }: { result?: PelicanResult }) {
  return (
    <div className="relative mx-auto grid aspect-[4/3] w-full max-w-md place-items-center overflow-hidden rounded-3xl border border-line bg-paper">
      <AnimatePresence mode="wait">
        {result ? (
          <motion.div
            key="img"
            className="size-full"
            initial={{ opacity: 0, scale: 1.08, filter: "blur(16px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.9 }}
          >
            <PelicanImage svg={result.svg} />
            <span className="absolute top-3 left-3">
              <SvgBadges result={result} />
            </span>
          </motion.div>
        ) : (
          <motion.div key="scan" className="absolute inset-0" exit={{ opacity: 0 }}>
            <span className="scanline absolute inset-0" />
            <div className="absolute inset-0 grid place-items-center">
              <motion.p
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.8, repeat: Infinity }}
                className="text-sm text-readout"
              >
                模型正在作画
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 等待中的占位：一道光扫过 */
function Shimmer() {
  return (
    <span className="absolute inset-0 animate-sweep bg-gradient-to-r from-transparent via-white/70 to-transparent" />
  );
}
