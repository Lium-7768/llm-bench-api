"use client";

import { AppWindow, Check, Code2, Dices, Play, RotateCcw, Square, Timer, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ScoreDial } from "@/components/Score";
import { IconButton, Modal, Pill, cx } from "@/components/ui";
import { previewDoc, runUiTest, SANDBOX } from "@/lib/arena/frontend/sandbox";
import type { ArenaEvent } from "@/lib/arena/run";
import {
  ARENA_LANGUAGES,
  arenaScore,
  LANGUAGE_LABEL,
  TIERS,
  TIER_LABEL,
  TIER_WEIGHT,
  TRACK_LABEL,
  VERDICT_LABEL,
} from "@/lib/arena/meta";
import type { ArenaCatalogItem, ArenaLanguage, ArenaResult, ArenaTier, ArenaTrack, ProblemResult } from "@/lib/types";
import { postApi, streamApi } from "@/lib/web/api";
import { useConfig } from "@/lib/web/config";
import { useEgg } from "@/lib/web/egg";
import { formatMs } from "@/lib/web/format";
import { patchHistory } from "@/lib/web/storage";

/** 每档的颜色：只有王者用光谱 */
const TIER_STYLE: Record<ArenaTier, { cap: string; text: string; ring: string }> = {
  bronze: { cap: "bg-bronze", text: "text-bronze", ring: "ring-bronze/50" },
  silver: { cap: "bg-silver", text: "text-silver", ring: "ring-silver/50" },
  gold: { cap: "bg-gold", text: "text-gold", ring: "ring-gold/50" },
  platinum: { cap: "bg-cyan", text: "text-cyan", ring: "ring-cyan/50" },
  diamond: { cap: "bg-blue", text: "text-blue", ring: "ring-blue/50" },
  king: { cap: "spectrum-bg", text: "text-violet", ring: "ring-violet/50" },
};

/** 台阶从左到右一级比一级高（类名要写全，Tailwind 才能扫描到） */
const STEP_HEIGHT = [
  "lg:min-h-[15rem]",
  "lg:min-h-[17.5rem]",
  "lg:min-h-[20rem]",
  "lg:min-h-[22.5rem]",
  "lg:min-h-[25rem]",
  "lg:min-h-[27.5rem]",
];

/** 毛玻璃：半透明白底 + 背景模糊，压在页面背后的光晕上 */
const GLASS =
  "border border-surface/70 bg-surface/50 shadow-[0_10px_40px_-16px_rgb(15_20_48/0.25)] ring-1 ring-ink/5 backdrop-blur-2xl backdrop-saturate-150";

/** queued 等待；writing 写代码；judging 服务端判题；browser 浏览器里测页面；done 出结果 */
type Phase = "queued" | "writing" | "judging" | "browser" | "done";

type ProblemState = ArenaCatalogItem & { phase: Phase } & Partial<
    Pick<
      ProblemResult,
      "verdict" | "passedTests" | "totalTests" | "failedTest" | "detail" | "code" | "latencyMs" | "slowestMs" | "usage"
    >
  >;

const PHASE_LABEL: Record<Exclude<Phase, "done">, string> = {
  queued: "等待中",
  writing: "写代码中",
  judging: "判题中",
  browser: "浏览器里测试页面中",
};

const VERDICT_TONE = (v?: ProblemResult["verdict"]) =>
  v === "accepted" ? "pass" : v === "error" || v === "pending" ? "muted" : v === "time_limit" ? "warn" : "fail";

/** 这一题得了多少分（和 arenaScore 的规则一致） */
const pointsOf = (p: Pick<ProblemState, "tier" | "verdict" | "passedTests" | "totalTests">) =>
  p.verdict === "accepted"
    ? TIER_WEIGHT[p.tier]
    : p.totalTests
      ? (TIER_WEIGHT[p.tier] * 0.5 * (p.passedTests ?? 0)) / p.totalTests
      : 0;

const round1 = (n: number) => Math.round(n * 10) / 10;

const toResult = (p: ProblemState): ProblemResult => ({
  id: p.id,
  tier: p.tier,
  title: p.title,
  kind: p.kind,
  verdict: p.verdict ?? "error",
  passedTests: p.passedTests ?? 0,
  totalTests: p.totalTests ?? 0,
  failedTest: p.failedTest,
  detail: p.detail,
  code: p.code ?? "",
  latencyMs: p.latencyMs ?? 0,
  slowestMs: p.slowestMs,
  usage: p.usage,
});

/** 把浏览器里的测试结果换成和服务端一样的结果字段 */
async function judgeInBrowser(html: string, test: string, host: HTMLElement): Promise<Partial<ProblemState>> {
  const outcome = await runUiTest(html, test, host);
  if (outcome === "timeout") return { verdict: "time_limit", detail: "页面测试 20 秒内没有跑完" };
  const errors = outcome.errors.length ? `\n页面报错：${outcome.errors.join("；")}` : "";
  const f = outcome.failure;
  return {
    passedTests: outcome.passed,
    totalTests: outcome.total,
    verdict: f ? "wrong_answer" : "accepted",
    failedTest: f?.index,
    detail: f ? `第 ${f.index} 项「${f.name}」：${f.message}${errors}` : undefined,
  };
}

export default function ArenaPage() {
  const egg = useEgg();
  const { config } = useConfig();
  const [catalog, setCatalog] = useState<Record<ArenaTrack, ArenaCatalogItem[]> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [track, setTrack] = useState<ArenaTrack>("algo");
  const [language, setLanguage] = useState<ArenaLanguage>("python");
  const [picked, setPicked] = useState<Record<ArenaTrack, string[] | null>>({ algo: null, frontend: null });
  const [askEach, setAskEach] = useState(true);
  const [state, setState] = useState<Record<string, ProblemState>>({});
  const [phase, setPhase] = useState<"idle" | "running" | "paused" | "done">("idle");
  const [pausedAt, setPausedAt] = useState<ArenaTier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [final, setFinal] = useState<ArenaResult | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<"page" | "code">("page");
  const [live, setLive] = useState(0);
  const monitor = useRef<HTMLDivElement>(null);
  const decide = useRef<((go: boolean) => void) | null>(null);
  const startedAt = useRef("");
  // 运行中途也能切换「每档完成后问我」，循环里读 ref 拿到最新值
  const askRef = useRef(askEach);

  const allowed = !!egg && egg.model === config.model;
  const token = egg?.token;
  useEffect(() => {
    if (!allowed || !token) return;
    postApi<Record<ArenaTrack, ArenaCatalogItem[]>>("/api/v1/arena/catalog", config, { token })
      .then(setCatalog)
      .catch((e) => setLoadError((e as Error).message));
    // 令牌不变就只取一次目录
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, token]);

  // 首帧还没读到 sessionStorage：先空着，避免闪一下「什么都没有」
  if (egg === undefined) return null;
  if (!egg || !allowed || loadError) {
    return <p className="py-40 text-center text-readout">这里什么都没有。</p>;
  }
  if (!catalog) return <p className="py-40 text-center text-readout">正在准备题目</p>;

  const items = catalog[track];
  const firstOfEach = TIERS.map((t) => items.find((p) => p.tier === t)?.id).filter((x): x is string => !!x);
  const chosen = picked[track] ?? firstOfEach;
  const lang: ArenaLanguage = track === "frontend" ? "javascript" : language;
  const locked = phase !== "idle";
  const fullMarks = items.filter((p) => chosen.includes(p.id)).reduce((s, p) => s + TIER_WEIGHT[p.tier], 0);

  const toggle = (id: string) =>
    setPicked((all) => {
      const cur = all[track] ?? firstOfEach;
      return { ...all, [track]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });
  const pick = (ids: string[] | null) => setPicked((all) => ({ ...all, [track]: ids }));

  const patchProblem = (id: string, change: Partial<ProblemState>) =>
    setState((all) => ({ ...all, [id]: { ...all[id], ...change } }));

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

  /** 跑一档里选中的题（同一档最多 3 道，一次请求） */
  const runGroup = async (group: ArenaCatalogItem[], results: Map<string, ProblemState>) => {
    const browser: Array<Promise<void>> = [];
    group.forEach((p) => patchProblem(p.id, { phase: "writing" }));
    const settle = (id: string, change: Partial<ProblemState>) => {
      const base = results.get(id) ?? ({ ...group.find((p) => p.id === id)!, phase: "done" } as ProblemState);
      results.set(id, { ...base, ...change });
      patchProblem(id, change);
    };
    try {
      await streamApi<ArenaEvent>(
        "/api/v1/arena",
        config,
        { token: egg.token, track, language: lang, problems: group.map((p) => p.id) },
        (e) => {
          if (e.type === "problem.code") patchProblem(e.id, { phase: "judging", code: e.code });
          else if (e.type === "problem.ui") {
            patchProblem(e.id, { phase: "browser", code: e.html });
            const tile = mountTile(group.find((p) => p.id === e.id)?.title ?? e.id);
            browser.push(
              judgeInBrowser(e.html, e.test, tile.box)
                .then((r) => settle(e.id, { ...r, code: e.html, phase: "done" }))
                .finally(tile.remove),
            );
          } else if (e.type === "problem.done") {
            // UI 题服务端返回 pending：只记下作答用时，结论等浏览器
            if (e.result.verdict === "pending")
              settle(e.result.id, { latencyMs: e.result.latencyMs, usage: e.result.usage });
            else settle(e.result.id, { ...e.result, phase: "done" });
          }
        },
      );
    } catch (e) {
      const message = e instanceof TypeError ? "和本站的连接中断了" : (e as Error).message;
      for (const p of group)
        if (!results.get(p.id)?.verdict) settle(p.id, { verdict: "error", detail: message, phase: "done" });
    }
    await Promise.all(browser);
  };

  /** 按档位从低到高跑选中的题；打开「每档完成后问我」时，每档结束等用户决定是否继续 */
  const run = async (only?: string[]) => {
    const ids = only ?? chosen;
    const selected = items.filter((p) => ids.includes(p.id));
    if (!selected.length) return;
    setError(null);
    setFinal(null);
    setPhase("running");
    const results = new Map<string, ProblemState>();
    if (only) {
      // 重试：保留其他题的结果
      for (const p of Object.values(state)) if (p.verdict && !only.includes(p.id)) results.set(p.id, p);
      selected.forEach((p) => patchProblem(p.id, { phase: "queued", verdict: undefined, detail: undefined }));
    } else {
      startedAt.current = new Date().toISOString();
      setState(Object.fromEntries(selected.map((p) => [p.id, { ...p, phase: "queued" }])));
    }

    const tiers = TIERS.filter((t) => selected.some((p) => p.tier === t));
    for (let i = 0; i < tiers.length; i++) {
      await runGroup(
        selected.filter((p) => p.tier === tiers[i]),
        results,
      );
      if (askRef.current && !only && i < tiers.length - 1) {
        setPausedAt(tiers[i]);
        setPhase("paused");
        const go = await new Promise<boolean>((resolve) => (decide.current = resolve));
        setPausedAt(null);
        if (!go) break;
        setPhase("running");
      }
    }
    finish(results);
  };

  const finish = (results: Map<string, ProblemState>) => {
    const done = items.filter((p) => results.get(p.id)?.verdict).map((p) => toResult(results.get(p.id)!));
    const { score, best } = arenaScore(done);
    const result: ArenaResult = { track, language: lang, score, best, problems: done, startedAt: startedAt.current };
    setFinal(result);
    patchHistory(egg.reportId, track === "frontend" ? { arenaFrontend: result } : { arena: result });
    const failed = done.filter((p) => p.verdict === "error").length;
    if (failed) setError(`${failed} 道题调用失败，没有计入分数，可以重试`);
    setPhase("done");
  };

  const reset = () => {
    setState({});
    setFinal(null);
    setError(null);
    setPhase("idle");
  };

  const open = openId ? state[openId] : null;
  const errored = Object.values(state)
    .filter((p) => p.verdict === "error")
    .map((p) => p.id);
  const earned = Object.values(state)
    .filter((p) => p.phase === "done" && p.verdict && p.verdict !== "error")
    .reduce((s, p) => s + pointsOf(p), 0);

  const segment = (on: boolean) =>
    cx(
      "rounded-lg px-3 py-1.5 text-sm transition disabled:cursor-not-allowed",
      on ? "bg-ink font-semibold text-surface shadow-sm" : "text-readout enabled:hover:text-ink",
    );
  const chip =
    "rounded-lg px-2.5 py-1 text-xs text-readout transition enabled:hover:bg-surface/80 enabled:hover:text-ink disabled:opacity-40";

  return (
    <div className="relative isolate flex flex-col gap-7">
      {/* 页面背后的光晕，给毛玻璃一点可以模糊的颜色 */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-48 -left-40 size-[38rem] rounded-full bg-violet/20 blur-3xl" />
        <div className="absolute top-1/4 -right-48 size-[34rem] rounded-full bg-cyan/20 blur-3xl" />
        <div className="absolute -bottom-56 left-1/4 size-[36rem] rounded-full bg-gold/15 blur-3xl" />
      </div>

      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <h1 className="font-display text-3xl font-bold">编程段位赛</h1>
          <p className="mt-2 text-sm text-readout">
            {track === "algo"
              ? `${egg.model} 写完整程序，交给开源判题服务 Judge0 跑隐藏测试。`
              : `${egg.model} 的前端能力：逻辑题交给 Judge0 运行；页面题让模型写出完整网页，放进隔离的窗口，在你的浏览器里模拟点击、输入和键盘操作来检查。`}
            题目任选，按档位从低到高依次测，不计入综合分。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="赛道" className={cx("flex rounded-xl p-1", GLASS)}>
            {(["algo", "frontend"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={track === t}
                disabled={locked}
                onClick={() => setTrack(t)}
                className={segment(track === t)}
              >
                {TRACK_LABEL[t]}
              </button>
            ))}
          </div>
          {track === "algo" ? (
            <>
              <div role="radiogroup" aria-label="编程语言" className={cx("flex rounded-xl p-1", GLASS)}>
                {ARENA_LANGUAGES.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={language === l}
                    disabled={locked}
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
                disabled={locked}
                onClick={() => setLanguage(ARENA_LANGUAGES[Math.floor(Math.random() * ARENA_LANGUAGES.length)])}
              />
            </>
          ) : (
            <span className="px-2 text-sm text-readout">JavaScript、HTML 和 CSS</span>
          )}
        </div>
      </header>

      {/* 选题与运行控制 */}
      <section className={cx("flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl px-4 py-3", GLASS)}>
        <p className="text-sm">
          已选 <strong className="font-display tabular-nums">{chosen.length}</strong> 题，满分{" "}
          <strong className="font-display tabular-nums">{fullMarks}</strong> 分
        </p>
        <div className="flex items-center gap-1">
          <button type="button" className={chip} disabled={locked} onClick={() => pick(null)}>
            每档第一题
          </button>
          <button type="button" className={chip} disabled={locked} onClick={() => pick(items.map((p) => p.id))}>
            全选
          </button>
          <button type="button" className={chip} disabled={locked} onClick={() => pick([])}>
            清空
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm text-readout select-none">
          <button
            type="button"
            role="switch"
            aria-checked={askEach}
            aria-label="每档完成后问我是否继续"
            onClick={() =>
              setAskEach((v) => {
                askRef.current = !v;
                return !v;
              })
            }
            disabled={phase === "running"}
            className={cx(
              "relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50",
              askEach ? "bg-violet" : "bg-tint-2",
            )}
          >
            <span
              className={cx(
                "absolute top-0.5 left-0.5 size-4 rounded-full bg-surface shadow transition-transform",
                askEach && "translate-x-4",
              )}
            />
          </button>
          每档完成后问我
        </label>
        <div className="ml-auto flex items-center gap-2">
          {phase === "running" && (
            <span className="flex items-center gap-2 text-sm text-readout">
              <span className="size-2 rounded-full bg-violet motion-safe:animate-pulse" />
              正在测试
            </span>
          )}
          {phase === "done" && errored.length > 0 && (
            <IconButton label="重试调用失败的题" icon={<RotateCcw size={18} />} onClick={() => run(errored)} />
          )}
          {phase === "idle" ? (
            <IconButton
              label={chosen.length ? "开始测试" : "先选几道题"}
              icon={<Play size={18} />}
              disabled={!chosen.length}
              onClick={() => run()}
            />
          ) : (
            <IconButton label="重新选题" icon={<RotateCcw size={18} />} disabled={phase !== "done"} onClick={reset} />
          )}
        </div>
      </section>

      {error && <p className="rounded-xl bg-rose/8 px-4 py-3 text-sm text-rose">{error}</p>}

      {/* 每档完成后：继续还是到此为止 */}
      <AnimatePresence>
        {phase === "paused" && pausedAt && (
          <motion.section
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={cx("flex flex-wrap items-center gap-4 rounded-2xl px-5 py-4", GLASS)}
          >
            <p className="flex-1 text-sm">
              <strong className={cx("font-display", TIER_STYLE[pausedAt].text)}>{TIER_LABEL[pausedAt]}</strong>{" "}
              测完了，到目前得 <strong className="font-display tabular-nums">{round1(earned)}</strong>{" "}
              分。继续测下一档吗？
            </p>
            <IconButton label="继续下一档" icon={<Play size={18} />} onClick={() => decide.current?.(true)} />
            <IconButton label="到此为止，出成绩" icon={<Square size={18} />} onClick={() => decide.current?.(false)} />
          </motion.section>
        )}
      </AnimatePresence>

      {/* 成绩 */}
      {final && (
        <motion.section
          initial={{ opacity: 0, filter: "blur(10px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.6 }}
          className={cx("flex flex-col items-center gap-6 rounded-3xl p-6 sm:flex-row sm:p-8", GLASS)}
        >
          <ScoreDial score={final.score} label="编程得分" size={168} />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className="font-display text-2xl font-semibold sm:text-3xl">
              {final.best ? (
                <>
                  最高解出 <span className={TIER_STYLE[final.best].text}>{TIER_LABEL[final.best]}</span>
                </>
              ) : (
                <span className="text-readout">一道都没解出来</span>
              )}
            </p>
            <p className="text-sm text-readout">
              {track === "frontend" ? "前端赛道" : `算法赛道，${LANGUAGE_LABEL[lang]}`}。每题满分是所在档位的分值：
              {TIERS.map((t) => `${TIER_LABEL[t]} ${TIER_WEIGHT[t]}`).join("、")}
              。全对得满分，部分测试通过按比例得一半，调用失败的题不计入。
            </p>
            <ul className="flex flex-wrap gap-2">
              {TIERS.filter((t) => final.problems.some((p) => p.tier === t && p.verdict !== "error")).map((t) => {
                const ps = final.problems.filter((p) => p.tier === t && p.verdict !== "error");
                const got = ps.reduce((s, p) => s + pointsOf({ ...p, tier: t }), 0);
                return (
                  <li key={t} className="rounded-xl bg-surface/60 px-3 py-1.5 text-xs">
                    <span className={cx("font-semibold", TIER_STYLE[t].text)}>{TIER_LABEL[t]}</span>{" "}
                    <span className="tabular-nums">
                      {round1(got)} / {ps.length * TIER_WEIGHT[t]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </motion.section>
      )}

      {/* 台阶：宽屏六列一级比一级高，窄屏竖排。每道题是一张可选的卡片 */}
      <ol className="grid gap-2.5 lg:grid-cols-6 lg:items-end">
        {TIERS.map((tier, i) => {
          const list = items.filter((p) => p.tier === tier);
          const lit = list.some((p) => chosen.includes(p.id));
          return (
            <li key={tier} className={cx("flex flex-col", STEP_HEIGHT[i])}>
              <section
                className={cx(
                  "flex flex-1 flex-col overflow-hidden rounded-2xl transition-opacity lg:rounded-b-none",
                  GLASS,
                  !lit && "opacity-60",
                )}
              >
                <div className={cx("h-1.5", lit ? TIER_STYLE[tier].cap : "bg-line")} />
                <div className="flex items-baseline justify-between gap-2 px-3.5 pt-3.5 pb-2">
                  <h2 className={cx("font-display text-lg font-semibold", lit ? TIER_STYLE[tier].text : "text-faint")}>
                    {TIER_LABEL[tier]}
                  </h2>
                  <span className="text-xs text-readout tabular-nums">每题 {TIER_WEIGHT[tier]} 分</span>
                </div>
                <ul className="mt-auto flex flex-col gap-1 px-1.5 pb-1.5">
                  {list.map((item) => {
                    const s = state[item.id];
                    const on = chosen.includes(item.id);
                    const status = !locked
                      ? on
                        ? "已选，点击取消"
                        : "未选，点击选择"
                      : !s
                        ? "这次没测"
                        : s.phase === "done"
                          ? VERDICT_LABEL[s.verdict!]
                          : PHASE_LABEL[s.phase];
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          aria-pressed={locked ? undefined : on}
                          disabled={locked && !(s?.code || s?.phase === "done")}
                          onClick={() => {
                            if (!locked) return toggle(item.id);
                            setView(item.kind === "ui" ? "page" : "code");
                            setOpenId(item.id);
                          }}
                          aria-label={`${item.title}：${status}`}
                          title={status}
                          className={cx(
                            "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition",
                            (locked ? !!s : on)
                              ? cx("bg-surface/75 shadow-sm ring-1", TIER_STYLE[tier].ring)
                              : "opacity-55",
                            !locked && "hover:bg-surface/90 hover:opacity-100",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1 text-sm font-medium">
                              {item.kind === "ui" && <AppWindow size={13} className="shrink-0 text-faint" />}
                              <span className="truncate">{item.title}</span>
                            </span>
                            <span className="block truncate text-xs text-faint">{item.tags.join("、")}</span>
                          </span>
                          {!locked ? (
                            <span
                              aria-hidden
                              className={cx(
                                "grid size-4 shrink-0 place-items-center rounded-[5px] border transition",
                                on ? "border-ink bg-ink text-surface" : "border-faint",
                              )}
                            >
                              {on && <Check size={11} strokeWidth={3.5} />}
                            </span>
                          ) : s ? (
                            s.phase === "done" ? (
                              <VerdictMark verdict={s.verdict!} />
                            ) : (
                              <span
                                className={cx(
                                  "size-2 shrink-0 rounded-full",
                                  s.phase !== "queued" && "motion-safe:animate-pulse",
                                  s.phase === "queued"
                                    ? "bg-faint/50"
                                    : s.phase === "writing"
                                      ? "bg-violet"
                                      : s.phase === "judging"
                                        ? "bg-cyan"
                                        : "bg-mint",
                                )}
                              />
                            )
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </li>
          );
        })}
      </ol>

      {/* 判题现场：UI 题在这里的隔离窗口里跑测试。窗口必须在可视区域内，浏览器才不会暂停它的渲染 */}
      <section aria-live="polite" className={cx("flex flex-col gap-3 rounded-2xl p-4", GLASS, live === 0 && "hidden")}>
        <h2 className="text-sm text-readout">正在你的浏览器里测试模型做的页面</h2>
        <div ref={monitor} className="flex gap-3 overflow-x-auto pb-1" />
      </section>

      <Modal open={!!open} onClose={() => setOpenId(null)} title={open?.title ?? ""} wide>
        {open && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className={cx("font-semibold", TIER_STYLE[open.tier].text)}>{TIER_LABEL[open.tier]}</span>
              {open.phase === "done" && <Pill tone={VERDICT_TONE(open.verdict)}>{VERDICT_LABEL[open.verdict!]}</Pill>}
              {open.phase === "done" && open.verdict !== "error" && (
                <span className="text-readout tabular-nums">
                  得 {round1(pointsOf(open))} / {TIER_WEIGHT[open.tier]} 分
                </span>
              )}
              {open.phase === "done" && !!open.totalTests && (
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
        verdict === "accepted" && "bg-mint/15 text-mint",
        verdict === "time_limit" && "bg-amber/15 text-amber",
        verdict === "error" && "bg-tint text-readout",
        !["accepted", "time_limit", "error"].includes(verdict) && "bg-rose/15 text-rose",
      )}
    >
      <Icon size={12} strokeWidth={3} />
    </span>
  );
}
