"use client";

import { AppWindow, Check, Code2, Dices, Play, RotateCcw, Timer, X } from "lucide-react";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { IconButton, Modal, Panel, Pill, cx } from "@/components/ui";
import { previewDoc, runUiTest, SANDBOX } from "@/lib/arena/frontend/sandbox";
import type { ArenaEvent } from "@/lib/arena/run";
import {
  ARENA_LANGUAGES,
  LANGUAGE_LABEL,
  PASS_PER_TIER,
  TIERS,
  TIER_LABEL,
  TRACK_LABEL,
  VERDICT_LABEL,
} from "@/lib/arena/meta";
import type { ArenaLanguage, ArenaResult, ArenaTier, ArenaTrack, ProblemResult, TierResult } from "@/lib/types";
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

/** writing 写代码；judging 服务端判题；browser 浏览器里跑页面测试；done 出结果 */
type Phase = "writing" | "judging" | "browser" | "done";

type ProblemState = { id: string; title: string; tags: string[]; phase: Phase } & Partial<
  Pick<
    ProblemResult,
    "kind" | "verdict" | "passedTests" | "totalTests" | "failedTest" | "detail" | "code" | "latencyMs" | "slowestMs"
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

const PHASE_LABEL: Record<Exclude<Phase, "done">, string> = {
  writing: "写代码中",
  judging: "判题中",
  browser: "浏览器里测试页面中",
};

const VERDICT_TONE = (v?: ProblemResult["verdict"]) =>
  v === "accepted" ? "pass" : v === "error" || v === "pending" ? "muted" : v === "time_limit" ? "warn" : "fail";

/** 把浏览器里的测试结果换成和服务端一样的 ProblemResult */
async function judgeInBrowser(base: ProblemResult, test: string, host: HTMLElement): Promise<ProblemResult> {
  const outcome = await runUiTest(base.code, test, host);
  if (outcome === "timeout") return { ...base, verdict: "time_limit", detail: "页面测试 20 秒内没有跑完" };
  const errors = outcome.errors.length ? `\n页面报错：${outcome.errors.join("；")}` : "";
  return {
    ...base,
    passedTests: outcome.passed,
    totalTests: outcome.total,
    verdict: outcome.failure ? "wrong_answer" : "accepted",
    failedTest: outcome.failure?.index,
    detail: outcome.failure
      ? `第 ${outcome.failure.index} 项「${outcome.failure.name}」：${outcome.failure.message}${errors}`
      : undefined,
  };
}

export default function ArenaPage() {
  const egg = useEgg();
  const { config } = useConfig();
  const [track, setTrack] = useState<ArenaTrack>("algo");
  const [language, setLanguage] = useState<ArenaLanguage>("python");
  const [tiers, setTiers] = useState(EMPTY);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ProblemState | null>(null);
  const [view, setView] = useState<"page" | "code">("page");
  const [live, setLive] = useState(0);
  const monitor = useRef<HTMLDivElement>(null);
  const prev = useRef<{ stamp?: string; uiPassed: string[] }>({ uiPassed: [] });
  const results = useRef<TierResult[]>([]);
  const startedAt = useRef("");

  // 首帧还没读到 sessionStorage：先空着，避免闪一下「什么都没有」
  if (egg === undefined) return null;
  if (!egg || egg.model !== config.model) {
    return <p className="py-40 text-center text-readout">这里什么都没有。</p>;
  }

  const lang: ArenaLanguage = track === "frontend" ? "javascript" : language;

  const patch = (tier: ArenaTier, fn: (s: TierState) => TierState) =>
    setTiers((all) => ({ ...all, [tier]: fn(all[tier]) }));
  const patchProblem = (tier: ArenaTier, id: string, change: Partial<ProblemState>) =>
    patch(tier, (s) => ({ ...s, problems: s.problems.map((p) => (p.id === id ? { ...p, ...change } : p)) }));

  /** 判题现场：每道 UI 题一个缩略窗口，测试跑完就移除 */
  const mountTile = (title: string) => {
    const tile = document.createElement("figure");
    tile.className = "flex w-64 shrink-0 flex-col gap-1.5";
    const box = document.createElement("div");
    box.className = "relative h-48 w-64 overflow-hidden rounded-xl border border-line bg-white";
    const caption = document.createElement("figcaption");
    caption.className = "truncate text-xs text-readout";
    caption.textContent = title;
    tile.append(box, caption);
    monitor.current!.appendChild(tile);
    setLive((n) => n + 1);
    return {
      box,
      remove: () => {
        tile.remove();
        setLive((n) => n - 1);
      },
    };
  };

  /** 从某一档开始往上打，没过就停；调用失败的那一档可以重试 */
  const climb = async (from: number) => {
    setPhase("running");
    setError(null);
    for (let i = from; i < TIERS.length; i++) {
      const tier = TIERS[i];
      let result: TierResult | undefined;
      let stamp: string | undefined;
      const titles = new Map<string, string>();
      const browser: Array<Promise<ProblemResult>> = [];
      try {
        await streamApi<ArenaEvent & { stamp?: string }>(
          "/api/v1/arena",
          config,
          {
            token: egg.token,
            track,
            language: lang,
            tier,
            ...(i > 0 && { prev: prev.current.stamp, uiPassed: prev.current.uiPassed }),
          },
          (e) => {
            switch (e.type) {
              case "start":
                e.problems.forEach((p) => titles.set(p.id, p.title));
                return patch(tier, () => ({
                  status: "active",
                  problems: e.problems.map((p) => ({ ...p, phase: "writing" })),
                }));
              case "problem.code":
                return patchProblem(tier, e.id, { phase: "judging", code: e.code });
              case "problem.ui": {
                patchProblem(tier, e.id, { phase: "browser", code: e.html, kind: "ui" });
                const tile = mountTile(titles.get(e.id) ?? e.id);
                const base: ProblemResult = {
                  id: e.id,
                  title: titles.get(e.id) ?? e.id,
                  kind: "ui",
                  verdict: "pending",
                  passedTests: 0,
                  totalTests: 0,
                  code: e.html,
                  latencyMs: 0,
                };
                browser.push(
                  judgeInBrowser(base, e.test, tile.box)
                    .then((r) => {
                      patchProblem(tier, r.id, { ...r, phase: "done" });
                      return r;
                    })
                    .finally(tile.remove),
                );
                return;
              }
              case "problem.done":
                // UI 题服务端返回 pending，等浏览器的结果；只记下作答用时
                if (e.result.verdict === "pending")
                  return patchProblem(tier, e.result.id, { latencyMs: e.result.latencyMs });
                return patchProblem(tier, e.result.id, { ...e.result, phase: "done" });
              case "result":
                result = e.result;
                stamp = e.stamp;
            }
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

      // 前端赛道：合并浏览器判出的 UI 题结果，再算这一档过没过
      const judged = await Promise.all(browser);
      if (judged.length) {
        const problems = result.problems.map((p) => {
          const r = judged.find((j) => j.id === p.id);
          return r ? { ...r, latencyMs: p.latencyMs, usage: p.usage } : p;
        });
        const accepted = problems.filter((p) => p.verdict === "accepted").length;
        const errored = problems.filter((p) => p.verdict === "error");
        const passed = accepted >= PASS_PER_TIER;
        const undecided = !passed && accepted + errored.length >= PASS_PER_TIER;
        result = {
          ...result,
          problems,
          passed,
          error: undecided ? (errored[0].detail ?? "调用失败") : undefined,
        };
      }
      if (result.passed) {
        prev.current = {
          stamp,
          uiPassed: result.problems.filter((p) => p.kind === "ui" && p.verdict === "accepted").map((p) => p.id),
        };
      }
      const final = result;
      patch(tier, (s) => ({ ...s, result: final, status: final.passed ? "passed" : final.error ? "error" : "failed" }));
      results.current = [...results.current.filter((r) => r.tier !== tier), final];
      if (final.error) {
        setError(`${TIER_LABEL[tier]}无法判定：${final.error}`);
        setPhase("done");
        return;
      }
      if (!final.passed) break;
    }
    finish();
  };

  const finish = () => {
    const passed = results.current.filter((r) => r.passed);
    const arena: ArenaResult = {
      track,
      language: lang,
      rank: passed.length ? passed[passed.length - 1].tier : null,
      tiers: results.current,
      startedAt: startedAt.current,
    };
    patchHistory(egg.reportId, track === "frontend" ? { arenaFrontend: arena } : { arena });
    setPhase("done");
  };

  const start = () => {
    prev.current = { uiPassed: [] };
    results.current = [];
    startedAt.current = new Date().toISOString();
    setTiers(EMPTY);
    climb(0);
  };

  const reset = () => {
    setTiers(EMPTY);
    setError(null);
    setPhase("idle");
  };

  const retryFrom = TIERS.findIndex((t) => tiers[t].status === "error");
  const reached = [...TIERS].reverse().find((t) => tiers[t].status === "passed");
  const finished = phase === "done" && retryFrom < 0 && TIERS.some((t) => tiers[t].result);

  const segment = (on: boolean) =>
    cx(
      "rounded-lg px-3 py-1.5 text-sm transition disabled:cursor-not-allowed",
      on ? "bg-ink font-semibold text-surface" : "text-readout enabled:hover:text-ink",
    );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <h1 className="font-display text-3xl font-bold">编程段位赛</h1>
          <p className="mt-2 text-sm text-readout">
            {track === "algo"
              ? `${egg.model} 从青铜打到王者。每档 3 道题，模型写完整程序，交给开源判题服务 Judge0 跑隐藏测试，全部通过才算答对，答对 ${PASS_PER_TIER} 题晋级。`
              : `${egg.model} 的前端能力。每档 1 道 JavaScript 逻辑题，交给 Judge0 运行；2 道页面题，模型写出完整的网页，放进隔离的窗口，在你的浏览器里用隐藏测试模拟点击、输入和键盘操作。答对 ${PASS_PER_TIER} 题晋级。`}
            段位不计入综合分。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="赛道" className="flex rounded-xl border border-line bg-surface p-1">
            {(["algo", "frontend"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={track === t}
                disabled={phase !== "idle"}
                onClick={() => setTrack(t)}
                className={segment(track === t)}
              >
                {TRACK_LABEL[t]}
              </button>
            ))}
          </div>
          {track === "algo" ? (
            <>
              <div
                role="radiogroup"
                aria-label="编程语言"
                className="flex rounded-xl border border-line bg-surface p-1"
              >
                {ARENA_LANGUAGES.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={language === l}
                    disabled={phase !== "idle"}
                    onClick={() => setLanguage(l)}
                    className={segment(language === l)}
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
            </>
          ) : (
            <span className="px-2 text-sm text-readout">JavaScript、HTML 和 CSS</span>
          )}
          {phase === "idle" ? (
            <IconButton label="开始挑战" icon={<Play size={18} />} onClick={start} />
          ) : (
            <IconButton
              label={retryFrom >= 0 ? `从${TIER_LABEL[TIERS[retryFrom]]}重试` : "换个赛道或语言重来"}
              icon={<RotateCcw size={18} />}
              disabled={phase === "running"}
              onClick={() => (retryFrom >= 0 ? climb(retryFrom) : reset())}
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
              <span className="ml-4 align-middle text-base font-normal text-readout">
                {track === "frontend" ? "前端" : LANGUAGE_LABEL[lang]}
              </span>
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
                        onClick={() => {
                          setView(p.kind === "ui" ? "page" : "code");
                          setOpen(p);
                        }}
                        aria-label={`${p.title}：${p.phase === "done" ? VERDICT_LABEL[p.verdict!] : PHASE_LABEL[p.phase]}`}
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
                            title={PHASE_LABEL[p.phase]}
                            className={cx(
                              "size-2 shrink-0 rounded-full motion-safe:animate-pulse",
                              p.phase === "writing" ? "bg-violet" : p.phase === "judging" ? "bg-cyan" : "bg-mint",
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

      {/* 判题现场：UI 题在这里的隔离窗口里跑测试。窗口必须在可视区域内，浏览器才不会暂停它的渲染 */}
      <section aria-live="polite" className={cx("flex flex-col gap-3", live === 0 && "hidden")}>
        <h2 className="text-sm text-readout">正在你的浏览器里测试模型做的页面</h2>
        <div ref={monitor} className="flex gap-3 overflow-x-auto pb-1" />
      </section>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ""} wide>
        {open && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {open.phase === "done" && <Pill tone={VERDICT_TONE(open.verdict)}>{VERDICT_LABEL[open.verdict!]}</Pill>}
              {open.phase === "done" && open.verdict !== "error" && open.verdict !== "no_code" && !!open.totalTests && (
                <span className="text-readout">
                  通过 {open.passedTests}/{open.totalTests} {open.kind === "ui" ? "项检查" : "组测试"}
                </span>
              )}
              {!!open.latencyMs && <span className="text-readout">作答用时 {formatMs(open.latencyMs)}</span>}
              {open.slowestMs !== undefined && (
                <span className="text-readout">程序最慢一组 {formatMs(open.slowestMs)}</span>
              )}
              {open.kind === "ui" && open.code && (
                <div className="ml-auto flex rounded-xl border border-line p-1">
                  <IconButton
                    label="看页面"
                    size="sm"
                    tone={view === "page" ? "default" : "ghost"}
                    icon={<AppWindow size={16} />}
                    onClick={() => setView("page")}
                  />
                  <IconButton
                    label="看代码"
                    size="sm"
                    tone={view === "code" ? "default" : "ghost"}
                    icon={<Code2 size={16} />}
                    onClick={() => setView("code")}
                  />
                </div>
              )}
            </div>
            {open.detail && (
              <pre className="max-h-48 overflow-auto rounded-xl bg-rose/6 p-3 font-mono text-xs whitespace-pre-wrap text-rose">
                {open.detail}
              </pre>
            )}
            {open.code &&
              (open.kind === "ui" && view === "page" ? (
                // 模型写的页面只能放进隔离的 iframe：读不到本站数据，也不能联网
                <iframe
                  title={`${open.title}：模型做的页面`}
                  sandbox={SANDBOX}
                  srcDoc={previewDoc(open.code)}
                  className="h-[60vh] w-full rounded-xl border border-line bg-white"
                />
              ) : (
                <pre className="max-h-[60vh] overflow-auto rounded-xl bg-tint p-4 font-mono text-xs leading-relaxed [font-variant-ligatures:none]">
                  {open.code}
                </pre>
              ))}
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
