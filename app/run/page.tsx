"use client";

import { useEffect, useState } from "react";
import { api, type AnswerView, type CategoryInfo } from "@/lib/client";

export default function RunPage() {
  const [cats, setCats] = useState<CategoryInfo[]>([]);
  const [model, setModel] = useState("gpt-4o-mini");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [limit, setLimit] = useState(21);
  const [seed, setSeed] = useState(42);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<
    | (Awaited<ReturnType<typeof api.createRun>>)
    | null
  >(null);

  useEffect(() => {
    api
      .categories()
      .then((c) => setCats(c.categories))
      .catch((e: Error) => setErr(e.message));
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  async function submit() {
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.createRun({
        model,
        baseUrl,
        apiKey,
        limit,
        seed,
        categories: selected.length ? selected : undefined,
      });
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const answers: AnswerView[] = result?.answers ?? [];

  return (
    <>
      <h1>发起评测</h1>
      <p className="lead">
        密钥只在本次请求中转发给上游模型，服务端不会写入任何存储。评测结果会保存在内存中供查询。
      </p>

      <div className="card">
        <div className="grid cols-2">
          <div>
            <label>模型名（model）</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div>
            <label>接口地址（baseUrl，需 OpenAI 兼容）</label>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <div>
            <label>API Key</label>
            <input
              type="password"
              value={apiKey}
              placeholder="sk-..."
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="row" style={{ gap: 14 }}>
            <div style={{ flex: 1 }}>
              <label>题目数量</label>
              <input
                type="number"
                value={limit}
                min={1}
                max={50}
                onChange={(e) => setLimit(Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label>随机种子</label>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label>限定维度（不选则测全部）</label>
          <div className="row">
            {cats.map((c) => (
              <button
                key={c.id}
                className={selected.includes(c.id) ? "" : "ghost"}
                onClick={() => toggle(c.id)}
                type="button"
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button onClick={submit} disabled={loading || !apiKey || !model || !baseUrl}>
            {loading ? "评测中…（可能需要 1-2 分钟）" : "开始评测"}
          </button>
          {loading && <span className="muted small">正在逐题请求上游模型，请勿关闭页面</span>}
        </div>
        {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
      </div>

      {result && (
        <>
          <h2>评测结果</h2>
          <div className="grid cols-3">
            <div className="card">
              <div className="muted small">总分</div>
              <div className="stat">{result.score ?? "-"}</div>
              <div className="muted small">满分 100</div>
            </div>
            <div className="card">
              <div className="muted small">状态</div>
              <div style={{ marginTop: 8 }}>
                <span className={`badge ${result.status === "succeeded" ? "ok" : "bad"}`}>
                  {result.status}
                </span>
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>
                {result.totalLatencyMs ? `总耗时 ${(result.totalLatencyMs / 1000).toFixed(1)}s` : ""}
              </div>
            </div>
            <div className="card">
              <div className="muted small">记录 ID</div>
              <div className="mono small" style={{ marginTop: 8, wordBreak: "break-all" }}>
                {result.id}
              </div>
            </div>
          </div>

          {result.error && <div className="card err">{result.error}</div>}

          <div className="card">
            <h2 style={{ marginTop: 0 }}>维度得分</h2>
            {result.categories.map((c) => (
              <div key={c.category} style={{ marginBottom: 12 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span>{c.label}</span>
                  <span className="muted small">
                    {c.percent}% · {c.passed}/{c.total} 题
                  </span>
                </div>
                <div className="bar">
                  <i style={{ width: `${c.percent}%` }} />
                </div>
              </div>
            ))}
            {result.categories.length === 0 && (
              <div className="muted">没有可聚合的维度数据。</div>
            )}
          </div>

          <h2>逐题明细</h2>
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
                <span style={{ whiteSpace: "pre-wrap" }}>
                  {a.output || "（空）"}
                </span>
              </div>
              {a.error && <div className="err small">判分说明：{a.error}</div>}
            </div>
          ))}
        </>
      )}
    </>
  );
}
