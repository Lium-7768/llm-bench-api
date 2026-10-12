"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type RunSummary } from "@/lib/client";

export default function RunsPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () =>
    api
      .listRuns(50)
      .then((d) => setRuns(d.runs))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  async function remove(id: string) {
    try {
      await api.deleteRun(id);
      setRuns((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <h1>历史记录</h1>
      <p className="lead">
        来自 <code>GET /api/v1/runs</code>。注意：服务端使用内存存储，Vercel 冷启动后会清空；
        生产环境建议接入 Vercel KV 或 Postgres。
      </p>

      {err && <div className="card err">{err}</div>}

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="ghost" onClick={load}>
          刷新
        </button>
        <Link href="/run">
          <button>新建评测</button>
        </Link>
      </div>

      <div className="card">
        {loading ? (
          <div className="muted">加载中…</div>
        ) : runs.length === 0 ? (
          <div className="muted">暂无记录。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>模型</th>
                <th>总分</th>
                <th>状态</th>
                <th>耗时</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="muted small">
                    {new Date(r.createdAt).toLocaleString("zh-CN")}
                  </td>
                  <td>
                    <div>{r.configuredModel}</div>
                    <div className="muted small mono">{r.baseUrl}</div>
                  </td>
                  <td>
                    <strong>{r.score ?? "-"}</strong>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        r.status === "succeeded"
                          ? "ok"
                          : r.status === "failed"
                            ? "bad"
                            : "warn"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="muted small">
                    {r.totalLatencyMs ? `${(r.totalLatencyMs / 1000).toFixed(1)}s` : "-"}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Link href={`/runs/${r.id}`}>
                        <button className="ghost">详情</button>
                      </Link>
                      <button className="ghost" onClick={() => remove(r.id)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
