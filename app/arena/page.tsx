"use client";

import { AppWindow, Check, Code2, Dices, ListChecks, Play, RotateCcw, Square, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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
import type { ArenaCatalogItem, ArenaLanguage, ArenaResult, ArenaTrack, ProblemResult, TestMark } from "@/lib/types";
import { postApi, streamApi } from "@/lib/web/api";
import { useConfig } from "@/lib/web/config";
import { useEgg } from "@/lib/web/egg";
import { formatMs } from "@/lib/web/format";
import { patchHistory } from "@/lib/web/storage";

// ---------------------------------------------------------------- 状态

/** queued 待测；writing 模型作答；judging 判题服务判题；browser 浏览器里测页面；done 出结果 */
type Phase = "queued" | "writing" | "judging" | "browser" | "done";

type ProblemState = ArenaCatalogItem & {
  phase: Phase;
  /** 模型边写边推过来的回答原文 */
  text?: string;
  /** 每组测试的运行时限，秒 */
  limit?: number;
  /** 开始作答、开始判题的时刻，用来显示计时 */
  writeAt?: number;
  judgeAt?: number;
  judgeMs?: number;
} & Partial<
    Pick<
      ProblemResult,
      | "verdict"
      | "passedTests"
      | "totalTests"
      | "failedTest"
      | "detail"
      | "code"
      | "latencyMs"
      | "slowestMs"
      | "usage"
      | "tests"
      | "errorKind"
    >
  >;

/** 运行记录的一行：每次作答一行，调用失败后重试会多出一行 */
type LogEntry = ProblemState & { key: number; index: number; tries: number };

/** idle 选题；running 测试中；paused 等用户决定（过关后暂停，或调用失败）；done 出成绩 */
type MachinePhase = "idle" | "running" | "paused" | "done";
type Pause = { reason: "next" | "error"; id: string } | null;
type Ending = "cleared" | "eliminated" | "stopped";
type Tone = "wait" | "run" | "ok" | "bad" | "warn";

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
  tests: p.tests,
  errorKind: p.errorKind,
  usage: p.usage,
});

const scoreOf = (p: Pick<ProblemState, "tier" | "verdict" | "passedTests" | "totalTests">) =>
  pointsOf({
    tier: p.tier,
    verdict: p.verdict ?? "error",
    passedTests: p.passedTests ?? 0,
    totalTests: p.totalTests ?? 0,
  });

const toneOf = (p: ProblemState | undefined, current: boolean): Tone =>
  !p?.verdict ? (current ? "run" : "wait") : p.verdict === "accepted" ? "ok" : p.verdict === "error" ? "warn" : "bad";

/** 调用失败的三种来源：都不是模型答错，可以重试 */
const FAULT: Record<NonNullable<ProblemResult["errorKind"]>, { label: string; why: string }> = {
  model: { label: "模型接口报错", why: "被测接口这次没有给出回答。" },
  network: { label: "网络错误", why: "连接中途断开，回答没有收完整。" },
  judge: { label: "判题服务不可用", why: "代码已经交了，是判题服务这边出了问题。" },
};

const FILE: Record<ArenaLanguage, string> = {
  python: "solution.py",
  javascript: "solution.js",
  java: "Main.java",
  go: "main.go",
};

/** 把浏览器里的测试结果换成和服务端一样的结果字段 */
async function judgeInBrowser(
  html: string,
  test: string,
  host: HTMLElement,
  onProgress: (tests: TestMark[], total: number) => void,
): Promise<Partial<ProblemState>> {
  const marks = (r: boolean[]): TestMark[] => r.map((ok) => ({ verdict: ok ? "accepted" : "wrong_answer" }));
  const outcome = await runUiTest(html, test, host, undefined, (p) => onProgress(marks(p.progress), p.total));
  if (outcome === "timeout") return { verdict: "time_limit", detail: "页面测试 20 秒内没有跑完" };
  const errors = outcome.errors.length ? `\n页面报错：${outcome.errors.join("；")}` : "";
  const f = outcome.failure;
  return {
    passedTests: outcome.passed,
    totalTests: outcome.total,
    tests: marks(outcome.results),
    verdict: f ? "wrong_answer" : "accepted",
    failedTest: f?.index,
    detail: f ? `第 ${f.index} 项「${f.name}」：${f.message}${errors}` : undefined,
  };
}

/** 模型还在写的时候，从回答原文里取出正在写的代码：去掉思考内容和代码块标记 */
function liveCode(text: string): string {
  const t = text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "");
  const open = t.match(/```[^\n`]*\n/);
  if (!open) return t.trimStart();
  const body = t.slice(open.index! + open[0].length);
  const close = body.indexOf("```");
  return close >= 0 ? body.slice(0, close) : body;
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
  const [log, setLog] = useState<LogEntry[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [tries, setTries] = useState(1);
  const [pause, setPause] = useState<Pause>(null);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [final, setFinal] = useState<ArenaResult | null>(null);
  const [clock, setClock] = useState<{ from: number; to: number | null } | null>(null);
  const [picking, setPicking] = useState(false);
  const [openKey, setOpenKey] = useState<number | null>(null);
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
  const byId = (id: string) => items.find((p) => p.id === id)!;
  const plannedTiers = order.map((id) => byId(id).tier);
  const fullMarks = plannedTiers.reduce((s, t) => s + TIER_WEIGHT[t], 0);
  const attempted = order.map((id) => state[id]).filter((p): p is ProblemState => !!p?.verdict);
  const live = arenaScore(attempted.map(toResult), plannedTiers);
  const current = currentId ? state[currentId] : null;
  const currentIndex = current ? order.indexOf(current.id) : -1;

  const toggle = (id: string) =>
    setPicked((all) => {
      const cur = all[track] ?? firstOfEach;
      return { ...all, [track]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });
  const pick = (ids: string[] | null) => setPicked((all) => ({ ...all, [track]: ids }));
  const patchProblem = (id: string, change: Partial<ProblemState>) =>
    setState((all) => ({ ...all, [id]: { ...all[id], ...change } }));

  /** 跑一道题：模型作答，逻辑 / 程序题交给判题服务，页面题在判题面板里的隔离窗口测 */
  const attempt = async (item: ArenaCatalogItem): Promise<ProblemState> => {
    let result: ProblemState = { ...item, phase: "writing" };
    const set = (change: Partial<ProblemState>) => {
      result = { ...result, ...change };
      patchProblem(item.id, change);
    };
    set({
      phase: "writing",
      writeAt: Date.now(),
      text: "",
      code: undefined,
      verdict: undefined,
      detail: undefined,
      errorKind: undefined,
      tests: undefined,
      totalTests: undefined,
      passedTests: undefined,
      judgeAt: undefined,
      judgeMs: undefined,
    });
    const judged = (change: Partial<ProblemState>) =>
      set({ ...change, phase: "done", judgeMs: result.judgeAt ? Date.now() - result.judgeAt : undefined });
    let browser: Promise<void> | null = null;
    try {
      await streamApi<ArenaEvent>(
        "/api/v1/arena",
        config,
        { token: egg.token, track, language: lang, problems: [item.id] },
        (e) => {
          if (e.type === "problem.text") set({ text: (result.text ?? "") + e.text });
          else if (e.type === "problem.code")
            set({
              phase: "judging",
              code: e.code,
              totalTests: e.total,
              limit: e.limit,
              judgeAt: Date.now(),
              tests: [],
            });
          else if (e.type === "problem.tests") set({ tests: e.tests });
          else if (e.type === "problem.ui") {
            set({ phase: "browser", code: e.html, judgeAt: Date.now(), tests: [] });
            // 等判题面板把测试台渲染出来：判题窗口必须在可视区域里，浏览器才不会暂停它
            browser = new Promise<void>((r) => setTimeout(r, 60))
              .then(() =>
                judgeInBrowser(e.html, e.test, stage.current ?? document.body, (tests, total) =>
                  set({ tests, totalTests: total }),
                ),
              )
              .then(judged);
          } else if (e.type === "problem.done") {
            if (e.result.verdict === "pending") set({ latencyMs: e.result.latencyMs, usage: e.result.usage });
            else judged(e.result);
          }
        },
      );
    } catch (e) {
      const message = e instanceof TypeError ? "和本站的连接中断了" : (e as Error).message;
      if (!result.verdict) set({ verdict: "error", errorKind: "network", detail: message, phase: "done" });
    }
    if (browser) await browser;
    if (!result.verdict) set({ verdict: "error", errorKind: "network", detail: "没有收到判题结果", phase: "done" });
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
    setLog([]);
    setFinal(null);
    setEnding(null);
    setClock({ from: Date.now(), to: null });
    setPhase("running");

    const record = (r: ProblemState, index: number, n: number) =>
      setLog((all) => [...all, { ...r, key: all.length, index, tries: n }]);
    const results: ProblemState[] = [];
    let end: Ending = "cleared";
    let eliminatedAt: string | undefined;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      setCurrentId(item.id);
      let n = 1;
      setTries(n);
      let r = await attempt(item);
      record(r, i, n);
      while (r.verdict === "error") {
        const choice = await waitFor({ reason: "error", id: item.id });
        setPause(null);
        if (choice !== "retry") break;
        setPhase("running");
        setTries(++n);
        r = await attempt(item);
        record(r, i, n);
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
    setClock((c) => c && { ...c, to: Date.now() });
    setPhase("done");
  };

  const reset = () => {
    setState({});
    setQueue([]);
    setLog([]);
    setFinal(null);
    setEnding(null);
    setCurrentId(null);
    setClock(null);
    setPhase("idle");
  };

  const status: { tone: Tone | "idle"; text: string } =
    phase === "idle"
      ? { tone: "idle", text: "待开始" }
      : phase === "paused"
        ? { tone: "warn", text: pause?.reason === "error" ? "已暂停，等你决定" : "过关了，等你确认" }
        : phase === "running" && current
          ? {
              tone: "run",
              text: `第 ${currentIndex + 1} / ${order.length} 题，${TIER_LABEL[current.tier]}${tries > 1 ? `，第 ${tries} 次` : ""}`,
            }
          : ending === "cleared"
            ? { tone: "ok", text: "全部通过" }
            : ending === "eliminated" && final?.eliminatedAt
              ? { tone: "bad", text: `止步${TIER_LABEL[byId(final.eliminatedAt).tier]}` }
              : { tone: "idle", text: "已结束" };

  const open = openKey === null ? null : log.find((l) => l.key === openKey);
  const fileName = track === "frontend" ? (current?.kind === "ui" ? "index.html" : "solution.js") : FILE[lang];

  return (
    <div className="flex flex-col gap-4">
      {/* 顶栏：谁在答、什么状态、得几分 */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
          <h1 className="text-base font-semibold">编程段位赛</h1>
          <span className="text-faint">/</span>
          <span className="max-w-[16rem] truncate">{egg.model}</span>
          <span className="text-faint">/</span>
          <span className="text-readout">
            {TRACK_LABEL[track]}，{track === "frontend" ? "JavaScript、HTML 和 CSS" : LANGUAGE_LABEL[lang]}
          </span>
        </div>
        <StatusPill tone={status.tone}>{status.text}</StatusPill>
        {clock && (
          <span className="inline-flex h-6.5 items-center rounded-full border border-line bg-surface px-2.5 font-mono text-xs text-readout tabular-nums">
            <Elapsed from={clock.from} to={clock.to} clock />
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {idle && (
            <>
              <IconButton
                label={`选题和设置（已选 ${chosen.length} 题）`}
                icon={<ListChecks size={18} />}
                onClick={() => setPicking(true)}
              />
              <IconButton
                label={chosen.length ? "开始" : "先选至少一道题"}
                icon={<Play size={17} fill="currentColor" />}
                disabled={!chosen.length}
                onClick={run}
                tone="primary"
              />
            </>
          )}
          {phase === "done" && <IconButton label="重新选题" icon={<RotateCcw size={18} />} onClick={reset} />}
          <div className="ml-2 text-right leading-none" aria-label={idle ? "还没开始" : `得分 ${live.score ?? 0}`}>
            <span className="font-mono text-3xl font-semibold tracking-tight tabular-nums">
              {idle ? "—" : (live.score ?? 0)}
            </span>
            <span className="ml-1 text-xs text-readout">/ 100 分</span>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {final && ending && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cx(
              "rounded-lg border px-4 py-3 text-sm",
              ending === "cleared" && "border-mint/40 bg-mint/8 text-mint",
              ending === "eliminated" && "border-rose/40 bg-rose/6 text-rose",
              ending === "stopped" && "border-line bg-surface",
            )}
          >
            <Ended final={final} ending={ending} state={state} order={order} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 题目队列：按段位排好，一次只跑一道；没轮到的题不显示题名 */}
      <ol aria-label="题目队列" className="flex overflow-x-auto rounded-xl border border-line bg-surface">
        {order.length === 0 && <li className="px-4 py-3 text-sm text-readout">还没有选题</li>}
        {order.map((id, i) => {
          const p = state[id];
          const item = byId(id);
          const here = id === currentId && !p?.verdict;
          const tone = idle ? "wait" : toneOf(p, here);
          const reached = idle || !!p?.verdict || id === currentId;
          const skipped = phase === "done" && !p?.verdict;
          return (
            <li
              key={id}
              className={cx(
                "relative grid min-w-32 flex-1 gap-0.5 border-l border-line px-3.5 py-2.5 first:border-l-0",
                tone === "run" && "bg-blue/6",
                tone === "warn" && "bg-amber/8",
                skipped && "opacity-50",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <StateIcon tone={tone} />
                {TIER_LABEL[item.tier]}
                <span className="text-[11px] font-normal text-faint">{TIER_WEIGHT[item.tier]} 分</span>
              </span>
              <span className="truncate text-xs text-readout">
                {reached ? item.title : `第 ${i + 1} 题`}
                {p?.verdict &&
                  `，${p.verdict === "accepted" ? "通过" : p.verdict === "error" ? (phase === "done" ? "调用失败，未计分" : "调用失败") : p.totalTests ? `${p.passedTests}/${p.totalTests}` : VERDICT_LABEL[p.verdict]}`}
                {skipped && "，未作答"}
              </span>
              <span
                aria-hidden
                className={cx(
                  "absolute inset-x-0 bottom-0 h-0.5",
                  tone === "run" && "bg-blue",
                  tone === "ok" && "bg-mint",
                  tone === "bad" && "bg-rose",
                  tone === "warn" && "bg-amber",
                )}
              />
            </li>
          );
        })}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Editor problem={current} fileName={fileName} />
        <JudgePanel
          problem={current}
          paused={phase === "paused" ? pause : null}
          next={pause?.reason === "next" ? state[pause.id] : null}
          stage={stage}
          onDecide={(c) => decide.current?.(c)}
        />
      </div>

      {/* 运行记录：每次作答一行 */}
      <section aria-label="运行记录" className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex h-11 items-center gap-3 border-b border-line px-4 text-sm">
          <h2 className="font-semibold">运行记录</h2>
          <span className="truncate text-readout">一次只跑一道题；调用失败可以重试，答错就停</span>
        </div>
        {log.length === 0 ? (
          <p className="px-4 py-7 text-center text-sm text-faint">还没有运行记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-left text-xs text-readout">
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-4 py-2.5 font-medium">段位</th>
                  <th className="px-4 py-2.5 font-medium">题目</th>
                  <th className="px-4 py-2.5 font-medium">结论</th>
                  <th className="px-4 py-2.5 font-medium">测试</th>
                  <th className="px-4 py-2.5 font-medium">作答用时</th>
                  <th className="px-4 py-2.5 text-right font-medium">得分</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {log.map((l) => (
                  <tr key={l.key} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2.5 font-mono text-xs text-faint">{String(l.index + 1).padStart(2, "0")}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{TIER_LABEL[l.tier]}</td>
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setView(l.kind === "ui" ? "page" : "code");
                          setOpenKey(l.key);
                        }}
                        className="text-left whitespace-nowrap underline decoration-line underline-offset-4 transition hover:decoration-ink"
                      >
                        {l.title}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <Verdict entry={l} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {l.totalTests && l.verdict !== "error" ? `${l.passedTests}/${l.totalTests}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{l.latencyMs ? formatMs(l.latencyMs) : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs whitespace-nowrap">
                      {l.verdict === "error" ? "不计分" : `${round1(scoreOf(l))} / ${TIER_WEIGHT[l.tier]}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={picking} onClose={() => setPicking(false)} title="选题" icon={<ListChecks size={18} />} wide>
        <Picker
          items={items}
          track={track}
          language={language}
          chosen={chosen}
          fullMarks={fullMarks}
          askEach={askEach}
          onTrack={setTrack}
          onLanguage={setLanguage}
          onToggle={toggle}
          onPick={pick}
          firstOfEach={firstOfEach}
          onAskEach={(v) => {
            askRef.current = v;
            setAskEach(v);
          }}
        />
      </Modal>

      <Modal open={!!open} onClose={() => setOpenKey(null)} title={open?.title ?? ""} wide>
        {open && <Detail entry={open} view={view} onView={setView} />}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- 顶栏和结局

function StatusPill({ tone, children }: { tone: Tone | "idle"; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex h-6.5 items-center gap-2 rounded-full border bg-surface px-2.5 text-xs whitespace-nowrap",
        tone === "warn" ? "border-amber/45 text-amber" : "border-line text-readout",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "size-1.5 rounded-full",
          tone === "run" &&
            "bg-blue shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-blue)_18%,transparent)] motion-safe:animate-pulse",
          tone === "ok" && "bg-mint",
          tone === "bad" && "bg-rose",
          tone === "warn" && "bg-amber",
          (tone === "idle" || tone === "wait") && "bg-faint",
        )}
      />
      {children}
    </span>
  );
}

function Ended({
  final,
  ending,
  state,
  order,
}: {
  final: ArenaResult;
  ending: Ending;
  state: Record<string, ProblemState>;
  order: string[];
}) {
  const best = final.best ? `最高解出${TIER_LABEL[final.best]}` : "一题没解出";
  const score = `得 ${final.score ?? "—"} 分`;
  if (ending === "cleared") {
    return (
      <p>
        <strong className="font-semibold">通关</strong>，选中的 {order.length} 题全部解出，{score}
      </p>
    );
  }
  if (ending === "eliminated" && final.eliminatedAt) {
    const p = state[final.eliminatedAt];
    return (
      <p>
        <strong className="font-semibold">止步{TIER_LABEL[p.tier]}</strong>，「{p.title}」{VERDICT_LABEL[p.verdict!]}，
        {best}，{score}。没测到的题按 0 分算
      </p>
    );
  }
  const failed = final.problems.at(-1)?.verdict === "error" ? final.problems.at(-1) : null;
  return (
    <p>
      <strong className="font-semibold">已结束</strong>，
      {failed ? `「${failed.title}」调用失败，没有计入满分` : "在你确认时停下"}。{best}，{score}
    </p>
  );
}

// ---------------------------------------------------------------- 编辑器

/** 模型写的代码逐段出现；交卷后换成提取出的代码 */
function Editor({ problem, fileName }: { problem: ProblemState | null; fileName: string }) {
  const box = useRef<HTMLDivElement>(null);
  const writing = problem?.phase === "writing";
  const code = problem ? problem.code || liveCode(problem.text ?? "") : "";
  const cut = problem?.verdict === "error" && !problem.code && (problem.errorKind === "network" || !!code);
  const thinking = writing && !code;

  useEffect(() => {
    if (writing && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [writing, code.length]);

  const lines = code ? code.split("\n") : [];
  const html = fileName.endsWith(".html");
  return (
    <section
      aria-label="模型写的代码"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface"
    >
      <div className="flex h-11 items-center gap-3 border-b border-line px-4 text-sm">
        <span className="-mb-px flex h-11 items-center border-b-2 border-ink font-mono text-[13px]">{fileName}</span>
        <span className="ml-auto truncate text-readout">
          {!problem
            ? "等待出题"
            : thinking
              ? "模型在思考"
              : writing
                ? "模型在写"
                : cut
                  ? "回答中断"
                  : problem.code
                    ? "已交卷"
                    : problem.verdict === "no_code"
                      ? "没有交卷"
                      : ""}
        </span>
        {problem?.writeAt && (
          <span className="font-mono text-xs text-readout tabular-nums">
            {writing ? <Elapsed from={problem.writeAt} /> : problem.latencyMs ? formatMs(problem.latencyMs) : null}
          </span>
        )}
      </div>
      <div
        ref={box}
        className="relative h-72 overflow-auto py-3 font-mono text-[13px] leading-[1.75] [font-variant-ligatures:none] sm:h-[28rem]"
      >
        {!problem && (
          <p className="px-5 font-sans text-sm text-faint">选好题点开始，模型写的代码会一段一段出现在这里。</p>
        )}
        {thinking && problem?.writeAt && (
          <p className="flex items-center gap-2 px-5 font-sans text-sm text-readout">
            <span className="size-1.5 rounded-full bg-blue motion-safe:animate-pulse" />
            模型在思考，已经 <Elapsed from={problem.writeAt} seconds />
          </p>
        )}
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-[3rem_1fr]">
            <span className="pr-4 text-right text-faint/70 select-none">{i + 1}</span>
            <span className="pr-4 whitespace-pre">
              <Highlighted line={line} html={html} />
              {writing && i === lines.length - 1 && (
                <span className="ml-px inline-block h-[1.05em] w-[0.55em] translate-y-[0.2em] bg-ink motion-safe:animate-pulse" />
              )}
            </span>
          </div>
        ))}
        {cut && (
          <div className="grid grid-cols-[3rem_1fr] text-amber">
            <span />
            <span>{code ? "── 连接在这里断开 ──" : "── 没有收到回答 ──"}</span>
          </div>
        )}
        {problem?.verdict === "no_code" && !code && (
          <p className="px-5 font-sans text-sm text-rose">{problem.detail}</p>
        )}
      </div>
    </section>
  );
}

const KEYWORDS = new Set(
  (
    "def return for in if else elif while import from as and or not continue break lambda True False None class pass " +
    "yield with try except finally raise global nonlocal is const let var function new this typeof instanceof switch " +
    "case default do of async await null undefined true false public private protected static void int long double " +
    "boolean char final package func type struct map range go defer chan interface select fallthrough throw throws " +
    "extends implements export"
  ).split(" "),
);

/** 够用的语法高亮：注释、字符串、数字、关键字、函数调用。用 React 节点渲染，不拼 HTML */
function Highlighted({ line, html }: { line: string; html: boolean }) {
  const re = html
    ? /(<!--.*?(?:-->|$))|("[^"]*"?|'[^']*'?)|(\b\d+(?:\.\d+)?\b)|(<\/?[A-Za-z][\w-]*)|([A-Za-z_$][\w$]*)/g
    : /(#.*$|\/\/.*$)|("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|`[^`]*`?)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const cls = m[1]
      ? "text-faint italic"
      : m[2]
        ? "text-mint"
        : m[3]
          ? "text-blue"
          : m[4]
            ? html
              ? "text-rose"
              : "text-violet"
            : KEYWORDS.has(m[5]) && !html
              ? "text-rose"
              : null;
    out.push(
      cls ? (
        <span key={m.index} className={cls}>
          {m[0]}
        </span>
      ) : (
        m[0]
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return <>{out}</>;
}

// ---------------------------------------------------------------- 判题面板

function JudgePanel({
  problem,
  paused,
  next,
  stage,
  onDecide,
}: {
  problem: ProblemState | null;
  paused: Pause;
  next: ProblemState | null;
  stage: RefObject<HTMLDivElement | null>;
  onDecide: (choice: "go" | "retry" | "stop") => void;
}) {
  const p = problem;
  const ui = p?.kind === "ui";
  const failedAt: "write" | "judge" | null =
    p?.verdict === "error" ? (p.errorKind === "judge" ? "judge" : "write") : null;
  const steps: Array<{ label: string; tone: Tone; time?: ReactNode }> = p
    ? [
        { label: "出题", tone: "ok" },
        {
          label: "模型作答",
          tone: p.phase === "writing" ? "run" : failedAt === "write" ? "warn" : p.verdict === "no_code" ? "bad" : "ok",
          time:
            p.phase === "writing" && p.writeAt ? (
              <Elapsed from={p.writeAt} />
            ) : p.latencyMs ? (
              formatMs(p.latencyMs)
            ) : undefined,
        },
        {
          label: ui ? "在浏览器里测试页面" : "运行隐藏测试",
          tone:
            p.phase === "judging" || p.phase === "browser"
              ? "run"
              : failedAt === "judge"
                ? "warn"
                : p.phase !== "done" || !p.code
                  ? "wait"
                  : p.verdict === "accepted"
                    ? "ok"
                    : "bad",
          time:
            (p.phase === "judging" || p.phase === "browser") && p.judgeAt ? (
              <Elapsed from={p.judgeAt} />
            ) : p.judgeMs ? (
              formatMs(p.judgeMs)
            ) : undefined,
        },
        {
          label: "判定",
          tone: p.phase !== "done" ? "wait" : p.verdict === "accepted" ? "ok" : p.verdict === "error" ? "warn" : "bad",
        },
      ]
    : [];

  const total = p?.totalTests ?? 0;
  const marks = p?.tests ?? [];
  const passed = marks.filter((m) => m.verdict === "accepted").length;
  const times = marks.filter((m) => m.verdict === "accepted" && m.ms !== undefined).map((m) => m.ms!);
  const slowest = times.length ? Math.max(...times) : null;

  return (
    <section
      aria-label="判题"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface"
    >
      <div className="flex h-11 items-center gap-3 border-b border-line px-4 text-sm">
        <h2 className="font-semibold">判题</h2>
        {p && (
          <span className="truncate text-readout">
            {TIER_LABEL[p.tier]}，{p.title}
          </span>
        )}
      </div>

      {!p && (
        <div className="flex flex-col gap-2 px-4 py-4 text-sm text-readout">
          <p>题目按青铜到王者的顺序一道一道出，答完一题才出下一题。</p>
          <p>每题满分是所在段位的分值；全部测试通过拿满分，部分通过按比例拿一半。</p>
          <p>答错立即停止。连不上模型、上游报错、判题服务不可用都不算答错，可以重试这一题。</p>
        </div>
      )}

      {p && (
        <ol className="py-1.5">
          {steps.map((s) => (
            <li
              key={s.label}
              className={cx(
                "grid grid-cols-[1.375rem_1fr_auto] items-center gap-2 px-4 py-2 text-sm",
                s.tone === "wait" && "text-faint",
                s.tone === "warn" && "text-amber",
              )}
            >
              <StateIcon tone={s.tone} />
              <span>{s.label}</span>
              <span className="font-mono text-xs text-readout tabular-nums">{s.time}</span>
            </li>
          ))}
        </ol>
      )}

      {/* 页面题的测试台：模型做的页面在这里被逐项操作，必须在可视区域里 */}
      <div
        className={cx(
          "relative mx-4 mb-3 ml-11.5 h-44 overflow-hidden rounded-lg border border-line bg-white",
          p?.phase !== "browser" && "hidden",
        )}
      >
        <div ref={stage} className="absolute inset-0" />
      </div>

      {p && total > 0 && p.verdict !== "error" && (
        <div className="px-4 pb-3 pl-11.5">
          <ol className="grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-1.5">
            {Array.from({ length: total }, (_, i) => (
              <TestCell key={i} index={i} mark={marks[i]} ui={ui} />
            ))}
          </ol>
          <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-readout">
            <span>
              通过 <strong className="font-semibold text-ink tabular-nums">{passed}</strong> / {total}
            </span>
            {!ui && (
              <span>
                最慢{" "}
                <strong className="font-semibold text-ink tabular-nums">
                  {slowest === null ? "—" : formatMs(slowest)}
                </strong>
              </span>
            )}
            {!ui && p.limit && (
              <span>
                时限 <strong className="font-semibold text-ink tabular-nums">{p.limit} 秒</strong>
              </span>
            )}
          </p>
        </div>
      )}

      {p?.phase === "done" && <Outcome problem={p} paused={paused} next={next} onDecide={onDecide} />}
    </section>
  );
}

function TestCell({ index, mark, ui }: { index: number; mark?: TestMark; ui: boolean }) {
  const v = mark?.verdict;
  const ok = v === "accepted";
  const bad = !!v && v !== "accepted" && v !== "running";
  return (
    <motion.li
      key={v ?? "none"}
      initial={ok || bad ? { rotateX: -80, opacity: 0.4 } : false}
      animate={{ rotateX: 0, opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={cx(
        "grid gap-px rounded-md border px-2 py-1.5 text-[11px]",
        !v && "border-line",
        v === "running" && "border-blue/60 bg-blue/6",
        ok && "border-mint/40 bg-mint/8",
        bad && "border-rose/50 bg-rose/6",
      )}
    >
      <span className="font-mono text-readout">#{String(index + 1).padStart(2, "0")}</span>
      <span
        className={cx(
          "truncate font-mono font-medium tabular-nums",
          ok && "text-mint",
          bad && "text-rose",
          !ok && !bad && "text-faint",
        )}
      >
        {!v
          ? "—"
          : v === "running"
            ? "…"
            : ok
              ? ui || mark?.ms === undefined
                ? "通过"
                : formatMs(mark.ms)
              : ui
                ? "没通过"
                : VERDICT_LABEL[v]}
      </span>
    </motion.li>
  );
}

/** 判定：过关、答错（不能重试）、调用失败（可以重试） */
function Outcome({
  problem: p,
  paused,
  next,
  onDecide,
}: {
  problem: ProblemState;
  paused: Pause;
  next: ProblemState | null;
  onDecide: (choice: "go" | "retry" | "stop") => void;
}) {
  const box = "mx-4 mb-4 flex flex-col gap-2 rounded-lg border p-3 text-sm";
  if (p.verdict === "error") {
    const fault = FAULT[p.errorKind ?? "network"];
    return (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className={cx(box, "border-amber/40 bg-amber/8")}
      >
        <p className="flex flex-wrap items-center gap-2 font-semibold text-amber">
          <span className="rounded border border-amber/60 px-1.5 py-0.5 text-[11px] font-medium">{fault.label}</span>
          调用失败，可以重试
        </p>
        {p.detail && (
          <p className="rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs break-all">
            {p.detail}
          </p>
        )}
        <p className="text-xs text-readout">{fault.why}这不算模型答错，不扣分、不淘汰。</p>
        {paused?.reason === "error" && (
          <div className="mt-1 flex items-center gap-2">
            <IconButton
              label="重试这一题"
              icon={<RotateCcw size={17} />}
              onClick={() => onDecide("retry")}
              tone="primary"
            />
            <IconButton label="结束段位赛" icon={<Square size={16} />} onClick={() => onDecide("stop")} />
            <span className="text-xs text-readout">重试这一题，或者结束并出成绩</span>
          </div>
        )}
      </motion.div>
    );
  }
  if (p.verdict === "accepted") {
    return (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className={cx(box, "border-mint/40 bg-mint/8")}
      >
        <p className="font-semibold text-mint">通过</p>
        <p>
          全部 {p.totalTests} {p.kind === "ui" ? "项检查" : "组测试"}都对，得 {TIER_WEIGHT[p.tier]} 分。
        </p>
        {paused?.reason === "next" && next && (
          <div className="mt-1 flex items-center gap-2">
            <IconButton
              label="继续下一题"
              icon={<Play size={16} fill="currentColor" />}
              onClick={() => onDecide("go")}
              tone="primary"
            />
            <IconButton label="到此为止，出成绩" icon={<Square size={16} />} onClick={() => onDecide("stop")} />
            <span className="text-xs text-readout">下一题是{TIER_LABEL[next.tier]}，继续吗？</span>
          </div>
        )}
      </motion.div>
    );
  }
  const pts = round1(scoreOf(p));
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cx(box, "border-rose/40 bg-rose/6")}
    >
      <p className="font-semibold text-rose">{VERDICT_LABEL[p.verdict!]}</p>
      {p.verdict === "no_code" ? (
        <p>{p.detail}</p>
      ) : (
        <p>
          {p.failedTest ? `第 ${p.failedTest} ${p.kind === "ui" ? "项" : "组"}起没通过，` : ""}通过 {p.passedTests}/
          {p.totalTests}，按比例得 {pts} 分。
        </p>
      )}
      {p.detail && p.verdict !== "no_code" && (
        <pre className="max-h-32 overflow-auto rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">
          {p.detail}
        </pre>
      )}
      <p className="text-xs text-readout">模型交了卷但没做对，不能重试。段位赛到这里结束，后面的题按 0 分算。</p>
    </motion.div>
  );
}

// ---------------------------------------------------------------- 小部件

function StateIcon({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      className={cx(
        "grid size-4 shrink-0 place-items-center rounded-full text-surface",
        tone === "wait" && "border-[1.5px] border-dashed border-faint",
        tone === "run" && "border-[1.5px] border-blue border-t-transparent motion-safe:animate-spin",
        tone === "ok" && "bg-mint",
        tone === "bad" && "bg-rose",
        tone === "warn" && "bg-amber",
      )}
    >
      {tone === "ok" && <Check size={10} strokeWidth={3.5} />}
      {tone === "bad" && <X size={10} strokeWidth={3.5} />}
      {tone === "warn" && <span className="text-[10px] leading-none font-bold">!</span>}
    </span>
  );
}

function Verdict({ entry: l }: { entry: LogEntry }) {
  const tone = l.verdict === "accepted" ? "bg-mint" : l.verdict === "error" ? "bg-amber" : "bg-rose";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-xs whitespace-nowrap",
        l.verdict === "error" && "text-amber",
      )}
    >
      <span className={cx("size-1.5 rounded-full", tone)} />
      {l.verdict === "error" ? `调用失败，${FAULT[l.errorKind ?? "network"].label}` : VERDICT_LABEL[l.verdict!]}
      {l.verdict === "accepted" && l.tries > 1 && <span className="text-readout">（第 {l.tries} 次）</span>}
    </span>
  );
}

/** 每半秒刷新一次的当前时间 */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

function Elapsed({
  from,
  to,
  clock,
  seconds,
}: {
  from: number;
  to?: number | null;
  clock?: boolean;
  seconds?: boolean;
}) {
  const now = useNow(!to);
  const s = Math.max(0, Math.floor(((to ?? now) - from) / 1000));
  if (clock) return <>{`${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`}</>;
  if (seconds) return <>{s} 秒</>;
  return <>{s}s</>;
}

// ---------------------------------------------------------------- 选题

function Picker({
  items,
  track,
  language,
  chosen,
  fullMarks,
  askEach,
  firstOfEach,
  onTrack,
  onLanguage,
  onToggle,
  onPick,
  onAskEach,
}: {
  items: ArenaCatalogItem[];
  track: ArenaTrack;
  language: ArenaLanguage;
  chosen: string[];
  fullMarks: number;
  askEach: boolean;
  firstOfEach: string[];
  onTrack: (t: ArenaTrack) => void;
  onLanguage: (l: ArenaLanguage) => void;
  onToggle: (id: string) => void;
  onPick: (ids: string[] | null) => void;
  onAskEach: (v: boolean) => void;
}) {
  const segment = (on: boolean) =>
    cx(
      "rounded-md px-3 py-1.5 text-sm transition",
      on ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.1)]" : "text-readout hover:text-ink",
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="赛道" className="flex rounded-lg bg-tint p-1">
          {(["algo", "frontend"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={track === t}
              onClick={() => onTrack(t)}
              className={segment(track === t)}
            >
              {TRACK_LABEL[t]}
            </button>
          ))}
        </div>
        {track === "algo" ? (
          <div className="flex items-center gap-1">
            <div role="radiogroup" aria-label="编程语言" className="flex rounded-lg bg-tint p-1">
              {ARENA_LANGUAGES.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={language === l}
                  onClick={() => onLanguage(l)}
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
              onClick={() => onLanguage(ARENA_LANGUAGES[Math.floor(Math.random() * ARENA_LANGUAGES.length)])}
            />
          </div>
        ) : (
          <span className="text-sm text-readout">JavaScript、HTML 和 CSS；页面题在你的浏览器里测试</span>
        )}
      </div>

      <div className="flex flex-col divide-y divide-line">
        {TIERS.map((tier) => (
          <div key={tier} className="grid items-stretch gap-2 py-2 sm:grid-cols-[4.5rem_1fr_1fr_1fr]">
            <span className="flex flex-col justify-center text-sm font-semibold">
              {TIER_LABEL[tier]}
              <span className="text-xs font-normal text-readout">每题 {TIER_WEIGHT[tier]} 分</span>
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
                      "flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition",
                      on ? "border-ink ring-1 ring-ink" : "border-line hover:bg-tint",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cx(
                        "grid size-3.5 shrink-0 place-items-center rounded border-[1.5px] text-surface",
                        on ? "border-ink bg-ink" : "border-faint",
                      )}
                    >
                      {on && <Check size={10} strokeWidth={3.5} />}
                    </span>
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-sm">
        <span>
          已选 <strong className="tabular-nums">{chosen.length}</strong> 题，满分{" "}
          <strong className="tabular-nums">{fullMarks}</strong> 分
        </span>
        <div className="flex items-center gap-1">
          {(
            [
              ["每档第一题", firstOfEach],
              ["全选", items.map((p) => p.id)],
              ["清空", []],
            ] as const
          ).map(([label, ids]) => (
            <button
              key={label}
              type="button"
              onClick={() => onPick(label === "每档第一题" ? null : [...ids])}
              className="rounded-md px-2.5 py-1 text-xs text-readout transition hover:bg-tint hover:text-ink"
            >
              {label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-readout select-none">
          <button
            type="button"
            role="switch"
            aria-checked={askEach}
            aria-label="每过一关暂停，由我决定是否继续"
            onClick={() => onAskEach(!askEach)}
            className={cx("relative h-4.5 w-7.5 shrink-0 rounded-full transition", askEach ? "bg-ink" : "bg-tint-2")}
          >
            <span
              className={cx(
                "absolute top-0.5 left-0.5 size-3.5 rounded-full bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform",
                askEach && "translate-x-3",
              )}
            />
          </button>
          每过一关暂停
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 明细

function Detail({
  entry: l,
  view,
  onView,
}: {
  entry: LogEntry;
  view: "page" | "code";
  onView: (v: "page" | "code") => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">{TIER_LABEL[l.tier]}</span>
        <Pill tone={l.verdict === "accepted" ? "pass" : l.verdict === "error" ? "warn" : "fail"}>
          {l.verdict === "error" ? `调用失败，${FAULT[l.errorKind ?? "network"].label}` : VERDICT_LABEL[l.verdict!]}
        </Pill>
        {l.verdict !== "error" && (
          <span className="text-readout tabular-nums">
            得 {round1(scoreOf(l))} / {TIER_WEIGHT[l.tier]} 分
          </span>
        )}
        {!!l.totalTests && l.verdict !== "error" && (
          <span className="text-readout">
            通过 {l.passedTests}/{l.totalTests} {l.kind === "ui" ? "项检查" : "组测试"}
          </span>
        )}
        {!!l.latencyMs && <span className="text-readout">作答用时 {formatMs(l.latencyMs)}</span>}
        {l.slowestMs !== undefined && <span className="text-readout">程序最慢一组 {formatMs(l.slowestMs)}</span>}
        {l.kind === "ui" && l.code && (
          <div className="ml-auto flex rounded-xl border border-line p-1">
            <IconButton
              label="看页面"
              size="sm"
              tone={view === "page" ? "default" : "ghost"}
              icon={<AppWindow size={16} />}
              onClick={() => onView("page")}
            />
            <IconButton
              label="看代码"
              size="sm"
              tone={view === "code" ? "default" : "ghost"}
              icon={<Code2 size={16} />}
              onClick={() => onView("code")}
            />
          </div>
        )}
      </div>
      {l.detail && (
        <pre
          className={cx(
            "max-h-48 overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap",
            l.verdict === "error" ? "bg-amber/8 text-amber" : "bg-rose/6 text-rose",
          )}
        >
          {l.detail}
        </pre>
      )}
      {l.code ? (
        l.kind === "ui" && view === "page" ? (
          // 模型写的页面只能放进隔离的 iframe：读不到本站数据，也不能联网
          <iframe
            title={`${l.title}：模型做的页面`}
            sandbox={SANDBOX}
            srcDoc={previewDoc(l.code)}
            className="h-[60vh] w-full rounded-lg border border-line bg-white"
          />
        ) : (
          <pre className="max-h-[60vh] overflow-auto rounded-lg bg-tint p-4 font-mono text-xs leading-relaxed [font-variant-ligatures:none]">
            {l.code}
          </pre>
        )
      ) : l.text ? (
        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-tint p-4 font-mono text-xs leading-relaxed [font-variant-ligatures:none]">
          {liveCode(l.text)}
        </pre>
      ) : null}
    </div>
  );
}
