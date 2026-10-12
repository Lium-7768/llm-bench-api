"use client";

import { useState } from "react";
import { api, type DetectResult } from "@/lib/client";

const VERDICT_LABEL: Record<DetectResult["verdict"], { text: string; cls: string }> = {
  clean: { text: "接口正常", cls: "ok" },
  suspicious: { text: "存在可疑信号", cls: "warn" },
  tampered: { text: "疑似被改动", cls: "bad" },
};

export default function DetectPage() {
  const [model, setModel] = useState("gpt-4o-mini");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<DetectResult | null>(null);

  async function submit() {
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      setResult(await api.detect({ model, baseUrl, apiKey }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const v = result ? VERDICT_LABEL[result.verdict] : null;

  return (
    <>
      <h1>接口指纹检测</h1>
      <p className="lead">
        专门用来检查 API 中转站有没有动手脚：是否偷换模型、是否丢掉 system prompt、是否假流式、是否剥离 token 用量。
        对应接口 <code>POST /api/v1/detect</code>。
      </p>

      <div className="card">
        <div className="grid cols-2">
          <div>
            <label>你请求的模型</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div>
            <label>接口地址（baseUrl）</label>
            <input
              value={baseUrl}
              placeholder="https://your-relay.com/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
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
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <button onClick={submit} disabled={loading || !baseUrl || !apiKey || !model}>
            {loading ? "检测中…" : "开始检测"}
          </button>
          <span className="muted small">共 4 项探测，约 10-30 秒</span>
        </div>
        {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
      </div>

      {result && v && (
        <>
          <h2>检测结论</h2>
          <div className="card">
            <div className="row" style={{ gap: 12 }}>
              <span className={`badge ${v.cls}`} style={{ fontSize: 13, padding: "5px 14px" }}>
                {v.text}
              </span>
              <span className="muted small">{result.explanation}</span>
            </div>
            <div className="muted small" style={{ marginTop: 8 }}>
              检测时间 {new Date(result.detectedAt).toLocaleString("zh-CN")}
            </div>
          </div>

          <h2>逐项信号</h2>
          <table>
            <thead>
              <tr>
                <th>检查项</th>
                <th>结果</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {result.signals.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>
                    <span className={`badge ${s.ok ? "ok" : "bad"}`}>
                      {s.ok ? "通过" : "异常"}
                    </span>
                  </td>
                  <td className="muted small">{s.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
