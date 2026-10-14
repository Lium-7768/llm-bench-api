"use client";

import { Check, Dices, Play, RotateCcw, Timer, X } from "lucide-react";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { IconButton, Modal, Panel, Pill, cx } from "@/components/ui";
import type { ArenaEvent } from "@/lib/arena/run";
import { ARENA_LANGUAGES, LANGUAGE_LABEL, PASS_PER_TIER, TIERS, TIER_LABEL, VERDICT_LABEL } from "@/lib/arena/meta";
import type { ArenaLanguage, ArenaResult, ArenaTier, ProblemResult, TierResult } from "@/lib/types";
import { streamApi } from "@/lib/web/api";
import { useConfig } from "@/lib/web/config";
import { useEgg } from "@/lib/web/egg";
import { formatMs } from "@/lib/web/format";
import { patchHistory } from "@/lib/web/storage";

/** 每档的颜色：只有王者用光谱 */
const TIER_STYLE: Record<ArenaTier, { cap: string; text: string }> = {
  bronze: { cap: "bg-bronze", text: "text-bronze" },
  silver: { cap: "bg-silver", text: "text-silver" },
  gold: { cap: "bg-gold", text: "text-gold" },
  platinum: { cap: "bg-cyan", text: "text-cyan" },
  diamond: { cap: "bg-blue", text: "text-blue" },
  king: { cap: "spectrum-bg", text: "text-violet" },
};

/** 台阶从左到右一级比一级高（类名要写全，Tailwind 才能扫描到） */
const STEP_HEIGHT = [
  "lg:min-h-[13rem]",
  "lg:min-h-[15.5rem]",
  "lg:min-h-[18rem]",
  "lg:min-h-[20.5rem]",
  "lg:min-h-[23rem]",
  "lg:min-h-[25.5rem]",
];

type ProblemState = { id: string; title: string; tags: string[]; phase: "writing" | "judging" | "done" } & Partial<
  Pick<
    ProblemResult,
    "verdict" | "passedTests" | "totalTests" | "failedTest" | "detail" | "code" | "latencyMs" | "slowestMs"
  >
>;

interface TierState {
  status: "pending" | "active" | "passed" | "failed" | "error";
  problems: ProblemState[];
  result?: TierResult;
}

const EMPTY: Record<ArenaTier, TierState> = Object.fromEntries(
  TIERS.map((t) => [t, { status: "pending", problems: [] }]),
) as unknown as Record<ArenaTier, TierState>;

const VERDICT_TONE = (v?: ProblemResult["verdict"]) =>
  v === "accepted" ? "pass" : v === "error" ? "muted" : v === "time_limit" ? "warn" : "fail";

export default function ArenaPage() {
  const egg = useEgg();
  const { config } = useConfig();
  const [language, setLanguage] = useState<ArenaLanguage>("python");
  const [tiers, setTiers] = useState(EMPTY);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ProblemState | null>(null);
  const prev = useRef<string | undefined>(undefined);
  const results = useRef<TierResult[]>([]);
  const startedAt = useRef("");

  // 首帧还没读到 sessionStorage：先空着，避免闪一下「什么都没有」
  if (egg === undefined) return null;
  if (!egg || egg.model !== config.model) {
    return <p className="py-40 text-center text-readout">这里什么都没有。</p>;
  }

  const patch = (tier: ArenaTier, fn: (s: TierState) => TierState) =>
    setTiers((all) => ({ ...all, [tier]: fn(all[tier]) }));

  const handle = (tier: ArenaTier, e: ArenaEvent & { stamp?: string }) => {
    switch (e.type) {
      case "start":
        return patch(tier, () => ({ status: "active", problems: e.problems.map((p) => ({ ...p, phase: "writing" })) }));
      case "problem.code":
        return patch(tier, (s) => ({
          ...s,
          problems: s.problems.map((p) => (p.id === e.id ? { ...p, phase: "judging", code: e.code } : p)),
        }));
      case "problem.done":
        return patch(tier, (s) => ({
          ...s,
          problems: s.problems.map((p) => (p.id === e.result.id ? { ...p, ...e.result, phase: "done" } : p)),
        }));
      case "result":
        if (e.stamp) prev.current = e.stamp;
        return patch(tier, (s) => ({
          ...s,
          result: e.result,
          status: e.result.passed ? "passed" : e.result.error ? "error" : "failed",
        }));
    }
  };

  /** 从某一档开始往上打，没过就停；调用失败的那一档可以重试 */
  const climb = async (from: number) => {
    setPhase("running");
    setError(null);
    for (let i = from; i < TIERS.length; i++) {
      const tier = TIERS[i];
      let result: TierResult | undefined;
      try {
        await streamApi<ArenaEvent & { stamp?: string }>(
          "/api/v1/arena",
          config,
          { token: egg.token, language, tier, prev: i > 0 ? prev.current : undefined },
          (e) => {
            handle(tier, e);
            if (e.type === "result") result = e.result;
          },
        );
      } catch (e) {
        const message = e instanceof TypeError ? "和本站的连接中断了" : (e as Error).message;
        patch(tier, (s) => ({ ...s, status: "error" }));
        setError(`${TIER_LABEL[tier]}没有跑完：${message}`);
        setPhase("done");
        return;
      }
      if (!result) return setPhase("done");
      results.current = [...results.current.filter((r) => r.tier !== tier), result];
      if (result.error) {
        setError(`${TIER_LABEL[tier]}无法判定：${result.error}`);
        setPhase("done");
        return;
      }
      if (!result.passed) break;
    }
    finish();
  };

  const finish = () => {
    const passed = results.current.filter((r) => r.passed);
    const arena: ArenaResult = {
      language,
      rank: passed.length ? passed[passed.length - 1].tier : null,
      tiers: results.current,
      startedAt: startedAt.current,
    };
    patchHistory(egg.reportId, { arena });
    setPhase("done");
  };

  const start = () => {
    prev.current = undefined;
    results.current = [];
    startedAt.current = new Date().toISOString();
    setTiers(EMPTY);
    climb(0);
  };

  const retryFrom = TIERS.findIndex((t) => tiers[t].status === "error");
  const reached = [...TIERS].reverse().find((t) => tiers[t].status === "passed");
  const finished = phase === "done" && retryFrom < 0 && TIERS.some((t) => tiers[t].result);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <h1 className="font-display text-3xl font-bold">编程段位赛</h1>
          <p className="mt-2 text-sm text-readout">
            {egg.model} 从青铜打到王者。每档 3 道题，模型写完整程序，交给开源判题服务 Judge0
            跑隐藏测试，全部通过才算答对，答对 {PASS_PER_TIER} 题晋级。段位不计入综合分。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="编程语言" className="flex rounded-xl border border-line bg-surface p-1">
            {ARENA_LANGUAGES.map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={language === l}
                disabled={phase !== "idle"}
                onClick={() => setLanguage(l)}
                className={cx(
                  "rounded-lg px-3 py-1.5 text-sm transition disabled:cursor-not-allowed",
                  language === l ? "bg-ink font-semibold text-surface" : "text-readout enabled:hover:text-ink",
                )}
              >
                {LANGUAGE_LABEL[l]}
              </button>
            ))}
          </div>
          <IconButton
            label="随机选一种语言"
            icon={<Dices size={18} />}
            disabled={phase !== "idle"}
            onClick={() => setLanguage(ARENA_LANGUAGES[Math.floor(Math.random() * ARENA_LANGUAGES.length)])}
          />
          {phase === "idle" ? (
            <IconButton label="开始挑战" icon={<Play size={18} />} onClick={start} />
          ) : (
            <IconButton
              label={retryFrom >= 0 ? `从${TIER_LABEL[TIERS[retryFrom]]}重试` : "换个语言重来"}
              icon={<RotateCcw size={18} />}
              disabled={phase === "running"}
              onClick={() => (retryFrom >= 0 ? climb(retryFrom) : (setTiers(EMPTY), setPhase("idle")))}
            />
          )}
        </div>
      </header>

      {error && <p className="rounded-xl bg-rose/8 px-4 py-3 text-sm text-rose">{error}</p>}

      {finished && (
        <motion.p
          initial={{ opacity: 0, filter: "blur(10px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.7 }}
          className="font-display text-4xl font-bold sm:text-5xl"
        >
          {reached ? (
            <>
              <span className={TIER_STYLE[reached].text}>{TIER_LABEL[reached]}</span>
              <span className="ml-4 align-middle text-base font-normal text-readout">{LANGUAGE_LABEL[language]}</span>
            </>
          ) : (
            <span className="text-readout">没能入段</span>
          )}
        </motion.p>
      )}

      {/* 台阶：宽屏六列一级比一级高，窄屏竖排 */}
      <ol className="grid gap-2.5 lg:grid-cols-6 lg:items-end">
        {TIERS.map((tier, i) => {
          const s = tiers[tier];
          const lit = s.status !== "pending";
          return (
            <li key={tier} className={cx("flex flex-col", STEP_HEIGHT[i])}>
              <Panel
                className={cx(
                  "flex flex-1 flex-col overflow-hidden rounded-2xl transition-opacity lg:rounded-b-none",
                  !lit && "opacity-55",
                )}
              >
                <div className={cx("h-1.5", lit ? TIER_STYLE[tier].cap : "bg-line")} />
                <div className="flex items-baseline justify-between gap-2 px-3.5 pt-3.5 pb-3">
                  <h2 className={cx("font-display text-lg font-semibold", lit ? TIER_STYLE[tier].text : "text-faint")}>
                    {TIER_LABEL[tier]}
                  </h2>
                  <span className="text-xs text-readout">
                    {
                      {
                        pending: "未开始",
                        active: "挑战中",
                        passed: "晋级",
                        failed: "止步",
                        error: "待重试",
                      }[s.status]
                    }
                  </span>
                </div>
                <ul className="mt-auto flex flex-col gap-0.5 px-1.5 pb-1.5">
                  {s.problems.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={!p.code && p.phase !== "done"}
                        onClick={() => setOpen(p)}
                        aria-label={`${p.title}：${p.phase === "done" ? VERDICT_LABEL[p.verdict!] : p.phase === "writing" ? "写代码中" : "判题中"}`}
                        className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition enabled:hover:bg-tint"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.title}</span>
                          <span className="block truncate text-xs text-faint">{p.tags.join("、")}</span>
                        </span>
                        {p.phase === "done" ? (
                          <VerdictMark verdict={p.verdict!} />
                        ) : (
                          <span
                            title={p.phase === "writing" ? "写代码中" : "判题中"}
                            className={cx(
                              "size-2 shrink-0 rounded-full motion-safe:animate-pulse",
                              p.phase === "writing" ? "bg-violet" : "bg-cyan",
                            )}
                          />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </Panel>
            </li>
          );
        })}
      </ol>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ""} wide>
        {open && (
          <div className="flex flex-col gap-4">
            {open.phase === "done" && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Pill tone={VERDICT_TONE(open.verdict)}>{VERDICT_LABEL[open.verdict!]}</Pill>
                {open.verdict !== "error" && open.verdict !== "no_code" && (
                  <span className="text-readout">
                    通过 {open.passedTests}/{open.totalTests} 组测试
                    {!!open.passedTests && open.failedTest && `，第 ${open.failedTest} 组没通过`}
                  </span>
                )}
                {!!open.latencyMs && <span className="text-readout">作答用时 {formatMs(open.latencyMs)}</span>}
                {open.slowestMs !== undefined && (
                  <span className="text-readout">程序最慢一组 {formatMs(open.slowestMs)}</span>
                )}
              </div>
            )}
            {open.detail && (
              <pre className="max-h-48 overflow-auto rounded-xl bg-rose/6 p-3 font-mono text-xs whitespace-pre-wrap text-rose">
                {open.detail}
              </pre>
            )}
            {open.code && (
              <pre className="max-h-[55vh] overflow-auto rounded-xl bg-tint p-4 font-mono text-xs leading-relaxed [font-variant-ligatures:none]">
                {open.code}
              </pre>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

/** 台阶里每题的结论：窄列放不下文字，用图标，悬停和读屏给出文字 */
function VerdictMark({ verdict }: { verdict: ProblemResult["verdict"] }) {
  const Icon = verdict === "accepted" ? Check : verdict === "time_limit" ? Timer : X;
  return (
    <span
      title={VERDICT_LABEL[verdict]}
      className={cx(
        "grid size-5 shrink-0 place-items-center rounded-full",
        verdict === "accepted" && "bg-mint/12 text-mint",
        verdict === "time_limit" && "bg-amber/12 text-amber",
        verdict === "error" && "bg-tint text-readout",
        !["accepted", "time_limit", "error"].includes(verdict) && "bg-rose/12 text-rose",
      )}
    >
      <Icon size={12} strokeWidth={3} />
    </span>
  );
}
