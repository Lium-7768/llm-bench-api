# LLM Bench

给任意大模型接口做一次全面体检：按顺序跑完指纹检测、基础测试、糖果测试、鹈鹕测试四步，给出综合得分。
网页本身调用的就是公开的 REST 接口，第三方程序可以直接接入同一套 API。

- **无状态**：服务端不保存结果，也不保存密钥；密钥只在单次请求中转发给被测接口
- **历史在本地**：网页的结果只存在浏览器 localStorage，可导出 / 导入 JSON
- **三种协议**：OpenAI 兼容、Anthropic Messages、Gemini
- 技术栈：Next.js 16、TypeScript、Tailwind CSS 4、motion 动画、lucide 图标，可直接部署到 Vercel

## 快速开始

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/check` | 全面检测，四步按顺序执行；默认同步返回报告，`stream: true` 时以 SSE 推送进度 |
| POST | `/api/v1/models` | 列出被测接口可用的模型 |
| GET | `/api/v1/questions` | 题库，`?category=`、`?withAnswers=true` |
| GET | `/api/v1` | 索引与健康检查 |
| GET | `/api/v1/openapi` | OpenAPI 3.1 描述 |

所有 POST 接口用同样的字段指定被测接口：

| 字段 | 说明 |
| --- | --- |
| `Authorization: Bearer <key>` | 被测接口的 API Key，也可用 `X-Api-Key` 头或 body 里的 `apiKey` |
| `protocol` | `openai` / `anthropic` / `gemini`，不填时按地址推断 |
| `baseUrl` | 被测接口地址；只给 `protocol` 时使用官方地址 |
| `model` | 模型 ID |
| `stages` | `/check` 专用：`detect` / `basic` / `candy` / `pelican`，默认全部 |

JSON 响应统一为 `{ ok, data, error }`。

```bash
curl -X POST http://localhost:3000/api/v1/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{"baseUrl":"https://api.deepseek.com/v1","model":"deepseek-chat","seed":42}'
```

四个步骤：

| 步骤 | 内容 | 综合分权重 |
| --- | --- | --- |
| `detect` 指纹检测 | 连通性、模型回显、用量、身份自报、系统指令、上下文记忆、真实流式、工具调用 | 30% |
| `basic` 基础测试 | 推理、阅读、代码、知识、指令遵循 | 40% |
| `candy` 糖果测试 | 改过条件的熟题、不存在的文献，测幻觉 | 30% |
| `pelican` 鹈鹕测试 | 用 SVG 画一只骑自行车的鹈鹕 | 不计分 |

综合分只计算有结果的步骤。

更多示例（SSE 流式、Python）见网页上的「API 接入」页。

## 支持的服务

| 协议 | 覆盖 |
| --- | --- |
| `openai` | OpenAI、DeepSeek、Kimi、通义千问、豆包、智谱 GLM、xAI Grok、OpenRouter、硅基流动，以及兼容 OpenAI 格式的中转站 |
| `anthropic` | Claude 官方接口，以及兼容 Anthropic 格式的中转 |
| `gemini` | Google Gemini 官方接口 |

部分推理模型不接受 `temperature` 或 `max_tokens` 参数。遇到这种 400 错误时会自动调整参数重试。

## 基础测试与糖果测试

基础测试覆盖逻辑推理、阅读理解、代码能力、知识问答、指令遵循；糖果测试是幻觉题：改过条件的熟题、不存在的文献。
所有题都是客观题，本地判分（`exact` / `contains` / `regex`），不依赖裁判模型。

- 每一步的得分 = 加权得分率 × 100
- 调用失败（超时、上游报错）的题不计入得分，单独计数在 `failedCalls`
- `seed` 相同，抽到的题和顺序就相同，方便横向对比

## 指纹检测

六项探测并发执行，共得出八项结果：连通性、模型回显、用量返回、身份自报、系统指令、上下文记忆、真实流式、工具调用。
每项状态为 `pass` / `warn` / `fail` / `unsupported` / `error`：

- 诚信分 = (通过 × 1 + 存疑 × 0.5) / 可判定项数
- 接口明确返回「不支持」的功能记为 `unsupported`，不算掺水
- 探测本身没跑通的记为 `error`，不参与打分
- 响应声明的模型换成了别家，直接判为「很可能掺水」

## 部署到 Vercel

```bash
pnpm dlx vercel login
pnpm dlx vercel --prod
```

不需要任何环境变量。`vercel.json` 默认使用 `sin1`（新加坡）区域。OpenAI 屏蔽了来自香港 `hkg1` 区域的流量，所以没有用香港。

`/check` 的函数时限是 300 秒，四步按顺序执行，整体时限 285 秒。时间不够时后面的步骤会被跳过并记在 `errors` 里，避免函数被平台强行终止。
如果你的套餐时限更短，请用 `limit` 减少题量。

## 前端设计

视觉方向记录在项目内的 `.claude/skills/frontend-design`（来自 [anthropics/skills](https://github.com/anthropics/skills)，Apache-2.0），在 Claude Code 中改 UI 时会自动参考。

- 亮色主题：冷白底色，光谱渐变（紫、蓝、青、绿）只用在进度、分数这类信号上
- 运行时：四个步骤排成横向管道，光束沿连线流向当前步骤，当前节点有脉冲光晕、旋转流光和步内进度环；下方面板实时展示当前步骤，切换步骤时有模糊过渡
- 交互：按钮尽量只用图标，悬停时显示文字提示；配置、明细、确认操作都放在弹窗里
- 字体：Unbounded 用于标题和数字，JetBrains Mono 只用于日志，字体文件随项目打包

## 本地模型

默认禁止把 `baseUrl` 指向 localhost 或内网地址，防止服务被当作内网探测工具（SSRF）。
自托管评测 Ollama、vLLM 等本地模型时，可以设置 `ALLOW_PRIVATE_BASE_URL=true`。公网部署切勿开启。
