import { PRESETS, PROTOCOL_LABELS } from "@/lib/presets";

export const metadata = { title: "API 接入 — LLM Bench" };

const ENDPOINTS = [
  ["POST", "/api/v1/check", "全面检测：指纹 → 基础 → 糖果 → 鹈鹕，按顺序执行。默认同步返回报告；stream=true 时以 SSE 推送进度"],
  ["POST", "/api/v1/models", "列出被测接口可用的模型"],
  ["GET", "/api/v1/questions", "题库，?category= 过滤，?withAnswers=true 带答案"],
  ["GET", "/api/v1", "索引与健康检查"],
  ["GET", "/api/v1/openapi", "OpenAPI 3.1 描述"],
];

const CURL_BENCH = `curl -X POST https://<本站域名>/api/v1/check \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \\
  -d '{
    "baseUrl": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
    "seed": 42
  }'`;

const CURL_ANTHROPIC = `# 只跑指纹检测；只给 protocol 时使用官方地址
curl -X POST https://<本站域名>/api/v1/check \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \\
  -d '{ "protocol": "anthropic", "model": "<claude 模型 ID>", "stages": ["detect"] }'`;

const JS_STREAM = `const res = await fetch("https://<本站域名>/api/v1/check", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: \`Bearer \${apiKey}\`,
  },
  body: JSON.stringify({ baseUrl, model, stream: true }),
});

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split("\\n\\n");
  buffer = frames.pop();
  for (const frame of frames) {
    const data = frame.split("\\n").find((l) => l.startsWith("data:"));
    if (!data) continue;
    const event = JSON.parse(data.slice(5));
    // start → stage.start → answer / check … → stage.done → 下一步 … → result
    if (event.type === "stage.start") console.log("进入", event.stage);
    if (event.type === "answer") console.log(\`\${event.stage} \${event.done}/\${event.total}\`, event.answer.passed);
    if (event.type === "check") console.log(event.check.name, event.check.status);
    if (event.type === "result") console.log("综合得分", event.result.score);
  }
}`;

const PY_SYNC = `import requests

r = requests.post(
    "https://<本站域名>/api/v1/check",
    headers={"Authorization": f"Bearer {api_key}"},
    json={"baseUrl": "https://api.moonshot.cn/v1", "model": "<模型 ID>", "stages": ["detect", "basic", "candy"]},
    timeout=300,
)
body = r.json()
if not body["ok"]:
    raise RuntimeError(body["error"]["message"])
report = body["data"]
print(report["score"], report["basic"]["score"], report["candy"]["score"], report["detect"]["verdict"])`;

const RESPONSE = `{
  "ok": true,
  "data": {
    "id": "6f1c…",
    "model": "deepseek-chat",
    "stages": ["detect", "basic", "candy", "pelican"],
    "score": 91.2,                 // 综合分 = 指纹 30% + 基础 40% + 糖果 30%
    "detect": { "score": 94, "verdict": "clean", "checks": [ … ] },
    "basic": {
      "score": 87.5,               // 只按成功作答的题计算
      "failedCalls": 0,            // 调用失败、未计分的题数
      "categories": [{ "category": "reasoning", "label": "逻辑推理", "percent": 88.9, "passed": 4, "total": 5 }],
      "answers": [{ "questionId": "reason-001", "output": "鸡=23,兔=12", "passed": true, "latencyMs": 812 }]
    },
    "candy": { "score": 83.3, … },  // 结构同 basic
    "pelican": { "svg": "<svg …>…</svg>", "raw": "…" },
    "errors": {}                   // 某一步失败或被跳过的原因
  },
  "error": null
}`;

export default function DocsPage() {
  return (
    <article className="docs">
      <div>
        <div>
          <h1>API 接入</h1>
          <p className="lead">
            网页上的每个功能都是调用下面这些公开接口实现的，你的程序可以直接调用同样的接口。服务端无状态：
            不保存结果，不保存密钥，密钥只在单次请求中转发给被测接口。
          </p>
        </div>
      </div>

      <section>
        <h2>接口</h2>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {ENDPOINTS.map(([m, p, d]) => (
                <tr key={p}>
                  <td>
                    <span className={`method ${m.toLowerCase()}`}>{m}</span>
                  </td>
                  <td className="mono">{p}</td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>通用参数</h2>
        <p>所有 POST 接口都通过以下字段指定被测接口：</p>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              <tr>
                <td className="mono">Authorization</td>
                <td>请求头 <code>Bearer &lt;被测接口的 API Key&gt;</code>，也可用 <code>X-Api-Key</code> 头或 body 里的 <code>apiKey</code></td>
              </tr>
              <tr>
                <td className="mono">protocol</td>
                <td>
                  {Object.entries(PROTOCOL_LABELS).map(([k, v], i) => (
                    <span key={k}>
                      {i > 0 && " / "}
                      <code>{k}</code>（{v}）
                    </span>
                  ))}
                  。不填时按地址推断，默认 openai
                </td>
              </tr>
              <tr>
                <td className="mono">baseUrl</td>
                <td>被测接口地址，例如 <code>https://api.deepseek.com/v1</code>。只写域名时 OpenAI 协议会自动补 <code>/v1</code></td>
              </tr>
              <tr>
                <td className="mono">model</td>
                <td>模型 ID（<code>/models</code> 接口不需要）</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <code>/check</code> 另有 <code>stages</code>（detect 指纹检测、basic 基础测试、candy 糖果测试、pelican 鹈鹕测试，默认全部，按这个顺序执行）、
          <code>limit</code>（基础测试题量）、<code>seed</code>（默认 42，相同则题目和顺序相同）、<code>temperature</code>、
          <code>concurrency</code>（1-8，默认 3）、<code>timeoutMs</code>（单题超时）、<code>stream</code>。
        </p>
        <p>所有 JSON 响应都是 <code>{"{ ok, data, error }"}</code> 信封，失败时 <code>error.code</code> 为机器可读的错误码。</p>
      </section>

      <section>
        <h2>示例</h2>
        <h3>同步调用（curl）</h3>
        <pre className="code">{CURL_BENCH}</pre>
        <h3>响应</h3>
        <pre className="code">{RESPONSE}</pre>
        <h3>中转站检测 Claude 官方接口</h3>
        <pre className="code">{CURL_ANTHROPIC}</pre>
        <h3>流式进度（JavaScript）</h3>
        <p>
          <code>stream: true</code> 时返回 <code>text/event-stream</code>：先推送 <code>start</code>（含四步的计划），然后每一步依次推送
          <code>stage.start</code>、若干 <code>answer</code> 或 <code>check</code>、<code>stage.done</code>，最后一个是 <code>result</code>。
        </p>
        <pre className="code">{JS_STREAM}</pre>
        <h3>Python</h3>
        <pre className="code">{PY_SYNC}</pre>
      </section>

      <section>
        <h2>常用服务商</h2>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {PRESETS.filter((p) => p.baseUrl).map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <code>{p.protocol}</code>
                  </td>
                  <td className="mono">{p.baseUrl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">其他服务只要兼容这三种协议之一（包括各类中转站），填对地址就能用。</p>
      </section>

      <section>
        <h2>限制</h2>
        <ul>
          <li>单次请求最长 300 秒，四步按顺序执行，超时的步骤会被跳过并记在 <code>errors</code> 里。上游慢时用 <code>limit</code> 减少题量，或用 <code>stages</code> 只跑需要的步骤。</li>
          <li>调用失败（超时、上游报错）的题不计入得分，单独计数在 <code>failedCalls</code>。</li>
          <li>出于安全考虑，不允许把 <code>baseUrl</code> 指向 localhost 或内网地址。</li>
        </ul>
      </section>
    </article>
  );
}
