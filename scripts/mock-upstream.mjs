/**
 * 本地模拟上游：同时实现 OpenAI 兼容、Anthropic Messages、Gemini 三种协议，
 * 没有真实密钥也能把四个步骤完整跑一遍，用于开发界面和排查流程。
 *
 * 用法：
 *   pnpm mock                     # 监听 4555 端口
 *   SLOW=1 pnpm mock              # 每次响应随机延迟 0.3–2.5 秒，便于观察动效
 *   EGG=1 pnpm mock               # 糖果题全答对，跑完五步能解锁编程彩蛋（服务端要配置 LLMBENCH_SECRET）
 *   ALLOW_PRIVATE_BASE_URL=true pnpm dev
 * 然后在页面里选「自定义 / 中转站」，地址填 http://127.0.0.1:4555/v1，密钥随意，
 * 协议选 Anthropic 时密钥需填 k。
 *
 * 故意留下的瑕疵，用来验证判分和检测是否生效：
 * - 「激光笔」那道糖果题回答 0（正确答案是 10），会被判错；EGG=1 时答对
 * - 自报身份是 Claude，用其他模型名测试时「身份自报」会显示存疑
 * - Anthropic 协议不支持工具调用，会显示「不支持」；响应声明的模型固定是 gpt-4o，用 claude 模型名测试时会判为换模型
 * - Gemini 协议的流式一次性返回，会判为假流式
 * - 鹈鹕图：OpenAI / Gemini 协议返回纯 SVG 静态图；Anthropic 协议返回包在代码块里的动态图（SMIL 转动车轮）
 * - 编程彩蛋：只会 Python，黄金档（修祖传代码）只答对一题，所以段位是白银；其他语言交一段打招呼的程序，青铜就过不去。
 *   代码真的交给 Judge0 公共实例运行，需要联网
 */
import http from "node:http";

const PORT = Number(process.env.PORT ?? 4555);

const ANSWERS = [
  [/鸡和兔共 35 只，脚共 94/, "鸡=23,兔=12"],
  [/2, 6, 12/, "42"],
  [/只有一人说真话/, "B"],
  [/第 48 天/, "47"],
  [/小明比小红高/, "小美<小刚<小红<小明"],
  [/2022 年的营收/, "1000"],
  [/上升还是下降/, "下降"],
  [/哪一天完成/, "09-03"],
  [/is_prime/, "0,1"],
  [/x\*2/, "[0, 2, 4]"],
  [/a\.length/, "4"],
  [
    /orders/,
    "SELECT user_id, SUM(amount) AS total FROM orders WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01' GROUP BY user_id ORDER BY total DESC",
  ],
  [/429/, "Too Many Requests"],
  [/SYN\+ACK/, "ACK"],
  [/rebase/, "rebase"],
  [/脚共 96/, "鸡=22,兔=13"],
  [
    /38 分/,
    "女儿分不清红绿，说明她是红绿色盲。红绿色盲是伴 X 染色体隐性遗传，她的两个致病 X 必须有一个来自父亲，所以父亲也应是色盲；可父亲能分辨颜色，矛盾——他不是她的亲生父亲。",
  ],
  [/红楼梦/, "曹雪芹"],
  [/Quantum Banana/, "不存在"],
  [/10 颗糖/, "无解"],
  [/激光笔/, process.env.EGG ? "10" : "0"],
  [/strawberrry/, "4"],
  [/今天天气很好/, "The weather is nice today"],
  [/7 个汉字/, "中国首都是北京"],
  [/JSON 对象/, '{"name":"bench","version":1}'],
  [/暗号是什么/, "海棠-4821"],
  [/什么模型/, "我是 Claude，由 Anthropic 开发"],
  [/从 1 数到 40/, Array.from({ length: 40 }, (_, i) => i + 1).join(" ")],
  [
    /pelican/i,
    `<svg viewBox="0 0 200 150"><circle cx="60" cy="115" r="25" fill="none" stroke="#333" stroke-width="4"/><circle cx="145" cy="115" r="25" fill="none" stroke="#333" stroke-width="4"/><path d="M60 115 L100 80 L145 115 M100 80 L95 60" stroke="#333" stroke-width="4" fill="none"/><ellipse cx="100" cy="55" rx="28" ry="18" fill="#f5f5f5" stroke="#333" stroke-width="3"/><circle cx="125" cy="38" r="10" fill="#f5f5f5" stroke="#333" stroke-width="3"/><path d="M133 40 L170 48 L133 46 Z" fill="#f4a300"/></svg>`,
  ],
];

/** 给车轮加上 SMIL 旋转，并包一层代码块 */
const animatedPelican = (svg) =>
  "```svg\n" +
  svg.replace(
    /<circle cx="(\d+)" cy="(\d+)" r="25"([^>]*)\/>/g,
    (_, cx, cy, rest) =>
      `<g><circle cx="${cx}" cy="${cy}" r="25"${rest}/><path d="M${cx} ${Number(cy) - 25} V${Number(cy) + 25}" stroke="#333" stroke-width="2"/><animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="1s" repeatCount="indefinite"/></g>`,
  ) +
  "\n```";

/** 编程彩蛋的参考答案，按题目标题查 */
const PY_SOLUTIONS = {
  回文句子: String.raw`s=[c.lower() for c in input() if c.isascii() and c.isalnum()]
print("YES" if s==s[::-1] else "NO")`,
  第二大的数: String.raw`import sys
d=sys.stdin.read().split();n=int(d[0]);v=sorted(set(map(int,d[1:1+n])))
print(v[-2] if len(v)>1 else "NONE")`,
  行程编码: String.raw`from itertools import groupby
print("".join(k+str(len(list(g))) for k,g in groupby(input().strip())))`,
  两数之和计数: String.raw`import sys
from collections import Counter
d=sys.stdin.read().split();n,k=int(d[0]),int(d[1]);c=Counter(map(int,d[2:2+n]))
t=0
for x,a in c.items():
    y=k-x
    if x<y: t+=a*c.get(y,0)
    elif x==y: t+=a*(a-1)//2
print(t)`,
  合并区间: String.raw`import sys
d=list(map(int,sys.stdin.read().split()));n=d[0];iv=sorted(zip(d[1:2*n+1:2],d[2:2*n+2:2]));out=[]
for l,r in iv:
    if out and l<=out[-1][1]: out[-1][1]=max(out[-1][1],r)
    else: out.append([l,r])
print(len(out));print("\n".join(f"{l} {r}" for l,r in out))`,
  最长不重复片段: String.raw`s=input().strip();seen={};l=b=0
for i,c in enumerate(s):
    if seen.get(c,-1)>=l: l=seen[c]+1
    seen[c]=i;b=max(b,i-l+1)
print(b)`,
  祖传背包: String.raw`import sys
d=list(map(int,sys.stdin.read().split()));n,W=d[0],d[1];NEG=-1;b=[0]+[NEG]*W
for i in range(n):
    w,v=d[2+2*i],d[3+2*i]
    for c in range(W,w-1,-1):
        if b[c-w]>=0 and b[c-w]+v>b[c]: b[c]=b[c-w]+v
print(b[W])`,
};

const arena = (text) => {
  const m = text.match(/^请用 (\S+) 解决下面的题目[\s\S]*?\n# (.+)\n/);
  if (!m) return null;
  const code = m[1] === "Python" && PY_SOLUTIONS[m[2]];
  return code ? "```python\n" + code + "\n```" : "```\nprint('hello')\n```";
};

const reply = (text, system) =>
  system?.includes("ZEBRA") ? "ZEBRA-7749" : (arena(text) ?? ANSWERS.find(([re]) => re.test(text))?.[1] ?? "好");

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/** 按间隔逐条写出 SSE 事件，模拟真实的流式输出 */
const stream = (res, events) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  let i = 0;
  const timer = setInterval(() => {
    if (i >= events.length) {
      clearInterval(timer);
      return res.end();
    }
    res.write(events[i++]);
  }, 30);
};

http
  .createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const url = req.url ?? "";
    if (process.env.SLOW) await new Promise((r) => setTimeout(r, 300 + Math.random() * 2200));

    // 模型列表
    if (url.endsWith("/models") || url.includes("/models?")) {
      return send(
        res,
        200,
        url.includes("v1beta")
          ? { models: [{ name: "models/gemini-mock", supportedGenerationMethods: ["generateContent"] }] }
          : { data: [{ id: "gpt-4o" }, { id: "mock-model" }] },
      );
    }

    // OpenAI 兼容
    if (url.endsWith("/chat/completions")) {
      const system = body.messages.find((m) => m.role === "system")?.content;
      const text = reply(body.messages.at(-1).content, system);
      if (body.stream) {
        return stream(res, [
          ...text.split(" ").map((w) => `data: ${JSON.stringify({ choices: [{ delta: { content: w + " " } }] })}\n\n`),
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 9 } })}\n\n`,
          "data: [DONE]\n\n",
        ]);
      }
      const toolCalls = body.tools
        ? [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"北京"}' } }]
        : undefined;
      return send(res, 200, {
        model: body.model,
        choices: [{ message: { content: toolCalls ? null : text, tool_calls: toolCalls } }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      });
    }

    // Anthropic Messages
    if (url.endsWith("/v1/messages")) {
      if (req.headers["x-api-key"] !== "k") return send(res, 401, { error: { message: "invalid x-api-key" } });
      if (body.tools) return send(res, 400, { error: { message: "tools: not supported by this relay" } });
      const last = body.messages.at(-1).content;
      const text = /pelican/i.test(last) ? animatedPelican(reply(last)) : reply(last, body.system);
      if (body.stream) {
        return stream(res, [
          `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 7 } } })}\n\n`,
          ...text
            .split(" ")
            .map(
              (w) =>
                `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: w + " " } })}\n\n`,
            ),
          `data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 11 } })}\n\n`,
        ]);
      }
      return send(res, 200, {
        model: "gpt-4o",
        content: [{ type: "text", text }],
        usage: { input_tokens: 5, output_tokens: 3 },
      });
    }

    // Gemini
    if (url.includes(":generateContent") || url.includes(":streamGenerateContent")) {
      const text = reply(body.contents.at(-1).parts[0].text, body.systemInstruction?.parts[0].text);
      if (url.includes("stream")) {
        return stream(res, [`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`]);
      }
      const parts = body.tools
        ? [{ functionCall: { name: "get_weather", args: { city: "北京" } } }]
        : [{ text: "思考过程", thought: true }, { text }];
      return send(res, 200, {
        modelVersion: "gemini-mock",
        candidates: [{ content: { parts } }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
      });
    }

    send(res, 404, { error: { message: `mock 没有实现 ${url}` } });
  })
  .listen(PORT, () => console.log(`模拟上游已启动：http://127.0.0.1:${PORT}/v1`));
