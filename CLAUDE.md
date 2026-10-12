# CLAUDE.md

项目说明统一维护在 AGENTS.md，这里直接引用，避免两份内容不同步：

@AGENTS.md

## 给 Claude Code 的补充

- 改界面前先加载项目内的 `frontend-design` skill（`.claude/skills/frontend-design`），按它的流程定方案再写代码。
- 改完界面用 `scripts/mock-upstream.mjs` 跑一遍完整流程，并截图检查运行中各步骤和报告页，不要只看构建是否通过。
- 改了架构、题库、协议或流程，同步更新 AGENTS.md 对应章节。
