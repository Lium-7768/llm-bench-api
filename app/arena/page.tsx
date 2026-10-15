"use client";

import { AppWindow, Check, ChevronRight, Code2, Dices, Lock, Play, RotateCcw, Square, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { IconButton, Modal, Pill, cx } from "@/components/ui";
import { previewDoc, runUiTest, SANDBOX } from "@/lib/arena/frontend/sandbox";
import type { ArenaEvent } from "@/lib/arena/run";
import {
  ARENA_LANGUAGES,
  arenaScore,
  LANGUAGE_LABEL,
  pointsOf,
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

// ---------------------------------------------------------------- 外观

/** 每档的颜色：只有王者用光谱 */
const TIER_TEXT: Record<ArenaTier, string> = {
  bronze: "text-bronze",
  silver: "text-silver",
  gold: "text-gold",
  platinum: "text-cyan",
  diamond: "text-blue",
  king: "text-violet",
};
const TIER_BG: Record<ArenaTier, string> = {
  bronze: "bg-bronze",
  silver: "bg-silver",
  gold: "bg-gold",
  platinum: "bg-cyan",
  diamond: "bg-blue",
  king: "spectrum-bg",
};

/** 机壳：浅铝色，上沿高光、下沿阴影，像一块压铸面板 */
const CASING =
  "relative rounded-[28px] border border-line bg-linear-to-b from-surface to-tint-2 p-3 shadow-[inset_0_1px_0_var(--color-surface),inset_0_-2px_0_rgb(15_20_48/0.06),0_28px_60px_-36px_rgb(15_20_48/0.6)] sm:p-4";
/** 机壳上嵌进去的面板 */
const PLATE = "rounded-2xl border border-line bg-surface/70 shadow-[inset_0_1px_3px_rgb(15_20_48/0.08)]";
/** 读数窗：机器上唯一的深色部件，题目和判定都显示在这里 */
const SCREEN =
  "relative overflow-hidden rounded-2xl bg-ink text-surface shadow-[inset_0_2px_14px_rgb(0_0_0/0.65),0_0_0_1px_rgb(15_20_48/0.9),0_1px_0_1px_var(--color-surface)]";
/** 读数窗上的细扫描线 */
const SCANLINES =
  "pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(to_bottom,rgb(255_255_255/0.035)_0_1px,transparent_1px_3px)]";

// ---------------------------------------------------------------- 状态

/** queued 待测；writing 写代码；judging 判题服务判题；browser 浏览器里测页面；done 出结果 */
type Phase = "queued" | "writing" | "judging" | "browser" | "done";

type ProblemState = ArenaCatalogItem & { phase: Phase } & Partial<
    Pick<
      ProblemResult,
      "verdict" | "passedTests" | "totalTests" | "failedTest" | "detail" | "code" | "latencyMs" | "slowestMs" | "usage"
    >
  >;

/** idle 装题；running 测试中；paused 等用户决定（过关后暂停，或调用失败）；done 出成绩 */
type MachinePhase = "idle" | "running" | "paused" | "done";
type Pause = { reason: "next" | "error"; id: string } | null;
type Ending = "cleared" | "eliminated" | "stopped";

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

const scoreOf = (p: Pick<ProblemState, "tier" | "verdict" | "passedTests" | "totalTests">) =>
  pointsOf({
    tier: p.tier,
    verdict: p.verdict ?? "error",
    passedTests: p.passedTests ?? 0,
    totalTests: p.totalTests ?? 0,
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

// ---------------------------------------------------------------- 页面

export default function ArenaPage() {
  const egg = useEgg();
  const { config } = useConfig();
  const [catalog, setCatalog] = useState<Record<ArenaTrack, ArenaCatalogItem[]> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [track, setTrack] = useState<ArenaTrack>("algo");
  const [language, setLanguage] = useState<ArenaLanguage>("python");
  const [picked, setPicked] = useState<Record<ArenaTrack, string[] | null>>({ algo: null, frontend: null });
  const [askEach, setAskEach] = useState(false);
  const [phase, setPhase] = useState<MachinePhase>("idle");
  const [queue, setQueue] = useState<string[]>([]);
  const [state, setState] = useState<Record<string, ProblemState>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [pause, setPause] = useState<Pause>(null);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [final, setFinal] = useState<ArenaResult | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<"page" | "code">("page");
  const stage = useRef<HTMLDivElement>(null);
  const decide = useRef<((choice: "go" | "retry" | "stop") => void) | null>(null);
  const askRef = useRef(askEach);
  const startedAt = useRef("");

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
  const idle = phase === "idle";
  // 出场顺序：青铜到王者，同一档按目录顺序
  const order = idle ? items.filter((p) => chosen.includes(p.id)).map((p) => p.id) : queue;
  const plannedTiers = order.map((id) => items.find((p) => p.id === id)!.tier);
  const fullMarks = plannedTiers.reduce((s, t) => s + TIER_WEIGHT[t], 0);
  const attempted = order.map((id) => state[id]).filter((p): p is ProblemState => !!p?.verdict);
  const live = arenaScore(attempted.map(toResult), plannedTiers);
  const current = currentId ? state[currentId] : null;

  const toggle = (id: string) =>
    setPicked((all) => {
      const cur = all[track] ?? firstOfEach;
      return { ...all, [track]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });
  const pick = (ids: string[] | null) => setPicked((all) => ({ ...all, [track]: ids }));
  const patchProblem = (id: string, change: Partial<ProblemState>) =>
    setState((all) => ({ ...all, [id]: { ...all[id], ...change } }));

  /** 跑一道题：模型作答，逻辑 / 程序题交给判题服务，页面题在读数窗里的隔离窗口测 */
  const attempt = async (item: ArenaCatalogItem): Promise<ProblemState> => {
    let result: ProblemState = { ...item, phase: "writing" };
    const set = (change: Partial<ProblemState>) => {
      result = { ...result, ...change };
      patchProblem(item.id, change);
    };
    set({ phase: "writing", verdict: undefined, detail: undefined, code: undefined });
    let browser: Promise<void> | null = null;
    try {
      await streamApi<ArenaEvent>(
        "/api/v1/arena",
        config,
        { token: egg.token, track, language: lang, problems: [item.id] },
        (e) => {
          if (e.type === "problem.code") set({ phase: "judging", code: e.code });
          else if (e.type === "problem.ui") {
            set({ phase: "browser", code: e.html });
            // 等读数窗把测试台渲染出来：判题窗口必须在可视区域里，浏览器才不会暂停它
            browser = new Promise<void>((r) => setTimeout(r, 60))
              .then(() => judgeInBrowser(e.html, e.test, stage.current ?? document.body))
              .then((r) => set({ ...r, phase: "done" }));
          } else if (e.type === "problem.done") {
            if (e.result.verdict === "pending") set({ latencyMs: e.result.latencyMs, usage: e.result.usage });
            else set({ ...e.result, phase: "done" });
          }
        },
      );
    } catch (e) {
      const message = e instanceof TypeError ? "和本站的连接中断了" : (e as Error).message;
      if (!result.verdict) set({ verdict: "error", detail: message, phase: "done" });
    }
    if (browser) await browser;
    if (!result.verdict) set({ verdict: "error", detail: "没有收到判题结果", phase: "done" });
    return result;
  };

  const waitFor = (p: NonNullable<Pause>) => {
    setPause(p);
    setPhase("paused");
    return new Promise<"go" | "retry" | "stop">((resolve) => (decide.current = resolve));
  };

  /** 从青铜到王者逐题测，答错就停；调用失败时暂停，可以重试或结束 */
  const run = async () => {
    const list = items.filter((p) => chosen.includes(p.id));
    if (!list.length) return;
    startedAt.current = new Date().toISOString();
    setQueue(list.map((p) => p.id));
    setState(Object.fromEntries(list.map((p) => [p.id, { ...p, phase: "queued" }])));
    setFinal(null);
    setEnding(null);
    setPhase("running");

    const results: ProblemState[] = [];
    let end: Ending = "cleared";
    let eliminatedAt: string | undefined;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      setCurrentId(item.id);
      let r = await attempt(item);
      while (r.verdict === "error") {
        const choice = await waitFor({ reason: "error", id: item.id });
        setPause(null);
        if (choice !== "retry") break;
        setPhase("running");
        r = await attempt(item);
      }
      results.push(r);
      if (r.verdict === "error") {
        end = "stopped";
        break;
      }
      if (r.verdict !== "accepted") {
        end = "eliminated";
        eliminatedAt = item.id;
        break;
      }
      if (askRef.current && i < list.length - 1) {
        const choice = await waitFor({ reason: "next", id: list[i + 1].id });
        setPause(null);
        if (choice === "stop") {
          end = "stopped";
          break;
        }
        setPhase("running");
      }
    }

    const done = results.map(toResult);
    const { score, best } = arenaScore(
      done,
      list.map((p) => p.tier),
    );
    const result: ArenaResult = {
      track,
      language: lang,
      score,
      best,
      problems: done,
      planned: list.map((p) => p.id),
      eliminatedAt,
      startedAt: startedAt.current,
    };
    patchHistory(egg.reportId, track === "frontend" ? { arenaFrontend: result } : { arena: result });
    setFinal(result);
    setEnding(end);
    setCurrentId(null);
    setPhase("done");
  };

  const reset = () => {
    setState({});
    setQueue([]);
    setFinal(null);
    setEnding(null);
    setPhase("idle");
  };

  const open = openId ? state[openId] : null;
  const segment = (on: boolean) =>
    cx(
      "rounded-lg px-3 py-1.5 text-sm transition disabled:cursor-not-allowed",
      on
        ? "bg-ink font-semibold text-surface shadow-[inset_0_-2px_0_rgb(0_0_0/0.35)]"
        : "text-readout enabled:hover:text-ink",
    );
  const tape = order.map((id) => state[id]).filter((p): p is ProblemState => !!p?.verdict);

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-2xl">
        <h1 className="font-display text-3xl font-bold">编程段位赛</h1>
        <p className="mt-2 text-sm text-readout">
          {egg.model} 从青铜开始逐关答题，答错就停在那一关。
          {track === "algo"
            ? "每道题写完整程序，交给开源判题服务 Judge0 跑隐藏测试。"
            : "逻辑题交给 Judge0 运行；页面题让模型写出完整网页，在读数窗里的隔离窗口中模拟点击、输入和键盘操作来检查。"}
          不计入综合分。
        </p>
      </header>

      <section aria-label="答题机" className={CASING}>
        <Screws />

        {/* 顶部面板：赛道、语言、暂停开关、计分轮 */}
        <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-3 px-3 py-2.5", PLATE)}>
          <div role="radiogroup" aria-label="赛道" className="flex rounded-xl bg-tint p-1">
            {(["algo", "frontend"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={track === t}
                disabled={!idle}
                onClick={() => setTrack(t)}
                className={segment(track === t)}
              >
                {TRACK_LABEL[t]}
              </button>
            ))}
          </div>
          {track === "algo" ? (
            <div className="flex items-center gap-1.5">
              <div role="radiogroup" aria-label="编程语言" className="flex rounded-xl bg-tint p-1">
                {ARENA_LANGUAGES.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={language === l}
                    disabled={!idle}
                    onClick={() => setLanguage(l)}
                    className={segment(language === l)}
                  >
                    {LANGUAGE_LABEL[l]}
                  </button>
                ))}
              </div>
              <IconButton
                label="随机选一种语言"
                size="sm"
                tone="ghost"
                icon={<Dices size={16} />}
                disabled={!idle}
                onClick={() => setLanguage(ARENA_LANGUAGES[Math.floor(Math.random() * ARENA_LANGUAGES.length)])}
              />
            </div>
          ) : (
            <span className="text-sm text-readout">JavaScript、HTML 和 CSS</span>
          )}
          <label className="flex items-center gap-2 text-sm text-readout select-none">
            <Toggle
              on={askEach}
              label="每过一关暂停，由我决定是否继续"
              disabled={phase === "running"}
              onChange={(v) => {
                askRef.current = v;
                setAskEach(v);
              }}
            />
            每过一关暂停
          </label>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-readout">得分</span>
            <Odometer value={idle ? null : (live.score ?? 0)} />
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[15rem_1fr]">
          {/* 楼层指示：从下往上是青铜到王者，没轮到的题不显示题名 */}
          <Floors items={items} order={order} state={state} idle={idle} currentId={currentId} ending={ending} />

          <div className="flex min-w-0 flex-col gap-3">
            {idle ? (
              <Keyboard items={items} chosen={chosen} onToggle={toggle} />
            ) : (
              <Readout
                current={current}
                index={current ? order.indexOf(current.id) : -1}
                total={order.length}
                final={final}
                ending={ending}
                eliminated={final?.eliminatedAt ? state[final.eliminatedAt] : null}
                stage={stage}
              />
            )}

            {/* 控制条 */}
            <div className={cx("flex flex-wrap items-center gap-3 px-3 py-2.5", PLATE)}>
              {idle && (
                <>
                  <p className="text-sm">
                    装入 <strong className="font-display tabular-nums">{chosen.length}</strong> 题，满分{" "}
                    <strong className="font-display tabular-nums">{fullMarks}</strong> 分
                  </p>
                  <div className="flex items-center gap-1">
                    {(
                      [
                        ["每档第一题", null],
                        ["全选", items.map((p) => p.id)],
                        ["清空", []],
                      ] as const
                    ).map(([label, ids]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => pick(ids ? [...ids] : null)}
                        className="rounded-lg px-2.5 py-1 text-xs text-readout transition hover:bg-tint hover:text-ink"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {phase === "running" && current && (
                <p className="text-sm text-readout">正在测第 {order.indexOf(current.id) + 1} 关，答错就停</p>
              )}
              {phase === "paused" && pause?.reason === "next" && (
                <p className="text-sm">
                  过关了。下一关是{" "}
                  <strong className={TIER_TEXT[state[pause.id].tier]}>{TIER_LABEL[state[pause.id].tier]}</strong>
                  ，继续吗？
                </p>
              )}
              {phase === "paused" && pause?.reason === "error" && (
                <p className="min-w-0 flex-1 truncate text-sm text-rose" title={state[pause.id]?.detail}>
                  调用失败，不算答错：{state[pause.id]?.detail}
                </p>
              )}
              {phase === "done" && <p className="text-sm text-readout">成绩已经存进这份报告，从历史记录里也能看到。</p>}

              <div className="ml-auto flex items-center gap-2">
                {phase === "paused" && pause?.reason === "error" && (
                  <IconButton
                    label="重试这一题"
                    icon={<RotateCcw size={18} />}
                    onClick={() => decide.current?.("retry")}
                  />
                )}
                {phase === "paused" && pause?.reason === "next" && (
                  <IconButton label="继续下一关" icon={<Play size={18} />} onClick={() => decide.current?.("go")} />
                )}
                {phase === "paused" && (
                  <IconButton
                    label="到此为止，出成绩"
                    icon={<Square size={18} />}
                    onClick={() => decide.current?.("stop")}
                  />
                )}
                {phase === "done" && <IconButton label="重新装题" icon={<RotateCcw size={18} />} onClick={reset} />}
                {idle && <StartButton disabled={!chosen.length} onClick={run} />}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 纸带：每答完一题打一行 */}
      {tape.length > 0 && (
        <section aria-label="答题记录" className="flex flex-col gap-2">
          <h2 className="text-sm text-readout">答题记录</h2>
          <ol className={cx("divide-y divide-dashed divide-line overflow-hidden", PLATE)}>
            {tape.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setView(p.kind === "ui" ? "page" : "code");
                    setOpenId(p.id);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-tint"
                >
                  <span className="w-6 shrink-0 text-right font-mono text-xs text-faint tabular-nums">
                    {order.indexOf(p.id) + 1}
                  </span>
                  <span className={cx("h-4 w-1 shrink-0 rounded-full", TIER_BG[p.tier])} />
                  <span className={cx("w-10 shrink-0 font-semibold", TIER_TEXT[p.tier])}>{TIER_LABEL[p.tier]}</span>
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  <Pill
                    tone={
                      p.verdict === "accepted"
                        ? "pass"
                        : p.verdict === "error"
                          ? "muted"
                          : p.verdict === "time_limit"
                            ? "warn"
                            : "fail"
                    }
                  >
                    {VERDICT_LABEL[p.verdict!]}
                  </Pill>
                  <span className="hidden w-20 text-right text-readout tabular-nums sm:block">
                    {p.verdict === "error" ? "不计分" : `${round1(scoreOf(p))} / ${TIER_WEIGHT[p.tier]} 分`}
                  </span>
                  <span className="hidden w-16 text-right text-xs text-faint tabular-nums md:block">
                    {p.latencyMs ? formatMs(p.latencyMs) : ""}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <Modal open={!!open} onClose={() => setOpenId(null)} title={open?.title ?? ""} wide>
        {open && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className={cx("font-semibold", TIER_TEXT[open.tier])}>{TIER_LABEL[open.tier]}</span>
              {open.verdict && (
                <Pill tone={open.verdict === "accepted" ? "pass" : open.verdict === "error" ? "muted" : "fail"}>
                  {VERDICT_LABEL[open.verdict]}
                </Pill>
              )}
              {open.verdict && open.verdict !== "error" && (
                <span className="text-readout tabular-nums">
                  得 {round1(scoreOf(open))} / {TIER_WEIGHT[open.tier]} 分
                </span>
              )}
              {!!open.totalTests && (
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

// ---------------------------------------------------------------- 部件

/** 机壳四角的螺丝 */
function Screws() {
  const screw =
    "absolute size-2.5 rounded-full bg-linear-to-br from-surface to-faint/70 shadow-[inset_0_1px_1px_rgb(15_20_48/0.4)] after:absolute after:top-1/2 after:left-0.5 after:h-px after:w-1.5 after:-translate-y-1/2 after:rotate-45 after:bg-readout/60";
  return (
    <>
      <span aria-hidden className={cx(screw, "top-2 left-2")} />
      <span aria-hidden className={cx(screw, "top-2 right-2")} />
      <span aria-hidden className={cx(screw, "bottom-2 left-2")} />
      <span aria-hidden className={cx(screw, "right-2 bottom-2")} />
    </>
  );
}

/** 指示灯 */
function Lamp({ tone, blink }: { tone: "off" | "on" | "busy" | "fail"; blink?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-block size-2.5 shrink-0 rounded-full",
        tone === "off" && "bg-faint/35 shadow-[inset_0_1px_1px_rgb(15_20_48/0.35)]",
        tone === "on" && "bg-mint shadow-[0_0_10px_var(--color-mint)]",
        tone === "busy" && "bg-amber shadow-[0_0_10px_var(--color-amber)]",
        tone === "fail" && "bg-rose shadow-[0_0_10px_var(--color-rose)]",
        blink && "motion-safe:animate-pulse",
      )}
    />
  );
}

function Toggle({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full shadow-[inset_0_1px_3px_rgb(15_20_48/0.3)] transition disabled:opacity-50",
        on ? "bg-violet" : "bg-tint-2",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 left-0.5 size-4 rounded-full bg-surface shadow-[0_1px_2px_rgb(15_20_48/0.4)] transition-transform",
          on && "translate-x-4",
        )}
      />
    </button>
  );
}

/** 机械计数轮：每一位是一条 0–9 的数字带，换数时滚动到位 */
function Odometer({ value }: { value: number | null }) {
  const digits =
    value === null
      ? null
      : String(Math.max(0, Math.min(100, value)))
          .padStart(3, "0")
          .split("");
  return (
    <span
      role="img"
      aria-label={value === null ? "还没开始" : `${value} 分`}
      className="flex gap-0.5 rounded-lg bg-ink p-1 shadow-[inset_0_2px_6px_rgb(0_0_0/0.6)]"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="relative h-7 w-5 overflow-hidden rounded-[4px] bg-linear-to-b from-ink via-[color-mix(in_oklab,var(--color-ink)_82%,white)] to-ink font-mono text-lg leading-7 font-semibold text-surface"
        >
          <span
            className="absolute inset-x-0 top-0 flex flex-col items-center transition-transform duration-700 ease-[cubic-bezier(0.2,0.9,0.25,1.15)] motion-reduce:transition-none"
            style={{ transform: `translateY(-${digits ? Number(digits[i]) * 1.75 : 0}rem)` }}
          >
            {Array.from({ length: 10 }, (_, d) => (
              <span key={d} className={cx("h-7", !digits && "text-surface/25")}>
                {digits ? d : "–"}
              </span>
            ))}
          </span>
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-black/40" />
        </span>
      ))}
    </span>
  );
}

/** 楼层指示：电梯式，从下往上是青铜到王者 */
function Floors({
  items,
  order,
  state,
  idle,
  currentId,
  ending,
}: {
  items: ArenaCatalogItem[];
  order: string[];
  state: Record<string, ProblemState>;
  idle: boolean;
  currentId: string | null;
  ending: Ending | null;
}) {
  const currentTier = currentId ? state[currentId]?.tier : null;
  return (
    <ol
      aria-label="关卡进度"
      className={cx(
        // 窄屏三列网格；宽屏是一根从下往上的电梯井，中间一条导轨串起各层的灯
        "relative grid grid-cols-3 gap-1 p-2 sm:grid-cols-6 lg:flex lg:flex-col-reverse lg:justify-between",
        "lg:before:absolute lg:before:top-7 lg:before:bottom-7 lg:before:left-[1.3rem] lg:before:w-px lg:before:bg-line",
        PLATE,
      )}
    >
      {TIERS.map((tier) => {
        const ids = order.filter((id) => items.find((p) => p.id === id)?.tier === tier);
        const done = ids.map((id) => state[id]).filter((p) => p?.verdict);
        const failed = done.some((p) => p.verdict !== "accepted" && p.verdict !== "error");
        const passed = ids.length > 0 && done.length === ids.length && !failed;
        const here = currentTier === tier;
        const locked = !idle && !here && done.length < ids.length;
        const tone = failed ? "fail" : passed ? "on" : here ? "busy" : "off";
        return (
          <li
            key={tier}
            className={cx(
              "relative flex items-center gap-2 rounded-xl px-2 py-2 whitespace-nowrap transition lg:gap-2.5 lg:px-3 lg:py-2.5",
              here && "bg-surface shadow-[0_1px_0_var(--color-line),0_6px_16px_-10px_rgb(15_20_48/0.4)]",
            )}
          >
            {here && (
              <motion.span layoutId="floor-needle" className="absolute -left-1.5 hidden text-amber lg:block">
                <ChevronRight size={16} strokeWidth={3} />
              </motion.span>
            )}
            <Lamp tone={ids.length ? tone : "off"} blink={here} />
            <span
              className={cx(
                "font-display text-base font-semibold",
                ids.length ? TIER_TEXT[tier] : "text-faint",
                !ids.length && "opacity-60",
              )}
            >
              {TIER_LABEL[tier]}
            </span>
            <span className="ml-auto hidden items-center gap-1 text-xs text-readout tabular-nums min-[380px]:flex sm:max-lg:hidden">
              {!ids.length ? (
                "未装题"
              ) : idle ? (
                `${ids.length} 题`
              ) : failed ? (
                <span className="text-rose">淘汰</span>
              ) : passed ? (
                <span className="text-mint">过关</span>
              ) : here ? (
                "测试中"
              ) : locked ? (
                <>
                  <Lock size={11} />
                  {ending ? "未测" : `${ids.length} 题`}
                </>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** 装题键盘：每档三道题是三颗键帽，按下表示装入 */
function Keyboard({
  items,
  chosen,
  onToggle,
}: {
  items: ArenaCatalogItem[];
  chosen: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className={cx("flex flex-col gap-2.5 p-3", PLATE)}>
      {TIERS.map((tier) => (
        <div key={tier} className="grid items-stretch gap-2 sm:grid-cols-[3.5rem_1fr_1fr_1fr]">
          <span className="flex items-center gap-1.5 text-sm">
            <span className={cx("h-4 w-1 rounded-full", TIER_BG[tier])} />
            <span className={cx("font-semibold", TIER_TEXT[tier])}>{TIER_LABEL[tier]}</span>
          </span>
          {items
            .filter((p) => p.tier === tier)
            .map((p) => {
              const on = chosen.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(p.id)}
                  className={cx(
                    "flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-[transform,box-shadow,background-color] duration-100",
                    on
                      ? "translate-y-0.5 border-ink/15 bg-tint shadow-[inset_0_2px_5px_rgb(15_20_48/0.18)]"
                      : "border-line bg-surface shadow-[0_3px_0_var(--color-tint-2),0_5px_10px_-6px_rgb(15_20_48/0.35)] hover:-translate-y-px",
                  )}
                >
                  <Lamp tone={on ? "on" : "off"} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-sm font-medium">
                      {p.kind === "ui" && <AppWindow size={13} className="shrink-0 text-faint" />}
                      <span className="truncate">{p.title}</span>
                    </span>
                    <span className="block truncate text-xs text-faint">{p.tags.join("、")}</span>
                  </span>
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}

/** 启动按钮：机器上唯一的大按钮 */
function StartButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={disabled ? "先装入至少一道题" : "启动"}
      title={disabled ? "先装入至少一道题" : "启动"}
      disabled={disabled}
      onClick={onClick}
      className="grid size-14 place-items-center rounded-full border border-ink/20 bg-linear-to-b from-violet to-[color-mix(in_oklab,var(--color-violet)_75%,black)] text-surface shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_4px_0_color-mix(in_oklab,var(--color-violet)_60%,black),0_10px_20px_-8px_var(--color-violet)] transition-[transform,box-shadow] active:translate-y-1 active:shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_0_0_transparent] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Play size={22} fill="currentColor" />
    </button>
  );
}

const STEPS: Array<{
  key: string;
  label: string;
  done: (p: ProblemState) => boolean;
  busy: (p: ProblemState) => boolean;
}> = [
  { key: "issue", label: "出题", done: () => true, busy: () => false },
  {
    key: "write",
    label: "写代码",
    done: (p) => p.phase !== "queued" && p.phase !== "writing",
    busy: (p) => p.phase === "writing",
  },
  {
    key: "judge",
    label: "判题",
    done: (p) => p.phase === "done",
    busy: (p) => p.phase === "judging" || p.phase === "browser",
  },
  { key: "verdict", label: "判定", done: (p) => p.phase === "done", busy: () => false },
];

/** 读数窗：测试时只显示当前这道题；结束后显示成绩 */
function Readout({
  current,
  index,
  total,
  final,
  ending,
  eliminated,
  stage,
}: {
  current: ProblemState | null;
  index: number;
  total: number;
  final: ArenaResult | null;
  ending: Ending | null;
  eliminated: ProblemState | null;
  stage: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className={cx(SCREEN, "min-h-[22rem] p-5 sm:p-7")}>
      <div aria-hidden className={SCANLINES} />
      <AnimatePresence mode="wait">
        {final ? (
          <motion.div
            key="final"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative flex h-full flex-col justify-center gap-4"
          >
            <p className="text-sm text-surface/55">
              {ending === "cleared" ? "全部过关" : ending === "eliminated" ? "被淘汰" : "提前结束"}
            </p>
            <p className="font-display text-4xl font-bold sm:text-5xl">
              {ending === "cleared" ? (
                "通关"
              ) : eliminated ? (
                <>
                  止步<span className={cx("ml-3", TIER_TEXT[eliminated.tier])}>{TIER_LABEL[eliminated.tier]}</span>
                </>
              ) : final.best ? (
                <>
                  停在<span className={cx("ml-3", TIER_TEXT[final.best])}>{TIER_LABEL[final.best]}</span>
                </>
              ) : (
                "还没过关"
              )}
            </p>
            {eliminated && (
              <p className="text-sm text-surface/70">
                在「{eliminated.title}」{VERDICT_LABEL[eliminated.verdict!]}
                {eliminated.totalTests ? `，通过 ${eliminated.passedTests}/${eliminated.totalTests}` : ""}。
              </p>
            )}
            <p className="text-sm text-surface/55">
              得 {final.score ?? "—"} 分{final.best ? `，最高解出${TIER_LABEL[final.best]}` : ""}
              。满分算的是装入的所有题，没测到的按 0 分计。
            </p>
          </motion.div>
        ) : current ? (
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
            className="relative flex flex-col gap-5"
          >
            <div className="flex items-baseline gap-3 text-sm text-surface/55">
              <span className="font-mono tabular-nums">
                第 {index + 1} / {total} 关
              </span>
              <span className={cx("font-semibold", TIER_TEXT[current.tier])}>{TIER_LABEL[current.tier]}</span>
              <span>每题 {TIER_WEIGHT[current.tier]} 分</span>
            </div>
            <div>
              <h2 className="font-display text-3xl font-semibold sm:text-4xl">{current.title}</h2>
              <p className="mt-2 text-sm text-surface/55">{current.tags.join("、")}</p>
            </div>

            {/* 继电器灯：一道题走完的四个环节 */}
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
              {STEPS.map((s, i) => {
                const verdictStep = s.key === "verdict" && current.phase === "done";
                const tone = verdictStep
                  ? current.verdict === "accepted"
                    ? "on"
                    : current.verdict === "error"
                      ? "busy"
                      : "fail"
                  : s.busy(current)
                    ? "busy"
                    : s.done(current)
                      ? "on"
                      : "off";
                return (
                  <li key={s.key} className="flex items-center gap-2">
                    {i > 0 && <span aria-hidden className="h-px w-5 bg-surface/20" />}
                    <Lamp tone={tone} blink={tone === "busy"} />
                    <span className={tone === "off" ? "text-surface/35" : "text-surface/85"}>
                      {s.key === "judge" && current.kind === "ui" ? "浏览器测试" : s.label}
                    </span>
                  </li>
                );
              })}
            </ol>

            {/* 页面题：测试台，模型做的页面在这里被逐项操作 */}
            <div
              className={cx(
                "relative h-[13.5rem] w-72 overflow-hidden rounded-lg border border-surface/15 bg-white",
                current.phase !== "browser" && "hidden",
              )}
            >
              <div ref={stage} className="absolute inset-0" />
            </div>

            {current.phase === "done" && (
              <motion.p
                initial={{ opacity: 0, scale: 1.4, rotate: -8 }}
                animate={{ opacity: 1, scale: 1, rotate: -4 }}
                transition={{ type: "spring", stiffness: 420, damping: 18 }}
                className={cx(
                  "inline-flex w-fit items-center gap-2 rounded-lg border-2 px-3 py-1 font-display text-lg font-bold",
                  current.verdict === "accepted"
                    ? "border-mint text-mint"
                    : current.verdict === "error"
                      ? "border-amber text-amber"
                      : "border-rose text-rose",
                )}
              >
                {current.verdict === "accepted" ? <Check size={18} strokeWidth={3} /> : <X size={18} strokeWidth={3} />}
                {VERDICT_LABEL[current.verdict!]}
                {current.totalTests ? (
                  <span className="font-mono text-sm font-medium tabular-nums">
                    {current.passedTests}/{current.totalTests}
                  </span>
                ) : null}
              </motion.p>
            )}
          </motion.div>
        ) : (
          <motion.p key="boot" className="relative text-surface/55">
            正在准备
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
