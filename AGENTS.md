# AGENTS.md

给 AI 编码助手（Claude Code、Codex、Cursor 等）和新加入的开发者看的项目说明。改代码前先读完这一页；改了架构、题库、协议或流程后，同步更新这里。

## 项目是什么

LLM Bench 给任意大模型接口做一次「全面体检」。调用方提供接口地址、密钥和模型名，服务按顺序跑五步，得出综合分：

1. **指纹检测**：中转站有没有换模型、吞系统指令、截断上下文、伪造流式
2. **基础测试**：推理、阅读、代码、知识、指令遵循
3. **糖果测试**：改过条件的熟题和不存在的文献，看模型会不会顺着编
4. **综合推理**：知识 + 多步反证 + 抗诱导的复合题（红绿色盲题），单独成步，不计入综合分
5. **鹈鹕测试**：用 SVG 画一只骑自行车的鹈鹕，不计分

它既是一个网页，也是一套公开 REST API。网页本身就是调用这套公开 API 实现的，第三方程序可以直接接入。项目开源，部署在 Vercel。

**两条不能破坏的原则**

- **服务端无状态**：不保存任何结果，不保存、不记录、不回显密钥。密钥只在单次请求里转发给被测接口。
- **历史只存在浏览器**：网页的报告存在 localStorage，服务端没有数据库。

## 常用命令

| 命令                                     | 作用                                                           |
| ---------------------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                               | 本地开发，http://localhost:3000                                |
| `pnpm build` / `pnpm start`              | 生产构建 / 启动                                                |
| `pnpm lint` / `pnpm lint:fix`            | ESLint（Next 16 官方配置，含 React Compiler 规则）             |
| `pnpm format` / `pnpm format:check`      | Prettier（含 Tailwind 类名排序）                               |
| `pnpm typecheck`                         | 先 `next typegen` 生成路由类型，再 `tsc --noEmit`              |
| `pnpm smoke`                             | 对已启动的服务跑冒烟测试，不需要模型密钥，`BASE_URL` 指定地址  |
| `pnpm mock`                              | 启动本地模拟上游（三种协议），没有真实密钥也能把五步完整跑一遍 |
| `pnpm release:patch` / `minor` / `major` | 发版，见「发版与部署」                                         |

技术栈：Next.js 16（App Router）、React 19、TypeScript、Tailwind CSS 4、motion、lucide-react。包管理器是 pnpm，Node ≥ 20.9。

## 架构

### 目录

```
app/
  api/v1/
    route.ts            GET  索引与健康检查（协议、步骤、预设服务商）
    check/route.ts      POST 全面检测，同步或 SSE 流式
    models/route.ts     POST 列出被测接口的可用模型
    questions/route.ts  GET  题库（默认不带答案）
    openapi/route.ts    GET  OpenAPI 3.1 描述
  page.tsx              检测页：启动台 → 运行中 → 报告
  compare/page.tsx      模型对比（只列没有报错的报告）
  history/page.tsx      历史记录（正常报告可看详情，报错报告只展示）
  docs/page.tsx         API 接入文档
  layout.tsx, globals.css
components/             前端组件
  Pipeline.tsx          五步横向光束管道
  StageLive.tsx         运行中当前步骤的实时面板
  Report.tsx            报告与各步明细（弹窗内容）
  ConfigPanel.tsx       被测接口配置
  Select.tsx            自定义下拉 Select / Combobox（不要用原生 select）
  Layer.tsx             浮层定位（提示气泡、下拉层），挂到最近的 dialog 或 body
  ui.tsx                IconButton、IconLink、Modal、Panel、Pill 等基础组件
  StageIcon.tsx         五个步骤的名称、说明、图标、颜色
  Score.tsx             环形分数、计数动画
  Spectrum.tsx          光谱柱（首页待机动画）
lib/                    服务端与共享逻辑
  types.ts              对外 API 契约（前后端共用）
  llm.ts                三种协议的适配层：chat / chatStream / listModels
  check.ts              五步编排，产出事件流
  detect.ts             指纹检测八项
  bench.ts              基础 / 糖果 / 综合推理的作答与并发
  bank.ts               题库
  scoring.ts            判分与汇总
  pelican.ts            鹈鹕绘图
  svg.ts                SVG 提取与分析（输出格式、动态 / 静态），前后端共用
  presets.ts            服务商预设
  http.ts               统一响应信封、CORS、读取被测接口、SSE、SSRF 防护
  channel.ts            异步队列，把并发结果转成按顺序消费的事件
  web/                  只在浏览器用：api.ts（调用本站 API）、storage.ts（localStorage）、
                        config.ts（接口配置，useSyncExternalStore）、format.ts
scripts/                smoke.mjs、mock-upstream.mjs、release.mjs
.github/workflows/      ci.yml、release.yml
```

### 一次检测的数据流

```
浏览器 / 第三方程序
   │  POST /api/v1/check   Authorization: Bearer <被测接口的密钥>
   ▼
check/route.ts ── http.readTarget()：解析协议、地址、密钥、模型；拒绝内网地址
   │
   ▼
check.runCheck()  按顺序执行，整体时限 285 秒（Vercel 函数上限 300 秒）
   ├─ detect   detect.runDetect()   六个探测并发，产出八项结果
   ├─ basic    bench.runBench()     题目并发（默认 3），逐题产出
   ├─ candy    bench.runBench()     同上，只跑幻觉题
   ├─ inference bench.runBench()   同上，只跑综合推理题，不计入综合分
   └─ pelican  pelican.runPelican()
   │       每一步都通过 llm.ts 调上游：chat() / chatStream()
   ▼
事件流：start → [stage.start → answer | check … → stage.done | stage.error] × N → result
   │  stream=true 时用 SSE 逐条推送；否则只返回最后的 Report
   ▼
浏览器：page.tsx 消费事件，驱动 Pipeline 和 StageLive；收到 result 后存入 localStorage
```

- 剩余时间不足 5 秒时，后面的步骤会被跳过，原因写进 `report.errors`，不会让函数被平台强杀。
- 调用方断开时（`req.signal`），未开始的题目不再执行。
- 综合分 = 指纹 30% + 基础 40% + 糖果 30%，只按有结果的步骤加权。综合推理和鹈鹕不计分。

### 协议适配层（lib/llm.ts）

| 协议        | 请求地址                                                                                | 鉴权头                                        | 流式解析                                                                 | 工具调用格式                              |
| ----------- | --------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| `openai`    | `{base}/chat/completions`，只写域名时补 `/v1`                                           | `Authorization: Bearer`                       | `choices[0].delta.content`，用量在末块（`stream_options.include_usage`） | `tools[].function` → `message.tool_calls` |
| `anthropic` | `{base}/v1/messages`                                                                    | `x-api-key` + `anthropic-version: 2023-06-01` | `content_block_delta`；用量在 `message_start` / `message_delta`          | `tools[].input_schema` → `tool_use` 块    |
| `gemini`    | `{base}/v1beta/models/{model}:generateContent`（流式 `:streamGenerateContent?alt=sse`） | `x-goog-api-key`                              | 每块 `candidates[0].content.parts`                                       | `functionDeclarations` → `functionCall`   |

兼容性处理：

- 上游因参数不兼容返回 400 时自动调整重试：去掉 `temperature`、`max_tokens` 改为 `max_completion_tokens`、去掉 `stream_options`。覆盖 OpenAI 推理模型和部分兼容接口。
- Anthropic 的 thinking 块、Gemini 的 `thought` 片段不计入回答文本。
- OpenAI 和 Gemini 默认不传输出上限：推理 / 思考模型的思考 token 也算在上限里，设小了会返回空回答。Anthropic 必须传，默认 2048，鹈鹕 8192。
- 长回答（鹈鹕、综合推理）用 `chatLong()`：内部走流式再拼成完整文本。非流式请求在生成完之前连接上没有数据，部分中转站会在空闲约 70 秒后断开（实测 `ETIMEDOUT`）；上游拒绝流式时退回普通请求。综合推理单题时限 150 秒（思考型模型实测要两分多钟）。
- 模型回显比对时忽略 `vendor/` 前缀、中转站加的 `xxx_` 前缀和日期后缀，例如请求 `autoclaw/zai_glm-5.3-flash`、响应 `glm-5.3-flash` 算一致。
- 没给 `protocol` 时按地址推断：域名含 `anthropic.com` 或路径含 `/anthropic`、以 `/messages` 结尾 → anthropic；`generativelanguage.googleapis.com` 且路径不含 `/openai` → gemini；其余 → openai。

### 前端

- 三个状态：启动台（`idle`）→ 运行中（`running`）→ 报告（`done`），都在 `app/page.tsx`。
- 接口配置存在 localStorage（`llmbench.config`），关闭「记住密钥」时密钥只存 sessionStorage。
- 历史记录键名 `llmbench.reports.v2`，最多 60 份。报告结构有不兼容改动时换键名；小改动可以在 `storage.ts` 的 `migrate()` 里读取时转换（如 v0.3.0 的步骤 `colorblind` 已改名为 `inference`）。
- 「报错」的定义见 `lib/web/format.ts` 的 `hasError()`：综合分为空、计分的步骤（指纹、基础、糖果）失败或被跳过、这些步骤里有题目调用失败、指纹检测无法判断。综合推理和鹈鹕不计分，它们失败只在对应卡片里显示，不算报告报错。报错的报告不进对比，历史里只展示、不能操作。

## 检测内容

### 指纹检测（lib/detect.ts）

六个探测并发执行，得出八项结果。每项状态为 `pass` 通过、`warn` 存疑、`fail` 异常、`unsupported` 不支持、`error` 未完成。

| 项         | 怎么测                             | 判定                                                                                 |
| ---------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| 连通性     | 让模型只回一个字                   | 有回答为通过，空回答为存疑                                                           |
| 模型回显   | 同一次调用，看响应里声明的模型     | 与请求一致为通过；不同厂商为异常（换模型）；缺字段为存疑                             |
| 用量返回   | 同一次调用，看 token 用量          | 输入输出都有为通过；字段在但为 0 为存疑；缺失为异常                                  |
| 身份自报   | 问「你是什么模型、哪家公司」       | 与请求的模型同一家为通过；不同家或识别不出为存疑（部分模型会错误自报，所以不判异常） |
| 系统指令   | system 要求只回复暗号 `ZEBRA-7749` | 回复含暗号为通过，否则异常                                                           |
| 上下文记忆 | 三轮对话，第一轮给暗号，第三轮问   | 答出 `4821` 为通过，否则异常                                                         |
| 真实流式   | 流式数到 40                        | ≥5 个增量块且首末间隔 ≥100ms 为通过；2 块以上为存疑；否则异常（假流式）              |
| 工具调用   | 提供 `get_weather`，要求调用       | 发起调用为通过；直接文字回复为存疑                                                   |

- 诚信分 = (通过 × 1 + 存疑 × 0.5) / 可判定项数 × 100。`unsupported` 和 `error` 不参与打分。
- 上游明确返回「不支持」的记为 `unsupported`，不算掺水。
- 结论：全部通过为 `clean`；模型回显异常（换模型）、两项以上异常或诚信分低于 60 为 `tampered`；其余为 `suspicious`；没有可判定项为 `inconclusive`。

### 题库（lib/bank.ts）

全部是客观题，本地判分，不依赖裁判模型：

- `exact`：精确匹配，允许少量前后缀（如「答案是 42」），但会校验词边界，`142` 不算 `42`
- `contains`：包含任一关键词
- `regex`：匹配任一正则，作用于整个回答（不用多行模式，`^`、`$` 锚定的是整个回答而不是某一行）
- `json`：把回答解析为 JSON 后与标准答案逐字段比较，不要求字段顺序；带代码块标记或其他文字算没遵循指令

要求「只回答 X」的题，判分也要求回答足够简短，避免「先编一段，再补一句免责声明」也能得分。

每一步的得分 = 加权得分率 × 100。调用失败的题不计分，单独计数在 `failedCalls`。`seed` 相同，抽到的题和顺序就相同。基础测试可以用 `limit` 抽题，糖果测试和综合推理总是全做。

| ID         | 步骤     | 维度     | 题目                                                                                                                             | 判分  | 标准答案                                                                                                                           | 分值 |
| ---------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- | ---- |
| reason-001 | 基础     | 逻辑推理 | 一个笼子里有鸡和兔共 35 只，脚共 94 只。问鸡和兔各多少只？只回答两个数字，格式：鸡=x,兔=y                                        | regex | 正则：`鸡\s*=\s*23(?!\d)\D+兔\s*=\s*12(?!\d)` 或 `兔\s*=\s*12(?!\d)\D+鸡\s*=\s*23(?!\d)`                                           | 2    |
| reason-002 | 基础     | 逻辑推理 | 数列：2, 6, 12, 20, 30, ? 请只回答下一个数字。                                                                                   | exact | 42                                                                                                                                 | 1    |
| reason-003 | 基础     | 逻辑推理 | 三个人 A、B、C 中只有一人说真话。A 说：B 在说谎。B 说：C 在说谎。C 说：A 和 B 都在说谎。谁说的是真话？只回答 A、B 或…            | exact | B                                                                                                                                  | 3    |
| reason-004 | 基础     | 逻辑推理 | 一个池塘里的荷叶每天面积翻倍，第 48 天铺满整个池塘。第几天铺满一半？只回答数字。                                                 | exact | 47                                                                                                                                 | 1    |
| reason-005 | 基础     | 逻辑推理 | 小明比小红高，小红比小刚高，小刚比小美高。请按从矮到高排序，只回答四个名字，用 < 连接。                                          | regex | 正则：`小美\s*<\s*小刚\s*<\s*小红\s*<\s*小明`                                                                                      | 2    |
| read-001   | 基础     | 阅读理解 | 阅读材料：「公司 2023 年营收 1200 万元，同比增长 20%；净利润 96 万元，同比下降 5%。研发投入 150 万元，占营收 1…                  | exact | 1000                                                                                                                               | 2    |
| read-002   | 基础     | 阅读理解 | 阅读材料：「公司 2023 年营收 1200 万元，同比增长 20%；净利润 96 万元，同比下降 5%。研发投入 150 万元，占营收 1…                  | exact | 下降                                                                                                                               | 1    |
| read-003   | 基础     | 阅读理解 | 阅读材料：「项目原计划 6 月 1 日启动，因审批延迟 10 天才启动。启动当天记为第 1 天，原计划工期 90 天，实际比计划少用 5 天…        | exact | 09-03 / 9-3 / 9月3日 / 09月03日                                                                                                    | 3    |
| code-001   | 基础     | 代码能力 | 下面这个 Python 函数用来判断素数： ```python def is_prime(n): for i in range(2,…                                                 | regex | 正则：`^\s*0\s*[,，]\s*1\s*$`                                                                                                      | 2    |
| code-002   | 基础     | 代码能力 | 以下 Python 代码会输出什么？只回答输出结果。 ```python print([x*2 for x in range(3)]) ``…                                        | regex | 正则：`\[\s*0\s*,\s*2\s*,\s*4\s*\]`                                                                                                | 1    |
| code-003   | 基础     | 代码能力 | 有一段 JS：`const a = [1,2,3]; const b = a; b.push(4); console.log(a.lengt…                                                      | exact | 4                                                                                                                                  | 2    |
| code-004   | 基础     | 代码能力 | 写一个 SQL：从表 `orders`(id, user_id, amount, created_at) 中查询 2024 年每个用户的总金…                                         | regex | 正则：`^(?=[\s\S]*SUM\s*\(\s*amount\s*\))(?=[\s\S]*GROUP\s+BY\s+user_id)(?=[\s\S]*2024)(?=[\s\S]*ORDER\s+BY[\s\S]*DESC)`           | 3    |
| know-001   | 基础     | 知识问答 | HTTP 状态码 429 的官方名称是什么？只回答这个英文名称，不要解释，不要标点。                                                       | regex | 正则：`^\s*too\s+many\s+requests\.?\s*$`                                                                                           | 1    |
| know-002   | 基础     | 知识问答 | TCP 三次握手中，客户端发送 SYN 后收到 SYN+ACK，此时客户端再发送什么？只回答三个字母。                                            | exact | ACK                                                                                                                                | 1    |
| know-003   | 基础     | 知识问答 | 在 Git 中，`git rebase` 和 `git merge` 哪一个会改写已有提交的哈希（commit ID）？只回答 rebase…                                   | exact | rebase                                                                                                                             | 2    |
| hal-001    | 糖果     | 幻觉抵抗 | 一个笼子里有鸡和兔共 35 只，脚共 96 只。问鸡和兔各多少只？只回答两个数字，格式：鸡=x,兔=y。如果题目条件矛盾无解，请只回答「无解… | regex | 正则：`鸡\s*=\s*22(?!\d)\D+兔\s*=\s*13(?!\d)` 或 `兔\s*=\s*13(?!\d)\D+鸡\s*=\s*22(?!\d)`                                           | 3    |
| hal-002    | 糖果     | 幻觉抵抗 | 《红楼梦》的作者是谁？如果这是一道被篡改过的题目（正确的书名并不存在），请只回答「不存在这本书」。                               | regex | 正则：`^(?![\s\S]*不存在)[\s\S]*曹雪芹`                                                                                            | 2    |
| hal-003    | 糖果     | 幻觉抵抗 | 请引用一篇 2024 年发表的、标题为《Quantum Banana Cultivation on Mars》的论文，给出作者和期刊名。如果…                            | regex | 正则：`^\s*(这篇论文\|该论文\|此论文)?\s*「?不存在」?\s*[。.!！]?\s*$`                                                             | 3    |
| hal-004    | 糖果     | 幻觉抵抗 | 盒子里有 10 颗糖，小明拿走 3 颗，小红拿走 4 颗，小刚又拿走 5 颗。盒子里还剩几颗？如果条件矛盾无法成立，请只回答「无解」。        | regex | 正则：`^[^\d\n]{0,12}无解[^\d\n]{0,12}$`                                                                                           | 3    |
| hal-005    | 糖果     | 幻觉抵抗 | 树上有 10 只鸟，有人用一支不会伤害鸟、也不会发出声音的激光笔照了一下树枝，鸟都没有察觉。树上还剩几只鸟？只回答数字。             | exact | 10                                                                                                                                 | 2    |
| hal-006    | 糖果     | 幻觉抵抗 | 单词 strawberrry 中一共有几个字母 r？注意拼写，只回答数字。                                                                      | exact | 4                                                                                                                                  | 2    |
| inst-001   | 基础     | 指令遵循 | 请把「今天天气很好」翻译成英文，并且只输出英文，不要任何标点符号。                                                               | regex | 正则：`^(?=[\s\S]*\bweather\b)(?=[\s\S]*\b(nice\|good\|fine\|great\|lovely\|beautiful\|sunny)\b)[a-z\s]+$`                         | 2    |
| inst-002   | 基础     | 指令遵循 | 请用恰好 7 个汉字回答「中国的首都是哪里」，不要包含「的」字，不要标点，只输出这 7 个汉字。                                       | regex | 正则：`^(?=[\u4e00-\u9fa5]*北京)(?![\u4e00-\u9fa5]*的)[\u4e00-\u9fa5]{7}$`                                                         | 3    |
| inst-003   | 基础     | 指令遵循 | 请输出一个 JSON 对象，只含两个字段：`name` 值为 "bench"，`version` 值为 1（数字）。不要任何其他文字或代码块…                     | json  | JSON 等于 `{"name":"bench","version":1}`（不要求字段顺序）                                                                         | 3    |
| infer-001  | 综合推理 | 综合推理 | 红绿色盲题：女孩把 38 分改成 88 分，父亲却质问她「8 怎么一半绿一半红」，之后父亲崩溃。问为什么。                                 | regex | 只认结论「父亲不是生父」：`不是亲生父亲`/`不是生父`/`不是他的孩子`/`不是自己的`/`没有血缘`/`绿帽` 等；只提「遗传」「染色体」不得分 | 3    |

当前题库版本 `BANK_VERSION = "2026.10.4"`。

### 鹈鹕测试（lib/pelican.ts、lib/svg.ts）

提示词：`Generate an SVG of a pelican riding a bicycle. Output only the SVG code, nothing else.` 从回答里提取第一个 `<svg>…</svg>`，没有 `xmlns` 时补上。

结果里的 `analysis` 是对回答的本地分析，不计分：

| 字段       | 含义                                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`   | `pure` 只有 SVG（允许 XML 声明）；`fenced` 包在代码块里；`extra` 前后有其他文字或不止一段 SVG；`truncated` 没有 `</svg>`；`none` 没有 SVG          |
| `animated` | 是否带动画，`animation` 列出用了哪种：`smil`（`<animate>`、`<animateTransform>`、`<animateMotion>`、`<set>`）或 `css`（`@keyframes`、`animation`） |
| `script`   | 是否含 `<script>` 或 `onxxx=` 事件属性                                                                                                             |

**展示必须用图片**：前端用 `<img src="data:image/svg+xml,…">` 渲染，不要改成内联 SVG（`dangerouslySetInnerHTML`）。模型输出不可信，内联会执行脚本（能读到 localStorage 里的密钥）、`<style>` 会污染整页、外链资源会被加载。图片上下文里 SMIL 和 CSS 动画照常播放，脚本不执行，所以「动态」只认 SMIL 和 CSS，靠脚本驱动的动画标为静态并提示「含脚本 · 未执行」。v0.4.0 之前的历史报告没有 `analysis`，前端只按 SVG 补算动态 / 静态，不显示输出格式。

## 支持的模型

任何兼容以下三种协议之一的接口都能测，包括各类中转站。预设服务商（`lib/presets.ts`）：

| 服务商                 | 协议      | 默认地址                                            | 预填的模型                                 |
| ---------------------- | --------- | --------------------------------------------------- | ------------------------------------------ |
| OpenAI                 | openai    | `https://api.openai.com/v1`                         | gpt-4.1、gpt-4.1-mini、gpt-4o、gpt-4o-mini |
| Anthropic Claude       | anthropic | `https://api.anthropic.com`                         | 无，用「获取模型列表」拉取                 |
| Google Gemini          | gemini    | `https://generativelanguage.googleapis.com`         | gemini-2.5-pro、gemini-2.5-flash           |
| DeepSeek               | openai    | `https://api.deepseek.com/v1`                       | deepseek-chat、deepseek-reasoner           |
| Kimi（月之暗面）       | openai    | `https://api.moonshot.cn/v1`                        | 无                                         |
| 通义千问（阿里云百炼） | openai    | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen-max、qwen-plus、qwen-turbo            |
| 豆包（火山方舟）       | openai    | `https://ark.cn-beijing.volces.com/api/v3`          | 无（火山方舟的模型 ID 通常是接入点 ID）    |
| 智谱 GLM               | openai    | `https://open.bigmodel.cn/api/paas/v4`              | 无                                         |
| xAI Grok               | openai    | `https://api.x.ai/v1`                               | 无                                         |
| OpenRouter             | openai    | `https://openrouter.ai/api/v1`                      | 无                                         |
| 硅基流动               | openai    | `https://api.siliconflow.cn/v1`                     | 无                                         |
| 自定义 / 中转站        | 任选      | 自填                                                | 自填                                       |

预填的模型只是输入提示，不代表这些模型一定还在服务。以「获取模型列表」（`POST /api/v1/models`）实际拉到的为准，拉不到时手动填模型 ID。

**验证状态**：三种协议的完整流程（五步、流式、工具调用）已用 `scripts/mock-upstream.mjs` 验证；对 OpenAI 兼容（DeepSeek）、Anthropic、Gemini 的真实接口只验证到请求格式和鉴权头正确（无效密钥时上游返回 401 / 400）。还没有用真实密钥跑过完整检测，有密钥的贡献者跑通后请在这里补充。

## 开发约定

- **分支**：主分支是 `dev`。改动走 PR 合入 `dev`。`release` 分支只由发版工作流移动，不要手动推送。
- **提交信息**：约定式提交，描述用中文，如 `feat(detect): 新增工具调用探测`、`fix(scoring): 修正 exact 判分的子串误判`。commit-msg 钩子和 PR 上的 CI 都会校验。
- **提交信息不能署名**：不要加 `Co-Authored-By`、`Signed-off-by`、「Generated with Claude Code」之类的署名行，AI 助手生成的提交也一样。commitlint 的 `no-signature` 规则会拒绝带署名的提交。
- **提交前**：Husky + lint-staged 自动对改动的文件跑 `eslint --fix` 和 `prettier --write`。
- **注释与文案**：中文。代码注释写「为什么」，不复述代码。界面文案用用户能懂的话，不写实现细节。
- **API 契约**：改 `lib/types.ts` 时同步更新 `app/api/v1/openapi/route.ts`、`app/docs/page.tsx`、README 和本文件。
- **改题库**：只用客观判分方式；改完递增 `BANK_VERSION`，否则同一 seed 的历史结果不可比；更新本文件的题目表。
- **加服务商**：在 `lib/presets.ts` 加一项；如果协议都不兼容，才需要在 `lib/llm.ts` 增加协议适配。
- **加检测项**：在 `lib/detect.ts` 实现探测并加入 `DETECT_CHECKS`，前端会自动显示。
- **安全**：
  - 不要记录、返回或持久化密钥
  - 不要放开内网地址校验（`isSafeBaseUrl`）
  - 自托管评测本地模型时用环境变量 `ALLOW_PRIVATE_BASE_URL=true`，公网部署切勿开启
- **前端**：
  - 视觉方向见 `.claude/skills/frontend-design`
  - 亮色主题，颜色用 `globals.css` 里 `@theme` 定义的语义色（`paper`、`surface`、`ink`、`readout`、`line`、`tint` 和光谱色），不要写死颜色
  - 能用图标的按钮只放图标，用 `IconButton` / `IconLink` 并给 `label`（作提示和无障碍名称）
  - 配置、明细、确认操作放进 `Modal`，不要平铺在页面上
  - 下拉用 `components/Select.tsx`，不要用原生 `<select>` 和 `<datalist>`
  - 浮层（提示、下拉）用 `components/Layer.tsx` 定位，不要在可滚动容器里用 absolute，否则会撑出横向滚动条
  - 动效用 motion，尊重 `prefers-reduced-motion`

## 测试与验证

没有单元测试框架。改动后至少跑：

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm build
pnpm start & pnpm smoke                                   # 接口冒烟测试
```

验证完整检测流程和界面（不需要真实密钥）：

```bash
SLOW=1 pnpm mock                                          # 模拟上游，带随机延迟便于看动效
ALLOW_PRIVATE_BASE_URL=true pnpm dev
# 页面里选「自定义 / 中转站」，地址 http://127.0.0.1:4555/v1，密钥随意（Anthropic 协议填 k）
```

模拟上游故意留了几个瑕疵（一道糖果题答错、自报身份是 Claude、Anthropic 不支持工具、Gemini 假流式），用来确认判分和检测确实生效，详见脚本开头的注释。

## 发版与部署

- **CI**（`.github/workflows/ci.yml`）：推送到 `dev` 和向 `dev` 发起 PR 时运行：提交信息校验（仅 PR）、ESLint、格式检查、类型检查、生产构建、冒烟测试。
- **预览部署**：由 Vercel 的 GitHub 集成自动完成，每个 PR 和 `dev` 的推送都有预览地址。
- **发版**：在 `dev` 上执行 `pnpm release:patch`（或 `minor` / `major`）。脚本校验工作区干净且与 `origin/dev` 同步，跑 lint 和类型检查，升 `package.json` 版本，提交 `chore(release): vX.Y.Z`，打标签并推送。
- **生产部署**（`.github/workflows/release.yml`）：推送 `vX.Y.Z` 标签后，先跑完整 CI，再校验标签与 `package.json` 一致、标签在 `dev` 上，然后创建 GitHub Release（自动生成说明），最后把 `release` 分支快进到该版本。Vercel 的生产分支设为 `release`（Project Settings → Environments → Production → Branch Tracking），因此**只有发版才会更新生产环境**。
- 不需要在 GitHub 里配置任何 Vercel 令牌。

## 已知问题

- 五步按顺序执行、总时限 285 秒。思考很慢的模型（单题思考两分钟以上）可能让最后的鹈鹕被跳过；这时可以用 `stages` 分两次跑。
- 身份自报依赖模型自述，部分模型会错误自报，因此不同家只记为存疑，需结合模型回显判断。
- 客观题只能检查回答形式和关键结论，无法验证推理过程；代码题考的是读代码、找问题，不执行模型写的代码。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
