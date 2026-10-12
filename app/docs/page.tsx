"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

interface Endpoint {
  method: string;
  path: string;
  desc: string;
}

const EXAMPLES: Array<{ title: string; code: string }> = [
  {
    title: "发起一次评测",
    code: `curl -X POST http://localhost:3000/api/v1/runs \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $MODEL_API_KEY" \\
  -d '{
    "model": "gpt-4o-mini",
    "baseUrl": "https://api.openai.com/v1",
    "limit": 10,
    "categories": ["reasoning", "coding"],
    "seed": 42
  }'`,
  },
  {
    title: "只取分数（不返回逐题明细）",
    code: `curl -X POST http://localhost:3000/api/v1/runs \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $MODEL_API_KEY" \\
  -d '{"model":"deepseek-chat","baseUrl":"https://api.deepseek.com/v1","includeAnswers":false}'`,
  },
  {
    title: "用裁判模型给主观题打分",
    code: `curl -X POST http://localhost:3000/api/v1/runs \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $MODEL_API_KEY" \\
  -d '{
    "model": "qwen-plus",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "judge": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "model": "gpt-4o"
    }
  }'`,
  },
  {
    title: "中转站指纹检测",
    code: `curl -X POST http://localhost:3000/api/v1/detect \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $RELAY_API_KEY" \\
  -d '{"model":"gpt-4o","baseUrl":"https://your-relay.com/v1"}'`,
  },
  {
    title: "查询题库（不含答案）",
    code: `curl "http://localhost:3000/api/v1/questions?category=hallucination"`,
  },
  {
    title: "查看排行榜",
    code: `curl http://localhost:3000/api/v1/leaderboard`,
  },
];

export default function DocsPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [meta, setMeta] = useState<{ version: string; engineVersion: string; bankVersion: string; totalQuestions: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .index()
      .then((d) => {
        setEndpoints(d.endpoints);
        setMeta({
          version: d.version,
          engineVersion: d.engineVersion,
          bankVersion: d.bankVersion,
          totalQuestions: d.totalQuestions,
        });
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  return (
    <>
      <h1>API 文档</h1>
      <p className="lead">
        接口列表直接来自 <code>GET /api/v1</code> 的返回，机器可读版本在{" "}
        <a href="/api/v1/openapi" target="_blank" rel="noreferrer">
          /api/v1/openapi
        </a>
        。
      </p>

      {err && <div className="card err">{err}</div>}

      {meta && (
        <div className="grid cols-3">
          <div className="card">
            <div className="muted small">API 版本</div>
            <div>{meta.version}</div>
          </div>
          <div className="card">
            <div className="muted small">引擎 / 题库版本</div>
            <div>
              {meta.engineVersion} / {meta.bankVersion}
            </div>
          </div>
          <div className="card">
            <div className="muted small">题库总量</div>
            <div>{meta.totalQuestions}</div>
          </div>
        </div>
      )}

      <h2>接口列表</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>方法</th>
              <th>路径</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((e) => (
              <tr key={`${e.method}${e.path}`}>
                <td>
                  <span
                    className={`badge ${
                      e.method === "GET" ? "ok" : e.method === "DELETE" ? "bad" : "warn"
                    }`}
                  >
                    {e.method}
                  </span>
                </td>
                <td className="mono small">{e.path}</td>
                <td className="muted small">{e.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>认证方式</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          本站不提供共享密钥，而是由调用方自带<strong>上游模型</strong>的密钥，服务端仅做转发：
        </p>
        <pre className="code">{`Authorization: Bearer <你的模型 API Key>`}</pre>
        <p className="muted small" style={{ marginBottom: 0 }}>
          也支持 <code>x-api-key</code> 请求头或请求体里的 <code>apiKey</code> 字段。密钥不会被写入响应、日志或存储。
        </p>
      </div>

      <h2>响应格式</h2>
      <div className="card">
        <p className="muted small" style={{ marginTop: 0 }}>
          所有接口统一返回信封结构，方便程序解析：
        </p>
        <pre className="code">{`{
  "ok": true,
  "data": { ... },
  "error": null
}

// 出错时
{
  "ok": false,
  "data": null,
  "error": { "code": "missing_api_key", "message": "缺少 API Key" }
}`}</pre>
      </div>

      <h2>调用示例</h2>
      {EXAMPLES.map((ex) => (
        <div className="card" key={ex.title}>
          <strong>{ex.title}</strong>
          <pre className="code" style={{ marginTop: 10 }}>
            {ex.code}
          </pre>
        </div>
      ))}

      <h2>常见问题</h2>
      <div className="card">
        <p>
          <strong>支持哪些模型？</strong>
          <br />
          <span className="muted small">
            任何 OpenAI 兼容的 <code>/chat/completions</code> 接口，包括 OpenAI、DeepSeek、Kimi、
            通义千问、豆包、Gemini（兼容模式）、Grok，以及各家中转站。
          </span>
        </p>
        <p>
          <strong>为什么主观题会 0 分？</strong>
          <br />
          <span className="muted small">
            标记为 <code>rubric</code> 的主观题需要裁判模型评分。不传 <code>judge</code> 参数时，
            这些题会记为 0 分并在判分说明里注明原因，不会静默算错。
          </span>
        </p>
        <p>
          <strong>数据会持久保存吗？</strong>
          <br />
          <span className="muted small">
            默认使用进程内存，Vercel 冷启动会清空。需要长期保存请把 <code>lib/store.ts</code> 换成
            Vercel KV / Postgres / Upstash，接口签名保持不变即可。
          </span>
        </p>
        <p style={{ marginBottom: 0 }}>
          <strong>为什么禁止指向内网地址？</strong>
          <br />
          <span className="muted small">
            防止 API 被用来探测内网（SSRF）。localhost、10.x、192.168.x、172.16-31.x 一律拒绝。
          </span>
        </p>
      </div>
    </>
  );
}
