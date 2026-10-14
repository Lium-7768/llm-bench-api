"use client";

import { Check, ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { CATEGORY_LABELS, QUESTIONS } from "@/lib/bank";
import { DETECT_CHECKS } from "@/lib/detect";
import type { BenchResult, Report } from "@/lib/types";
import { PelicanImage } from "@/components/Report";
import { IconButton, Modal, Panel, Pill, cx } from "@/components/ui";
import { STATUS_LABEL, formatMs, formatTime, hasError } from "@/lib/web/format";
import { useHistory } from "@/lib/web/storage";

const MAX = 4;
const STATUS_TONE = { pass: "pass", warn: "warn", fail: "fail", unsupported: "muted", error: "muted" } as const;

export default function ComparePage() {
  const all = useHistory();
  // 带报错的报告结果不完整，不参与对比
  const history = useMemo(() => all?.filter((r) => !hasError(r)) ?? null, [all]);
  const excluded = (all?.length ?? 0) - (history?.length ?? 0);
  // 用户点选过才记录；之前默认选中每个模型最近的一次
  const [picked, setPicked] = useState<string[] | null>(null);
  const [matrix, setMatrix] = useState(false);
  const defaults = useMemo(() => {
    const seen = new Set<string>();
    const picks: string[] = [];
    for (const r of history ?? []) {
      if (picks.length >= 3) break;
      if (seen.has(r.model)) continue;
      seen.add(r.model);
      picks.push(r.id);
    }
    return picks;
  }, [history]);
  const selected = picked ?? defaults;

  const runs = selected.map((id) => history?.find((r) => r.id === id)).filter((r): r is Report => !!r);
  const toggle = (id: string) =>
    setPicked((prev) => {
      const cur = prev ?? defaults;
      return cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX ? cur : [...cur, id];
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">模型对比</h1>
          <p className="mt-2 text-sm text-readout">
            从历史报告里挑最多 {MAX} 份并排比较，每行最高分会被点亮。
            {excluded > 0 && `有 ${excluded} 份报告带报错，没有列出。`}
          </p>
        </div>
        <IconButton
          label="逐题对比"
          icon={<ListChecks size={18} />}
          onClick={() => setMatrix(true)}
          disabled={!runs.some((r) => r.basic || r.candy)}
        />
      </div>

      {history !== null && history.length === 0 && (
        <Panel className="py-16 text-center text-readout">
          {excluded > 0
            ? "现有报告都带报错，没有可以对比的。修好接口后重新检测几次。"
            : "还没有报告。先去「检测」页跑几个模型。"}
        </Panel>
      )}

      {!!history?.length && (
        <div className="flex flex-wrap gap-2">
          {history.map((r) => {
            const on = selected.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(r.id)}
                className={cx(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition",
                  on
                    ? "border-violet/70 bg-violet/15 shadow-[0_0_20px_-8px_rgb(139_92_246/0.9)]"
                    : "border-line text-readout hover:text-ink",
                )}
              >
                <span
                  className={cx(
                    "grid size-4 place-items-center rounded",
                    on ? "spectrum-bg text-white" : "ring-1 ring-line",
                  )}
                >
                  {on && <Check size={12} strokeWidth={3} />}
                </span>
                {r.model}
                <span className="text-xs text-faint">{formatTime(r.startedAt)}</span>
              </button>
            );
          })}
        </div>
      )}

      {runs.length > 0 && <CompareTables runs={runs} />}

      <Modal
        open={matrix}
        onClose={() => setMatrix(false)}
        title="逐题对比"
        icon={<ListChecks size={18} className="text-violet" />}
        wide
      >
        <QuestionMatrix runs={runs} />
      </Modal>
    </div>
  );
}

function Head({ runs }: { runs: Report[] }) {
  return (
    <thead>
      <tr className="bg-tint">
        <th className="px-4 py-3" />
        {runs.map((r) => (
          <th key={r.id} className="px-4 py-3 text-left font-medium">
            {r.model}
            <span className="block text-xs font-normal text-faint">{formatTime(r.startedAt)}</span>
          </th>
        ))}
      </tr>
    </thead>
  );
}

function ScoreRow({
  label,
  values,
  runs,
}: {
  label: string;
  values: Array<number | null | undefined>;
  runs: Report[];
}) {
  const nums = values.map((v) => (typeof v === "number" ? v : null));
  const max = Math.max(...nums.map((v) => v ?? -1));
  const distinct = new Set(nums).size > 1;
  return (
    <tr className="border-t border-line">
      <th className="px-4 py-3 text-left font-normal whitespace-nowrap text-readout">{label}</th>
      {nums.map((v, i) => {
        const best = distinct && v !== null && v === max;
        return (
          <td
            key={runs[i].id}
            className={cx(
              "px-4 py-3 font-display tabular-nums",
              best && "bg-gradient-to-r from-violet/20 to-transparent",
            )}
          >
            <span className={best ? "spectrum-text font-bold" : ""}>{v === null ? "—" : Math.round(v)}</span>
          </td>
        );
      })}
    </tr>
  );
}

function CompareTables({ runs }: { runs: Report[] }) {
  const benches = (r: Report) => [r.basic, r.candy, r.inference].filter((b): b is BenchResult => !!b);
  const categories = [...new Set(runs.flatMap((r) => benches(r).flatMap((b) => b.categories.map((c) => c.category))))];
  const seeds = new Set(runs.flatMap((r) => benches(r).map((b) => `${b.seed}/${b.bankVersion}`)));

  return (
    <>
      {seeds.size > 1 && (
        <p className="rounded-xl bg-amber/12 px-4 py-2.5 text-sm text-amber">
          所选报告的随机种子或题库版本不同，题目不完全一致，对比仅供参考。
        </p>
      )}
      <Panel className="overflow-x-auto">
        <table className="w-full text-sm">
          <Head runs={runs} />
          <tbody>
            <ScoreRow label="综合得分" values={runs.map((r) => r.score)} runs={runs} />
            <ScoreRow label="指纹检测" values={runs.map((r) => r.detect?.score)} runs={runs} />
            <ScoreRow label="基础测试" values={runs.map((r) => r.basic?.score)} runs={runs} />
            <ScoreRow label="糖果测试" values={runs.map((r) => r.candy?.score)} runs={runs} />
            {categories.map((c) => (
              <ScoreRow
                key={c}
                label={CATEGORY_LABELS[c]}
                values={runs.map(
                  (r) =>
                    benches(r)
                      .flatMap((b) => b.categories)
                      .find((x) => x.category === c)?.percent,
                )}
                runs={runs}
              />
            ))}
            <tr className="border-t border-line">
              <th className="px-4 py-3 text-left font-normal text-readout">用时</th>
              {runs.map((r) => (
                <td key={r.id} className="px-4 py-3 tabular-nums">
                  {formatMs(r.durationMs)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </Panel>

      {runs.some((r) => r.detect) && (
        <Panel className="overflow-x-auto">
          <table className="w-full text-sm">
            <Head runs={runs} />
            <tbody>
              {DETECT_CHECKS.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <th className="px-4 py-3 text-left font-normal whitespace-nowrap text-readout">{c.name}</th>
                  {runs.map((r) => {
                    const x = r.detect?.checks.find((k) => k.id === c.id);
                    return (
                      <td key={r.id} className="px-4 py-3" title={x?.detail}>
                        {x ? (
                          <Pill tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Pill>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {runs.some((r) => r.pelican) && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {runs.map((r) => (
            <Panel key={r.id} className="p-3">
              <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-2xl border border-line bg-paper">
                {r.pelican ? (
                  <PelicanImage svg={r.pelican.svg} />
                ) : (
                  <span className="text-xs text-faint">没有绘图</span>
                )}
              </div>
              <p className="mt-2.5 truncate px-1 text-sm">{r.model}</p>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

function QuestionMatrix({ runs }: { runs: Report[] }) {
  const answersOf = (r: Report) => [
    ...(r.basic?.answers ?? []),
    ...(r.candy?.answers ?? []),
    ...(r.inference?.answers ?? []),
  ];
  const ids = [...new Set(runs.flatMap((r) => answersOf(r).map((a) => a.questionId)))];
  const prompts = new Map(QUESTIONS.map((q) => [q.id, q.prompt]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <Head runs={runs} />
        <tbody>
          {ids.map((id) => (
            <tr key={id} className="border-t border-line">
              <th className="max-w-xs px-4 py-2.5 text-left font-normal text-readout" title={prompts.get(id)}>
                <span className="block truncate">{prompts.get(id) ?? id}</span>
              </th>
              {runs.map((r) => {
                const a = answersOf(r).find((x) => x.questionId === id);
                return (
                  <td key={r.id} className="px-4 py-2.5" title={a?.output}>
                    {!a ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <Pill tone={a.errored ? "muted" : a.passed ? "pass" : "fail"}>
                        {a.errored ? "失败" : a.passed ? "通过" : "答错"}
                      </Pill>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
