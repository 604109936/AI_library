# 全面优化任务书 —— 执行进度（断点续跑依据）

> 任务书：docs/全面优化任务书Prompt.txt（10 项任务，全程自主迭代）
> 本文件每完成一个任务即更新。被掐断后恢复时：先读本文件 + 任务书，再 git log 核对实际进度，断点续跑。

## 基线（开工时刻）

- 日期：2026-06-11
- 起点 commit：`061a828`（卡片交错渲染轮，已部署 goodcontent.cn，工作区干净）
- dev 服：3000 端口后台
- 既有回归套件：verify-chat-cards(9/9) / verify-chat-sync / verify-flip-feed-ui(2/2) / verify-t3t4-ui(8/8)

## 执行顺序与状态

| 步骤 | 任务 | 状态 | commit | 备注 |
|------|------|------|--------|------|
| 1 | T1-上半场 联调 Bug 扫描修复 | ✅ | d539416 | 4路审查31项确证→修24项（P1×6全修）+DB收紧7/7实测；回归4套全绿；evidence/T1/ |
| 2 | T5 切 M3 + 思考链回灌 + 压缩放宽 | ✅ | 3ff73a5 | M3全量(线上env已写)；回灌实测两轮<think>连续；压缩until新口径+摘要2034字样本；verify-m3-agent 6/6；evidence/T5/ |
| 3 | T4 全局单一会话窗口 | ✅ | 7f23cd3 | 迁移51行→3条main零丢失(备份表chat_sessions_backup_t4)；入口全删；换设备连续实测；E2E改备份-还原模式 |
| 4 | T3 卡片三层加固 + T8 水波纹文案 | ✅ | T3+T8 两commit | T3: 10轮零失配+UI 10/10(兜底实际拦截过失配)；T8: shimmer纯transform+思考包装7/7+全仓省略号清零 |
| 5 | T6 语音输入 + T10 联网搜索 | 🔄 T6 进行中 | - | |
| 6 | T7 Memory 记忆系统 | ⬜ | - | |
| 7 | T9 限流放宽 | ⬜ | - | |
| 8 | T1-下半场 最终全面 Review | ⬜ | - | |
| 9 | T2 UI/交互择优落地 | ⬜ | - | |
| 10 | 交付物四样 + 部署 + 最终回归 | ⬜ | - | |

## 决策记录（随做随记，最终汇入 docs/delivery/决策记录.md）

1. **T5 模型 ID**：实测确认 `MiniMax-M3` 可用（probe-models.mjs + /v1/models 双重确认）。证据：evidence/T5/m3-format-probe.md
2. **T5 思考链形态**：M3 思考段为 content 内联 `<think>`（无独立字段）；回灌方式=工具循环内 assistant 历史 content 完整保留 <think>，实测回灌被接受。展示与回灌必须两路。
3. **T10 移植路线**：放弃移植 Python MCP stdio 客户端（Vercel 无 Python），改为直调底层 HTTP `POST /v1/coding_plan/search`（扒包源码所得，TS fetch 实测连通）。证据：evidence/T10/websearch-http-probe.md
4. **T6 ASR 选型**：MiniMax 实测无语音识别接口（任务书前提与现实不符，以实际为准）。选浏览器原生 Web Speech API + 不支持环境优雅降级；拒绝第三方 ASR（需新 key 违背零人工介入）。证据：evidence/T6/asr-investigation.md

## 证据目录

docs/delivery/evidence/T<N>/ —— 按任务编号分目录存自测证据。
