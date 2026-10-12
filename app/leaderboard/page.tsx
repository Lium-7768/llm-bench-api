"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type LeaderboardEntry } from "@/lib/client";

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [basedOn, setBasedOn] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api
      .leaderboard()
      .then((d) => {
        setEntries(d.leaderboard);
        setBasedOn(d.basedOnRuns);
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <h1>模型排行榜</h1>
      <p className="lead">
        数据由 <code>GET /api/v1/leaderboard</code> 聚合历史评测得到，按「模型 + 接口地址」分组取平均分。
      </p>

      {err && <div className="card err">{err}</div>}

      <div className="card">
        {loading ? (
          <div className="muted">加载中…</div>
        ) : entries.length === 0 ? (
          <div className="muted">
            还没有成功的评测记录。先去{" "}
            <Link href="/run">发起一次评测</Link>，这里就会有排名了。
          </div>
        ) : (
          <>
            <div className="muted small" style={{ marginBottom: 10 }}>
              基于 {basedOn} 次成功评测聚合
            </div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>模型</th>
                  <th>平均分</th>
                  <th>最高分</th>
                  <th>次数</th>
                  <th>平均耗时</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={`${e.model}@${e.baseUrl}`}>
                    <td>
                      <span className={`badge ${e.rank === 1 ? "ok" : "muted"}`}>
                        {e.rank}
                      </span>
                    </td>
                    <td>
                      <div>{e.model}</div>
                      <div className="muted small mono">{e.baseUrl}</div>
                    </td>
                    <td>
                      <strong>{e.avgScore}</strong>
                    </td>
                    <td>{e.bestScore}</td>
                    <td>{e.runs}</td>
                    <td className="muted">
                      {e.avgLatencyMs ? `${(e.avgLatencyMs / 1000).toFixed(1)}s` : "-"}
                    </td>
                    <td>
                      <button
                        className="ghost"
                        onClick={() =>
                          setExpanded(
                            expanded === `${e.model}@${e.baseUrl}`
                              ? null
                              : `${e.model}@${e.baseUrl}`,
                          )
                        }
                      >
                        {expanded === `${e.model}@${e.baseUrl}` ? "收起" : "维度"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {expanded && (
              <div style={{ marginTop: 16 }}>
                {entries
                  .filter((e) => `${e.model}@${e.baseUrl}` === expanded)
                  .map((e) => (
                    <div key={e.model}>
                      <strong className="small">{e.model} 各维度表现</strong>
                      {e.categories.map((c) => (
                        <div key={c.category} style={{ marginTop: 10 }}>
                          <div className="row" style={{ justifyContent: "space-between" }}>
                            <span className="small">{c.label}</span>
                            <span className="muted small">{c.avgPercent}%</span>
                          </div>
                          <div className="bar">
                            <i style={{ width: `${c.avgPercent}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
