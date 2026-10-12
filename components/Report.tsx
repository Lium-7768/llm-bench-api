"use client";

import { Code2, Maximize2 } from "lucide-react";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { CATEGORY_LABELS } from "@/lib/bank";
import type { AnswerResult, BenchResult, CheckStatus, DetectResult, PelicanResult, Report, Stage } from "@/lib/types";
import { STATUS_LABEL, VERDICT_LABEL, formatMs, formatTime, protocolLabel } from "@/lib/web/format";
import { Bar, ScoreDial, useCountUp } from "./Score";
import { STAGE_INFO, StageIcon } from "./StageIcon";
import { IconButton, Modal, Panel, Pill, cx } from "./ui";

const STATUS_TONE: Record<CheckStatus, "pass" | "warn" | "fail" | "muted"> = {
  pass: "pass",
  warn: "warn",
  fail: "fail",
  unsupported: "muted",
  error: "muted",
};

const VERDICT_TONE: Record<DetectResult["verdict"], "pass" | "warn" | "fail" | "muted"> = {
  clean: "pass",
  suspicious: "warn",
  tampered: "fail",
  inconclusive: "muted",
};

// ---------------------------------------------------------------- 鹈鹕图

/**
 * 以 <img> 渲染模型生成的 SVG：图片上下文里的 SVG 不会执行脚本，
 * 即使模型输出了恶意内容也是安全的。
 */
export function PelicanImage({ svg, className }: { svg: string | null; className?: string }) {
  if (!svg) return <span className="text-xs text-faint">回答里没有找到 SVG</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={cx("size-full animate-reveal bg-white object-contain p-3", className)}
      alt="模型绘制的鹈鹕骑自行车"
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
    />
  );
}

// ---------------------------------------------------------------- 报告

export function ReportView({ report, actions }: { report: Report; actions?: ReactNode }) {
  const [open, setOpen] = useState<Stage | null>(null);
  const { detect, basic, candy, pelican, errors } = report;

  return (
    <div className="flex flex-col gap-5">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <Panel className="relative overflow-hidden p-6 sm:p-8">
          <div className="pointer-events-none absolute -top-40 -left-32 size-[30rem] rounded-full bg-violet/10 blur-3xl" />
          <div className="relative flex flex-col items-center gap-8 sm:flex-row sm:items-center">
            <ScoreDial score={report.score} label="综合得分" size={210} />
            <div className="flex min-w-0 flex-1 flex-col gap-3 text-center sm:text-left">
              <p className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-readout sm:justify-start">
                <span>{protocolLabel(report.protocol)}</span>
                <span>{report.host}</span>
                <span>{formatTime(report.startedAt)}</span>
                <span>用时 {formatMs(report.durationMs)}</span>
              </p>
              <h1 className="font-display text-2xl font-semibold break-all sm:text-3xl">{report.model}</h1>
              <p className="text-sm text-readout">
                综合得分 = 指纹检测 30% + 基础测试 40% + 糖果测试 30%，鹈鹕测试不计分。
              </p>
              {actions && <div className="mt-1 flex justify-center gap-2 sm:justify-start">{actions}</div>}
            </div>
          </div>
        </Panel>
      </motion.div>

      {(Object.entries(errors) as Array<[Stage, string]>).map(([s, msg]) => (
        <p key={s} className="rounded-xl bg-rose/8 px-4 py-3 text-sm text-rose">
          {STAGE_INFO[s].name}没有完成：{msg}
        </p>
      ))}

      {/* 按容器宽度排列：页面里 4 列，弹窗里 2 列 */}
      <div className="@container">
        <div className="grid gap-4 @xl:grid-cols-2 @5xl:grid-cols-4">
          {report.stages.map((stage, i) => (
            <motion.div
              key={stage}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.08, duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <Tile stage={stage} onOpen={() => setOpen(stage)} disabled={!report[stage]}>
                {stage === "detect" && detect && (
                  <>
                    <BigNumber value={detect.score} unit="诚信分" />
                    <span className="self-start">
                      <Pill tone={VERDICT_TONE[detect.verdict]}>{VERDICT_LABEL[detect.verdict]}</Pill>
                    </span>
                    <div className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {detect.checks.map((c) => (
                        <span key={c.id} className="flex items-center gap-2 text-xs" title={c.detail}>
                          <i className={cx("size-2 shrink-0 rounded-full", DOT[c.status])} />
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {(stage === "basic" || stage === "candy") && report[stage] && (
                  <BenchTile result={report[stage]!} detailed={stage === "basic"} />
                )}
                {stage === "pelican" && pelican && (
                  <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-2xl border border-line">
                    <PelicanImage svg={pelican.svg} />
                  </div>
                )}
                {!report[stage] && <p className="m-auto text-sm text-faint">没有结果</p>}
              </Tile>
            </motion.div>
          ))}
        </div>
      </div>

      <Modal
        open={open === "detect"}
        onClose={() => setOpen(null)}
        title="指纹检测明细"
        icon={<StageIcon stage="detect" />}
        wide
      >
        {detect && <DetectDetail result={detect} />}
      </Modal>
      <Modal
        open={open === "basic"}
        onClose={() => setOpen(null)}
        title="基础测试明细"
        icon={<StageIcon stage="basic" />}
        wide
      >
        {basic && <BenchDetail result={basic} />}
      </Modal>
      <Modal
        open={open === "candy"}
        onClose={() => setOpen(null)}
        title="糖果测试明细"
        icon={<StageIcon stage="candy" />}
        wide
      >
        {candy && <BenchDetail result={candy} />}
      </Modal>
      <Modal
        open={open === "pelican"}
        onClose={() => setOpen(null)}
        title="鹈鹕测试"
        icon={<StageIcon stage="pelican" />}
      >
        {pelican && <PelicanDetail result={pelican} />}
      </Modal>
    </div>
  );
}

function BenchTile({ result, detailed }: { result: BenchResult; detailed: boolean }) {
  const scored = result.answers.filter((a) => !a.errored);
  return (
    <>
      <BigNumber value={result.score} unit="分" />
      <p className="text-xs text-readout">
        通过 {scored.filter((a) => a.passed).length} / {scored.length} 题
      </p>
      {detailed ? (
        <div className="mt-auto flex flex-col gap-2">
          {result.categories.map((c) => (
            <div key={c.category} className="grid grid-cols-[4.5rem_1fr_2rem] items-center gap-2 text-xs">
              <span className="text-readout">{c.label}</span>
              <Bar value={c.percent} />
              <span className="text-right tabular-nums">{Math.round(c.percent)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-auto grid grid-cols-6 gap-1.5">
          {result.answers.map((a) => (
            <span
              key={a.questionId}
              title={a.prompt}
              className={cx(
                "aspect-square rounded-md",
                a.errored
                  ? "bg-faint/50"
                  : a.passed
                    ? "bg-gradient-to-br from-blue to-cyan"
                    : "bg-gradient-to-br from-rose to-amber",
              )}
            />
          ))}
        </div>
      )}
    </>
  );
}

const DOT: Record<CheckStatus, string> = {
  pass: "bg-mint shadow-[0_0_6px_rgb(5_150_105/0.5)]",
  warn: "bg-amber shadow-[0_0_6px_rgb(217_119_6/0.5)]",
  fail: "bg-rose shadow-[0_0_6px_rgb(225_29_72/0.5)]",
  unsupported: "bg-faint/60",
  error: "bg-faint/60",
};

function Tile({
  stage,
  onOpen,
  disabled,
  children,
}: {
  stage: Stage;
  onOpen: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Panel className="flex h-full min-h-64 flex-col gap-3 p-5">
      <header className="flex items-center gap-2.5">
        <StageIcon stage={stage} />
        <h2 className="flex-1 font-semibold">{STAGE_INFO[stage].name}</h2>
        <IconButton
          label="查看明细"
          size="sm"
          tone="ghost"
          icon={<Maximize2 size={16} />}
          onClick={onOpen}
          disabled={disabled}
        />
      </header>
      {children}
    </Panel>
  );
}

function BigNumber({ value, unit }: { value: number | null; unit: string }) {
  const shown = useCountUp(value, 1400);
  return (
    <p className="flex items-baseline gap-2">
      <strong className="spectrum-text font-display text-4xl font-bold tabular-nums">
        {shown === null ? "—" : Math.round(shown)}
      </strong>
      <span className="text-xs text-readout">{unit}</span>
    </p>
  );
}

// ---------------------------------------------------------------- 明细（弹窗内容）

export function BenchDetail({ result }: { result: BenchResult }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {result.categories.map((c) => (
          <div key={c.category}>
            <div className="mb-1.5 flex justify-between text-sm">
              <span>{c.label}</span>
              <span className="text-readout tabular-nums">
                {Math.round(c.percent)} 分，{c.passed}/{c.total} 题
              </span>
            </div>
            <Bar value={c.percent} />
          </div>
        ))}
      </div>
      {result.failedCalls > 0 && (
        <p className="rounded-xl bg-amber/12 px-4 py-2.5 text-sm text-amber">
          {result.failedCalls} 题调用失败，没有计入得分。
        </p>
      )}
      {result.error && <p className="rounded-xl bg-rose/12 px-4 py-2.5 text-sm text-rose">{result.error}</p>}
      <AnswerList answers={result.answers} />
      <p className="text-xs text-faint">
        题库 {result.bankVersion}，随机种子 {result.seed}
      </p>
    </div>
  );
}

export function AnswerList({ answers }: { answers: AnswerResult[] }) {
  return (
    <ol className="divide-y divide-line border-y border-line">
      {answers.map((a) => (
        <li key={a.questionId}>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
              <Pill tone={a.errored ? "muted" : a.passed ? "pass" : "fail"}>
                {a.errored ? "失败" : a.passed ? "通过" : "答错"}
              </Pill>
              <span className="shrink-0 text-xs text-faint">{CATEGORY_LABELS[a.category]}</span>
              <span className="min-w-0 flex-1 truncate text-readout group-hover:text-ink">{a.prompt}</span>
              <span className="text-xs text-faint tabular-nums">{a.latencyMs ? formatMs(a.latencyMs) : ""}</span>
            </summary>
            <div className="flex flex-col gap-2 pb-4">
              <pre className="max-h-72 overflow-auto rounded-xl border border-line bg-paper p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {a.output || "（没有回答）"}
              </pre>
              {a.reason && <p className={cx("text-xs", a.errored ? "text-rose" : "text-readout")}>{a.reason}</p>}
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

export function DetectDetail({ result }: { result: DetectResult }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Pill tone={VERDICT_TONE[result.verdict]}>{VERDICT_LABEL[result.verdict]}</Pill>
        <span className="text-sm text-readout">
          诚信分 {result.score ?? "—"}，用时 {formatMs(result.durationMs)}
        </span>
      </div>
      <ul className="divide-y divide-line border-y border-line">
        {result.checks.map((c) => (
          <li key={c.id} className="grid grid-cols-[4.5rem_1fr_auto] items-start gap-3 py-3.5">
            <Pill tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Pill>
            <div className="min-w-0">
              <p className="font-medium">{c.name}</p>
              <p className="mt-0.5 text-xs break-words text-readout">{c.detail}</p>
            </div>
            <span className="text-xs text-faint tabular-nums">{c.latencyMs ? formatMs(c.latencyMs) : ""}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-faint">「不支持」和「未完成」的项不参与打分。</p>
    </div>
  );
}

export function PelicanDetail({ result }: { result: PelicanResult }) {
  const [code, setCode] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-2xl border border-line">
        <PelicanImage svg={result.svg} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-readout">
          用时 {formatMs(result.durationMs)}
          {result.usage?.outputTokens ? `，${result.usage.outputTokens} tokens` : ""}
        </span>
        <IconButton
          label={code ? "收起源码" : "查看源码"}
          icon={<Code2 size={17} />}
          onClick={() => setCode((v) => !v)}
        />
      </div>
      {code && (
        <pre className="max-h-80 overflow-auto rounded-xl border border-line bg-paper p-3.5 font-mono text-xs whitespace-pre-wrap">
          {result.svg ?? result.raw}
        </pre>
      )}
    </div>
  );
}
