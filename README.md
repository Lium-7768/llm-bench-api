# LLM Bench API

API 优先的大模型能力评测服务。前端只负责渲染后端返回的数据，所有能力都通过公开 REST 接口提供。

- 框架：Next.js 16（App Router）+ TypeScript
- 部署：Vercel 原生支持
- 存储：默认进程内存，配置 `UPSTASH_REDIS_REST_URL`/`TOKEN` 后自动切换为 Redis 持久化
- 密钥：由调用方自带，服务端只做转发，不写入存储、日志或响应

## 快速开始

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

启动后：

- 网页控制台：<http://localhost:3000>
- API 索引：<http://localhost:3000/api/v1>
- OpenAPI 文档：<http://localhost:3000/api/v1/openapi>

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1` | API 索引，列出全部能力 |
| GET | `/api/v1/health` | 健康检查 |
| GET | `/api/v1/categories` | 评测维度列表 |
| GET | `/api/v1/questions` | 题库，支持 `category` / `limit` / `difficulty` / `withAnswers` |
| POST | `/api/v1/runs` | 提交一次评测（同步执行并返回逐题结果） |
| GET | `/api/v1/runs` | 评测历史列表 |
| GET | `/api/v1/runs/{id}` | 单次评测完整明细 |
| DELETE | `/api/v1/runs/{id}` | 删除评测记录 |
| POST | `/api/v1/detect` | 中转站 / 接口指纹检测 |
| GET | `/api/v1/leaderboard` | 按模型聚合的排行榜 |

所有响应统一为信封结构：

```json
{ "ok": true, "data": {}, "error": null }
```

## 评测维度

| id | 名称 | 说明 |
| --- | --- | --- |
| `reasoning` | 逻辑推理 | 鸡兔同笼、数列、真假话 |
| `reading` | 阅读理解 | 从材料中提取数字并做多步推算 |
| `coding` | 代码能力 | 写函数、推断输出、写 SQL |
| `knowledge` | 知识问答 | 术语与概念解释 |
| `hallucination` | 幻觉抵抗 | 被改过数字的熟题、不存在的文献 |
| `instruction` | 指令遵循 | 格式约束、字数约束、纯 JSON 输出 |

## 用法示例

发起评测：

```bash
curl -X POST http://localhost:3000/api/v1/runs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MODEL_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "baseUrl": "https://api.openai.com/v1",
    "limit": 10,
    "seed": 42
  }'
```

`baseUrl` 需为 OpenAI 兼容接口；只写域名时会自动补 `/v1`。

主观题（`rubric`）需要裁判模型：

```json
{
  "model": "qwen-plus",
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "judge": {
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "model": "gpt-4o"
  }
}
```

指纹检测：

```bash
curl -X POST http://localhost:3000/api/v1/detect \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RELAY_API_KEY" \
  -d '{"model":"gpt-4o","baseUrl":"https://your-relay.com/v1"}'
```

检测四项：模型自报身份是否一致、system prompt 是否生效、是否真流式、是否返回 token 用量。

## 判分说明

| `match` 类型 | 行为 |
| --- | --- |
| `exact` | 精确匹配，带少量前后缀容错 |
| `contains` | 命中任一关键词即通过 |
| `regex` | 匹配任一正则即通过 |
| `rubric` | 需裁判模型给 0-1 分，未提供则记 0 并注明原因 |

总分 = 加权得分率 × 100。`seed` 相同则选题与顺序相同，便于横向对比。

## 部署到 Vercel

**方式一：CLI 部署（最快）**

```bash
cd /Users/aaxis/code/llm-bench-api
pnpm dlx vercel login   # 首次需要登录（会打开浏览器授权）
pnpm dlx vercel         # 预览部署
pnpm dlx vercel --prod  # 生产部署
```

**方式二：GitHub 自动部署**

```bash
gh auth login           # 登录 GitHub
gh repo create llm-bench-api --public --source=. --push
```

然后在 <https://vercel.com/new> 导入该仓库即可。框架会被自动识别为 Next.js，无需任何环境变量。

部署后可用以下命令验证线上接口：

```bash
curl https://<你的域名>/api/v1/health
curl https://<你的域名>/api/v1
```

`vercel.json` 已配置：

- 默认区域 `sin1`（新加坡）
- `/api/v1/runs` 最长执行 300 秒，`/api/v1/detect` 120 秒
- API 路由统一 CORS 头

> **为什么用 `sin1` 而不是 `hkg1`（香港）？**
> OpenAI 会**屏蔽来自香港 `hkg1` 区域的 API 流量**（Vercel 官方公告），而本项目的主要用途
> 恰恰是调用模型 API。`sin1` 未被屏蔽，且地理位置居中，访问国内外模型接口延迟都比较均衡。
> 如需更改，请选 `sin1` / `hnd1` / `kix1` / `icn1` 等未被 OpenAI 屏蔽的区域。
>
> 另外：Hobby 套餐只允许**单个**区域；指定多个区域会导致部署在构建前就失败。

> 注意：Hobby 套餐函数最长执行时间为 60 秒。若题目较多或上游较慢，请减少 `limit`，
> 或升级到 Pro 套餐以使用 300 秒上限。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ALLOW_PRIVATE_BASE_URL` | `false` | 允许 `baseUrl` 指向 localhost/内网，用于评测 Ollama、LM Studio 等本地模型。**公网部署切勿开启**，否则接口会变成内网探测工具。 |
| `UPSTASH_REDIS_REST_URL` | 未设置 | 设置后启用 Redis 持久化存储。 |
| `UPSTASH_REDIS_REST_TOKEN` | 未设置 | 与上面配套的 token。 |

## 存储：两种后端，自动切换

| 条件 | 后端 | 行为 |
| --- | --- | --- |
| 未配置 `UPSTASH_*` | 进程内存 | 零配置，适合本地开发。Serverless 冷启动会清空记录。 |
| 配置了 `UPSTASH_*` | Upstash Redis | 数据持久化，记录保留 30 天，最多 200 条历史。 |

启用持久化（推荐用于生产）：

1. 在 Vercel 控制台打开项目 → **Integrations** → 接入 **Upstash Redis**（有免费额度）
2. 集成会自动注入上面两个环境变量，无需手动填写
3. 重新部署即可

也可以自己注册 Upstash 后手动添加这两个环境变量。

`GET /api/v1/health` 会如实报告存储状态，可直接用来确认是否已持久化：

```json
{
  "status": "healthy",
  "storage": {
    "backend": "redis",
    "persistent": true,
    "ok": true,
    "note": "已启用 Redis 持久化，记录不会因冷启动丢失。"
  }
}
```

如果 Redis 配置错误，健康检查会返回 **503** 且 `status` 为 `degraded`；其余读取接口会返回
`storage_unavailable` 错误并附带排查提示，不会静默丢数据。

## 已知限制

- **未配置 Redis 时存储是内存的**：Vercel 是无状态 Serverless，冷启动会清空历史记录。
  按上面的步骤接入 Upstash 即可持久化，代码无需改动。
- **同步执行**：评测在单个 HTTP 请求内跑完，题量大时可能超出函数时限。需要跑大规模评测
  可以改成「入队 + 轮询」，`lib/runner.ts` 的 `onProgress` 已经预留了回调。
- **禁止内网地址**：出于 SSRF 防护，`baseUrl` 不能指向 localhost 和内网网段（除非显式开启
  上面的环境变量）。

## 目录结构

```
app/
  api/v1/            REST 接口（唯一的数据来源）
    runs/            评测的提交、列表、详情、删除
    detect/          中转站指纹检测
    questions/       题库
    categories/      维度
    leaderboard/     排行榜聚合
    openapi/         OpenAPI 3.1 描述
  page.tsx           总览页
  run/               发起评测
  leaderboard/       排行榜
  detect/            接口检测
  runs/              历史记录
  docs/              API 文档
lib/
  types.ts           公共类型（API 契约）
  bank.ts            题库与选题
  scoring.ts         判分与聚合引擎
  provider.ts        OpenAI 兼容客户端
  fingerprint.ts     指纹检测逻辑
  runner.ts          评测编排
  store.ts           存储（内存 / Redis 自动切换）
  http.ts            响应封装与安全检查
  client.ts          前端 API 客户端
```
