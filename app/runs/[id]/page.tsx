"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type RunDetail } from "@/lib/client";

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [onlyFailed, setOnlyFailed] = useState(false);

  useEffect(() => {
    api
      .getRun(id)
      .then(setRun)
      .catch((e: Error) => setErr(e.message));
  }, [id]);

  if (err) return <div className="card err" style={{ marginTop: 24 }}>{err}</div>;
  if (!run) return <div className="muted" style={{ marginTop: 24 }}>加载中…</div>;

  const answers = onlyFailed ? run.answers.filter((a) => !a.passed) : run.answers;

  return (
    <>
      <h1>评测详情</h1>
      <p className="lead mono">{run.id}</p>

      <div className="grid cols-3">
        <div className="card">
          <div className="muted small">总分</div>
          <div className="stat">{run.score ?? "-"}</div>
        </div>
        <div className="card">
          <div className="muted small">模型</div>
          <div style={{ marginTop: 6 }}>{run.configuredModel}</div>
          <div className="muted small mono">{run.baseUrl}</div>
        </div>
        <div className="card">
          <div className="muted small">状态 / 耗时</div>
          <div style={{ marginTop: 6 }}>
            <span className={`badge ${run.status === "succeeded" ? "ok" : "bad"}`}>
              {run.status}
            </span>{" "}
            <span className="muted small">
              {run.totalLatencyMs ? `${(run.totalLatencyMs / 1000).toFixed(1)}s` : ""}
            </span>
          </div>
        </div>
      </div>

      {run.error && <div className="card err">{run.error}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>维度得分</h2>
        {run.categories.map((c) => (
          <div key={c.category} style={{ marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>{c.label}</span>
              <span className="muted small">
                {c.percent}% · {c.passed}/{c.total}
              </span>
            </div>
            <div className="bar">
              <i style={{ width: `${c.percent}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>逐题明细</h2>
        <div className="row">
          <button
            className={onlyFailed ? "" : "ghost"}
            onClick={() => setOnlyFailed((v) => !v)}
          >
            {onlyFailed ? "显示全部" : "只看未通过"}
          </button>
          <Link href="/runs">
            <button className="ghost">返回列表</button>
          </Link>
        </div>
      </div>

      {answers.map((a) => (
        <div className="card" key={a.questionId}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="mono small muted">{a.questionId}</span>
            <span className="row" style={{ gap: 8 }}>
              <span className="badge muted">{a.latencyMs}ms</span>
              <span className={`badge ${a.passed ? "ok" : "bad"}`}>
                {a.passed ? "通过" : "未通过"} {a.score}/{a.weight}
              </span>
            </span>
          </div>
          <div className="small" style={{ margin: "8px 0" }}>
            <span className="muted">题目：</span>
            <span style={{ whiteSpace: "pre-wrap" }}>{a.prompt}</span>
          </div>
          <div className="small" style={{ margin: "8px 0" }}>
            <span className="muted">回答：</span>
            <span style={{ whiteSpace: "pre-wrap" }}>{a.output || "（空）"}</span>
          </div>
          {a.error && <div className="err small">判分说明：{a.error}</div>}
        </div>
      ))}
      <div className="muted small">
        引擎 {run.meta.engineVersion} · 题库 {run.meta.bankVersion} · 共 {run.questionIds.length} 题
      </div>
    </>
  );
}
