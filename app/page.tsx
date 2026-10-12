"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type CategoryInfo } from "@/lib/client";

export default function Home() {
  const [health, setHealth] = useState<{ status: string; totalQuestions: number } | null>(null);
  const [cats, setCats] = useState<CategoryInfo[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.health(), api.categories()])
      .then(([h, c]) => {
        setHealth(h);
        setCats(c.categories);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  const totalQ = health?.totalQuestions ?? 0;
  const totalMax = cats.reduce((s, c) => s + c.maxScore, 0);

  return (
    <>
      <h1>大模型能力评测 API</h1>
      <p className="lead">
        一套面向开发者的评测接口：把任意 OpenAI 兼容模型的地址和密钥发过来，拿回结构化的能力评分。
        本站前端不参与任何计算，所有数字都来自 <code>/api/v1/*</code> 的返回。
      </p>

      {err && <div className="card err">接口异常：{err}</div>}

      <div className="grid cols-3">
        <div className="card">
          <div className="muted small">服务状态</div>
          <div className="stat">
            {health ? (
              <span className="badge ok">{health.status}</span>
            ) : (
              <span className="badge muted">检测中…</span>
            )}
          </div>
        </div>
        <div className="card">
          <div className="muted small">题库总量</div>
          <div className="stat">{totalQ}</div>
          <div className="muted small">满分 {totalMax} 分</div>
        </div>
        <div className="card">
          <div className="muted small">评测维度</div>
          <div className="stat">{cats.length}</div>
          <div className="muted small">覆盖推理 / 代码 / 幻觉等</div>
        </div>
      </div>

      <h2>评测维度</h2>
      <div className="grid cols-3">
        {cats.map((c) => (
          <div className="card" key={c.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{c.label}</strong>
              <span className="badge muted">{c.totalQuestions} 题</span>
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              <code>{c.id}</code> · 满分 {c.maxScore} · 难度{" "}
              {c.difficulties.join("/")}
            </div>
          </div>
        ))}
        {cats.length === 0 && !err && <div className="card muted">加载中…</div>}
      </div>

      <h2>快速开始</h2>
      <div className="card">
        <p className="muted small" style={{ marginTop: 0 }}>
          发起一次评测只需要一个 POST：
        </p>
        <pre className="code">{`curl -X POST https://your-app.vercel.app/api/v1/runs \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $YOUR_MODEL_API_KEY" \\
  -d '{
    "model": "gpt-4o-mini",
    "baseUrl": "https://api.openai.com/v1",
    "limit": 10
  }'`}</pre>
        <div className="row" style={{ marginTop: 14 }}>
          <Link href="/run">
            <button>在网页里试一次</button>
          </Link>
          <Link href="/docs">
            <button className="ghost">查看完整 API 文档</button>
          </Link>
        </div>
      </div>

      <h2>能力一览</h2>
      <div className="grid cols-2">
        {[
          { t: "能力评测", d: "POST /api/v1/runs —— 逐题作答并按维度聚合得分、耗时与 token 用量。" },
          { t: "可复现选题", d: "同一 seed 得到同一套题，便于横向对比不同模型或同一模型的不同时间点。" },
          { t: "幻觉抵抗", d: "内置被改过数字的熟题与不存在文献题，识别模型是背答案还是真推理。" },
          { t: "接口指纹", d: "POST /api/v1/detect —— 检测偷换模型、吞 system prompt、伪流式、剥离 usage。" },
          { t: "排行榜", d: "GET /api/v1/leaderboard —— 按模型聚合历史评测，输出平均分排名。" },
          { t: "OpenAPI", d: "GET /api/v1/openapi —— 机器可读描述，可直接生成客户端。" },
        ].map((f) => (
          <div className="card" key={f.t}>
            <strong>{f.t}</strong>
            <div className="muted small" style={{ marginTop: 4 }}>
              {f.d}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
