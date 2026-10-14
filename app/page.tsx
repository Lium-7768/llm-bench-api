"use client";

import { ArrowLeft, Download, GitCompareArrows, Play, RotateCcw, Settings2, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { CheckEvent, StagePlan } from "@/lib/check";
import type { PelicanResult, Report, Stage } from "@/lib/types";
import { ConfigPanel } from "@/components/ConfigPanel";
import { missingConfig, useConfig } from "@/lib/web/config";
import { Pipeline, type PipelineStage, type StageStatus } from "@/components/Pipeline";
import { ReportView } from "@/components/Report";
import { FlowBar, StageLive, type LiveData } from "@/components/StageLive";
import { STAGE_INFO } from "@/components/StageIcon";
import { IconButton, IconLink, Modal, Panel } from "@/components/ui";
import { PRESETS } from "@/lib/presets";
import { compositeScore } from "@/lib/scoring";
import { analysisOf } from "@/lib/svg";
import { postApi, streamApi } from "@/lib/web/api";
import { addHistory, patchHistory } from "@/lib/web/storage";

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** 某一步的请求整体失败时，用来占位的空报告 */
function emptyReport(
  config: { model: string; protocol: Report["protocol"]; baseUrl: string },
  stages: Stage[],
): Report {
  return {
    id: "",
    model: config.model,
    protocol: config.protocol,
    host: originOf(config.baseUrl),
    startedAt: new Date().toISOString(),
    durationMs: 0,
    stages,
    score: null,
    errors: {},
  };
}

/** 把逐步请求得到的报告合成一份完整报告，综合分按合并后的结果重新计算 */
function mergeReports(parts: Report[], stages: Stage[], started: number): Report {
  const first = parts.find((p) => p.id) ?? parts[0];
  const merged: Report = {
    ...first,
    id: crypto.randomUUID(),
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    stages,
    errors: Object.assign({}, ...parts.map((p) => p.errors)),
  };
  for (const p of parts) {
    for (const s of stages) if (p[s]) Object.assign(merged, { [s]: p[s] });
  }
  merged.score = compositeScore(merged);
  return merged;
}

/** 鹈鹕完成后在管道节点上直接标出动态 / 静态 */
function pelicanCaption(p?: PelicanResult): string {
  if (!p?.svg) return "没出图";
  return analysisOf(p).animated ? "动态图" : "静态图";
}

const STAGES: Stage[] = ["detect", "basic", "candy", "inference", "pelican"];

interface Run {
  /** 本次要跑的步骤 */
  stages: Stage[];
  plans: StagePlan[];
  status: Partial<Record<Stage, StageStatus>>;
  scores: Partial<Record<Stage, number | null>>;
  errors: Partial<Record<Stage, string>>;
  current: Stage | null;
  stageStartedAt: number;
  live: LiveData;
}

const EMPTY_RUN: Run = {
  stages: [],
  plans: [],
  status: {},
  scores: {},
  errors: {},
  current: null,
  stageStartedAt: 0,
  live: { answers: {}, checks: {} },
};

export default function Home() {
  const { config } = useConfig();
  const [selected, setSelected] = useState<Stage[]>(STAGES);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [run, setRun] = useState<Run>(EMPTY_RUN);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    document.body.classList.toggle("is-running", phase === "running");
    if (phase !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [phase]);

  const handle = (e: CheckEvent) => {
    setRun((r) => {
      switch (e.type) {
        case "start":
          // 每一步单独请求，各自的 start 只带这一步的计划，逐个并入
          return { ...r, plans: [...r.plans.filter((p) => !e.stages.some((s) => s.id === p.id)), ...e.stages] };
        case "stage.start":
          return { ...r, current: e.stage, stageStartedAt: Date.now(), status: { ...r.status, [e.stage]: "active" } };
        case "answer":
          return { ...r, live: { ...r.live, answers: { ...r.live.answers, [e.answer.questionId]: e.answer } } };
        case "check":
          return { ...r, live: { ...r.live, checks: { ...r.live.checks, [e.check.id]: e.check } } };
        case "stage.done":
          return { ...r, status: { ...r.status, [e.stage]: "done" }, scores: { ...r.scores, [e.stage]: e.score } };
        case "stage.error":
          return { ...r, status: { ...r.status, [e.stage]: "error" }, errors: { ...r.errors, [e.stage]: e.message } };
        case "result":
          // 每一步都会收到 result；当前步骤留到全部跑完再清空，避免两步之间面板闪一下
          return { ...r, live: { ...r.live, pelican: e.result.pelican ?? r.live.pelican } };
      }
    });
  };

  const start = async () => {
    const missing = missingConfig(config);
    if (missing) {
      setError(missing);
      setConfigOpen(true);
      return;
    }
    if (!selected.length) return setError("至少选择一个步骤");

    setError(null);
    setConfigOpen(false);
    setReport(null);
    const stages = STAGES.filter((s) => selected.includes(s));
    setRun({ ...EMPTY_RUN, stages, status: Object.fromEntries(stages.map((s) => [s, "pending"])) });
    setStartedAt(Date.now());
    setNow(Date.now());
    setPhase("running");
    abort.current = new AbortController();

    // 每一步单独请求一次：每次请求都有完整的函数时限（Vercel 300 秒），
    // 思考很慢的模型不会因为前面的步骤用掉时间，让后面的步骤被跳过。seed 相同，题目和顺序不变。
    const signal = abort.current.signal;
    const started = Date.now();
    const parts: Report[] = [];
    const stamps: string[] = [];
    for (const stage of stages) {
      try {
        await streamApi<CheckEvent>(
          "/api/v1/check",
          config,
          { stages: [stage], limit: config.limit || undefined, seed: config.seed },
          (e) => {
            handle(e);
            if (e.type === "result") parts.push(e.result);
            if (e.type === "stage.done" && e.stamp) stamps.push(e.stamp);
          },
          signal,
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setPhase("idle");
          setError("检测已停止");
          return;
        }
        // 这一步的请求整体失败（网络中断、平台超时等），记为这一步失败，继续下一步
        // fetch 的网络错误是 TypeError，原文（Failed to fetch / Load failed）用户看不懂
        const message =
          e instanceof TypeError ? "和本站的连接中断了，这一步没有完成，可以再测一次" : (e as Error).message;
        handle({ type: "stage.error", stage, message });
        parts.push({ ...emptyReport(config, stages), errors: { [stage]: message } });
      }
    }

    setRun((r) => ({ ...r, current: null }));
    const merged = mergeReports(parts, stages, started);
    addHistory(merged);
    setReport(merged);
    setTimeout(() => setPhase("done"), 900);

    // 五步都有凭证、糖果全对时试着换解锁令牌；条件不满足或服务端没开彩蛋都不提示
    if (stamps.length === STAGES.length && merged.candy?.score === 100) {
      postApi<{ token: string; expiresAt: string }>("/api/v1/unlock", config, { stamps })
        .then((unlock) => {
          patchHistory(merged.id, { unlock });
          setReport((r) => (r?.id === merged.id ? { ...r, unlock } : r));
        })
        .catch(() => {});
    }
  };

  const exportReport = () => {
    if (!report) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    a.download = `llm-bench-${report.model}-${report.startedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // 管道节点状态
  const pipeline: PipelineStage[] = STAGES.map((id) => {
    if (phase === "idle") {
      const on = selected.includes(id);
      return { id, status: on ? "pending" : "off", progress: 0, caption: on ? "待检测" : "已跳过" };
    }
    const plan = run.plans.find((p) => p.id === id);
    if (!run.stages.includes(id)) return { id, status: "off", progress: 0, caption: "已跳过" };
    if (!plan) {
      // 还没轮到这一步的请求；失败时也可能一直没有计划
      const failed = run.status[id] === "error";
      return { id, status: failed ? "error" : "pending", progress: 0, caption: failed ? "未完成" : "等待中" };
    }
    const status = run.status[id] ?? "pending";
    const done =
      id === "detect"
        ? plan.items.filter((i) => run.live.checks[i.id]).length
        : id === "pelican"
          ? Number(status === "done")
          : plan.items.filter((i) => run.live.answers[i.id]).length;
    const caption =
      status === "active"
        ? id === "pelican"
          ? "作画中"
          : `${done}/${plan.total}`
        : status === "done"
          ? id === "pelican"
            ? pelicanCaption(run.live.pelican)
            : run.scores[id] === null
              ? "调用失败"
              : "完成"
          : status === "error"
            ? "未完成"
            : "等待中";
    return { id, status, progress: plan.total ? done / plan.total : 0, score: run.scores[id], caption };
  });

  const active = pipeline.filter((p) => p.status !== "off");
  const overall = active.length
    ? active.reduce(
        (s, p) => s + (p.status === "done" || p.status === "error" ? 1 : p.status === "active" ? p.progress : 0),
        0,
      ) / active.length
    : 0;
  const currentPlan = run.plans.find((p) => p.id === run.current);

  const configModal = (
    <Modal
      open={configOpen}
      onClose={() => setConfigOpen(false)}
      title="被测接口"
      icon={<Settings2 size={18} className="text-violet" />}
    >
      {error && <p className="mb-4 rounded-xl bg-rose/8 px-4 py-2.5 text-sm text-rose">{error}</p>}
      <ConfigPanel />
    </Modal>
  );

  if (phase === "idle") {
    const preset = PRESETS.find((p) => p.id === config.presetId);
    return (
      <div className="flex flex-col items-center">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
          className="max-w-3xl pt-6 pb-10 text-center sm:pt-12"
        >
          <h1 className="font-display text-4xl leading-[1.15] font-bold tracking-tight sm:text-6xl">
            给模型接口做一次全面体检
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-readout">
            按顺序跑完指纹检测、基础测试、糖果测试和鹈鹕测试，每一步走到哪里都看得见。支持 OpenAI
            兼容、Anthropic、Gemini 三种协议。
          </p>
        </motion.section>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
          className="w-full max-w-4xl"
        >
          <Panel className="p-5 sm:p-8">
            <Pipeline
              stages={pipeline}
              idle
              onToggle={(s) =>
                setSelected((prev) =>
                  prev.includes(s) ? prev.filter((x) => x !== s) : STAGES.filter((x) => x === s || prev.includes(x)),
                )
              }
            />
            <p className="mt-4 text-center text-xs text-faint">点击节点可以跳过或加入某一步</p>

            <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => setConfigOpen(true)}
                className="group flex min-w-0 flex-1 items-center gap-4 rounded-2xl border border-line bg-paper px-4 py-3 text-left transition hover:border-violet/40 hover:bg-surface"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-readout">{preset?.name ?? "自定义"}</span>
                  <span className="block truncate font-display text-lg">{config.model || "还没有选择模型"}</span>
                  <span className="block truncate text-xs text-faint">
                    {config.baseUrl || "点击配置接口地址和密钥"}
                  </span>
                </span>
                <Settings2
                  size={20}
                  className="shrink-0 text-readout transition duration-500 group-hover:rotate-90 group-hover:text-violet"
                  aria-label="配置接口"
                />
              </button>

              <motion.button
                type="button"
                onClick={start}
                aria-label="开始检测"
                title="开始检测"
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.94 }}
                className="relative mx-auto grid size-16 shrink-0 animate-flow place-items-center rounded-full spectrum-bg text-white shadow-[0_0_0_1px_rgb(255_255_255/0.35)_inset,0_14px_34px_-8px_rgb(124_58_237/0.65),0_0_44px_-12px_rgb(8_145_178/0.55)] sm:mx-0"
              >
                <span className="absolute inset-0 animate-ping rounded-full bg-violet/20 [animation-duration:2.4s]" />
                <Play size={26} fill="currentColor" className="relative ml-1" />
              </motion.button>
            </div>

            {error && <p className="mt-4 rounded-xl bg-rose/8 px-4 py-2.5 text-sm text-rose">{error}</p>}
          </Panel>
        </motion.div>

        <ul className="mt-10 grid w-full max-w-4xl gap-5 text-sm text-readout sm:grid-cols-2">
          {STAGES.map((s, i) => {
            const info = STAGE_INFO[s];
            return (
              <motion.li
                key={s}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.07 }}
                className="flex gap-3"
              >
                <info.Icon size={18} className={`mt-0.5 shrink-0 ${info.color}`} />
                <span>
                  <span className="text-ink">{info.name}</span>
                  <br />
                  {info.desc}
                </span>
              </motion.li>
            );
          })}
        </ul>
        {configModal}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.p
              key={phase === "running" ? (currentPlan?.id ?? "connect") : "done"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="flex items-center gap-2 text-sm text-blue"
            >
              {phase === "running" && (
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue opacity-60" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-blue" />
                </span>
              )}
              {phase === "running"
                ? currentPlan
                  ? `正在进行${STAGE_INFO[currentPlan.id].name}`
                  : "正在连接接口"
                : "检测完成"}
            </motion.p>
          </AnimatePresence>
          <h1 className="mt-1 spectrum-text font-display text-3xl font-bold break-all sm:text-4xl">{config.model}</h1>
        </div>
        {phase === "running" && (
          <div className="flex items-center gap-7">
            <Stat label="总进度" value={`${Math.round(overall * 100)}%`} />
            <Stat label="用时" value={`${((now - startedAt) / 1000).toFixed(1)}s`} />
            <IconButton
              label="停止检测"
              tone="danger"
              icon={<Square size={16} fill="currentColor" />}
              onClick={() => abort.current?.abort()}
            />
          </div>
        )}
      </div>

      <Panel className="p-5 sm:p-8">
        <Pipeline stages={pipeline} />
        {phase === "running" && (
          <div className="mt-6">
            <FlowBar value={overall} tall />
          </div>
        )}
      </Panel>

      <AnimatePresence mode="wait">
        {phase === "running" ? (
          <motion.div key="live" exit={{ opacity: 0, y: -12 }}>
            <Panel className="min-h-80 p-5 sm:p-8">
              <AnimatePresence mode="wait">
                {currentPlan ? (
                  <StageLive
                    key={currentPlan.id}
                    plan={currentPlan}
                    live={run.live}
                    elapsed={now - run.stageStartedAt}
                  />
                ) : (
                  <motion.p
                    key="wait"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="py-24 text-center text-readout"
                  >
                    {run.plans.length ? "全部步骤完成，正在生成报告" : "正在建立连接"}
                  </motion.p>
                )}
              </AnimatePresence>
            </Panel>
          </motion.div>
        ) : (
          report && (
            <motion.div key="report" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <ReportView
                report={report}
                actions={
                  <>
                    <IconButton
                      label="返回，重新选择步骤"
                      icon={<ArrowLeft size={18} />}
                      onClick={() => setPhase("idle")}
                    />
                    <IconButton label="再测一次" icon={<RotateCcw size={18} />} onClick={start} />
                    <IconButton
                      label="修改接口配置"
                      icon={<Settings2 size={18} />}
                      onClick={() => setConfigOpen(true)}
                    />
                    <IconButton label="导出报告 JSON" icon={<Download size={18} />} onClick={exportReport} />
                    <IconLink href="/compare" label="和其他模型对比" icon={<GitCompareArrows size={18} />} />
                  </>
                }
              />
            </motion.div>
          )
        )}
      </AnimatePresence>
      {configModal}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="text-xs text-readout">{label}</p>
      <p className="font-display text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
