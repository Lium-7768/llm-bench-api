/**
 * 冒烟测试：对已启动的服务跑一遍不需要真实模型密钥的检查。
 * 用法：BASE_URL=http://localhost:3000 node scripts/smoke.mjs
 */
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

const checks = [
  [
    "首页可以打开",
    async () => {
      const res = await fetch(`${BASE}/`);
      expect(res.status === 200, `HTTP ${res.status}`);
      expect((await res.text()).includes("LLM Bench"), "页面里没有 LLM Bench");
    },
  ],
  [
    "API 索引列出三种协议和五个步骤",
    async () => {
      const { data } = await json("GET", "/api/v1", 200);
      expect(data.protocols?.length === 3, `protocols=${JSON.stringify(data.protocols)}`);
      expect(data.stages?.join() === "detect,basic,candy,colorblind,pelican", `stages=${JSON.stringify(data.stages)}`);
    },
  ],
  [
    "题库默认不带答案",
    async () => {
      const { data } = await json("GET", "/api/v1/questions", 200);
      expect(data.total > 0, "题库为空");
      expect(!("expected" in data.questions[0]), "默认返回了答案");
    },
  ],
  [
    "OpenAPI 文档可用",
    async () => {
      const { data } = await json("GET", "/api/v1/openapi", 200);
      expect(data.openapi === "3.1.0" && data.paths?.["/check"], "缺少 /check 描述");
    },
  ],
  [
    "缺少密钥返回 401",
    async () => {
      const body = await json("POST", "/api/v1/check", 401, { baseUrl: "https://api.openai.com/v1", model: "x" });
      expect(body.error?.code === "missing_api_key", body.error?.code);
    },
  ],
  [
    "拒绝指向内网的地址",
    async () => {
      const body = await json("POST", "/api/v1/check", 400, {
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "x",
        apiKey: "k",
      });
      expect(body.error?.code === "unsafe_base_url", body.error?.code);
    },
  ],
  [
    "拒绝未知步骤",
    async () => {
      const body = await json("POST", "/api/v1/check", 400, {
        protocol: "openai",
        model: "x",
        apiKey: "k",
        stages: ["nope"],
      });
      expect(body.error?.code === "invalid_stage", body.error?.code);
    },
  ],
  [
    "跨域预检通过",
    async () => {
      const res = await fetch(`${BASE}/api/v1/check`, { method: "OPTIONS" });
      expect(res.status === 204 && res.headers.get("access-control-allow-origin") === "*", `HTTP ${res.status}`);
    },
  ],
];

function expect(cond, message) {
  if (!cond) throw new Error(message || "断言失败");
}

async function json(method, path, status, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  expect(res.status === status, `期望 HTTP ${status}，实际 ${res.status}：${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name}：${e.message}`);
  }
}
console.log(failed ? `\n${failed} 项失败` : `\n全部 ${checks.length} 项通过`);
process.exit(failed ? 1 : 0);
