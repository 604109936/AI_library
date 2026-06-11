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
| 5 | T6 语音输入 + T10 联网搜索 | ✅ | 38edac3+3fad358 | T6: 原生识别8/8(pointerleave自杀bug修复/getUserMedia不await)；T10: 直调search端点6/6(触发边界/来源卡/RSC假阳性修正) |
| 6 | T7 Memory 记忆系统 | ✅ | aa77a7f | user_memory 7维度+RLS；waitUntil异步M3更新；7/7(清史后仍记得职业猫名/TTFB无差/RLS隔离) |
| 7 | T9 限流放宽 | ✅ | 7c35de0 | 登录20/分+200/时,游客8/分+40/时；3/3 恰在阈值触发 |
| 8 | T1-下半场 最终全面 Review | ✅ | c511df6 | 两路终审16项确证：15修(P0盲覆盖/压缩黑洞/兜底误触发/麦克风泄漏等)+1记录 |
| 9 | T2 UI/交互择优落地 | ✅ | 7e486cb | 10页截图过目+演示数据修剪+未实施项记录 |
| 10 | 交付物四样 + 部署 + 最终回归 | ✅ | 本commit | 功能清单89点/验收清单20条(18过+2真机)/决策记录25条；两次生产部署；线上冒烟通过(兜底正则线上复现修复后重验) |

## 最终状态（任务书全部完成）

- 线上：https://www.goodcontent.cn 最新部署含全部 T1~T10
- 交付物：docs/delivery/{APP功能清单.md, 验收清单.md, 决策记录.md} + evidence/ 按任务分目录
- 待人工真机复核 2 项：语音真机触感（V6-2）、记忆体感（V7-2），步骤见验收清单

## 新一轮全面 Review（2026-06-12，压缩后指令）

> 指令：①全面 review 改掉前后端所有 bug（要细致）②所有功能优化到大师水平。

| 批次 | 内容 | commit | 回归 |
|------|------|--------|------|
| 1 | 5 项 P0：聊天云端门禁/hydrated 写穿透/搜索历史残留/播放器卸载停声/demo 账号防护 | dbd7061 | tsc |
| 2 | 服务端 13 项：推荐卡顺序/usedReadChapter/统一时间预算/userVars 降级/thinkhint/websearch/cutSafe/compress+memory 追赶限量+预算/flipfeed 预算闸+FK 降级/ratelimit 节流/删号幂等 | 3a4d328 | m3-agent 6/6 |
| 3 | 聊天前端 13 项：memo 生效/语音致命错误+双识别器/safe-area 四处/离开落库/id 单调/decode flush/后台追平/事件去重/MD 链接/aria | 08ae8f1 | voice 8/8 + shimmer 7/7 + chat-cards 10/10 |
| 4 | 阅读器+书库 14 项：幽灵笔记三重根治/gotoChapter 清选区/时长批量上报/播放器错误反馈+onPlay 落账+视频 scrub+区间并集/Media Session/搜索正确性/分页 tie-breaker/分类 404/前言统一/IME maxLength | bc229e5 | highlight-full 4/4 + reader-md |
| 5+6 | 壳/我的 12 项 + 大师级优化：flip 续拉/me 三态/注册已存邮箱/LoginSheet 三处/删除撤销/历史口径/划线合并扩展/flip preload/滚动降频/AudioContext resume | ac87223 | flip-ui 2/2 + t3t4 8/8 + chat-sync |
| 7 | 全量回归 + build + 部署 + 线上冒烟 + 交付记录（本节） | 本 commit | 全套见下 |

全量回归（本地 dev）：m3-agent 6/6、chat-cards 10/10、chat-sync ✅、voice-t6 8/8、shimmer-t8 7/7、reader-md ✅、highlight-full 6/6（新增合并扩展断言）、flip-feed-ui 2/2、t3t4-ui 8/8、stream-ui 5/5（口径升级）、chapter-read ✅、flip-windowing ✅、websearch-t10 6/6、t1-security 7/7、memory-t7 7/7、compress-m3 ✅、agent-context 3/3（脚本补 stream:false）、agent-tools ✅、ratelimit-t9（隔离窗口跑）。
决策记录新增 26~32（方法论/demo 防护边界/播放覆盖口径/删除撤销/划线合并/旧脚本升级/延后项）。

## 决策记录（随做随记，最终汇入 docs/delivery/决策记录.md）

1. **T5 模型 ID**：实测确认 `MiniMax-M3` 可用（probe-models.mjs + /v1/models 双重确认）。证据：evidence/T5/m3-format-probe.md
2. **T5 思考链形态**：M3 思考段为 content 内联 `<think>`（无独立字段）；回灌方式=工具循环内 assistant 历史 content 完整保留 <think>，实测回灌被接受。展示与回灌必须两路。
3. **T10 移植路线**：放弃移植 Python MCP stdio 客户端（Vercel 无 Python），改为直调底层 HTTP `POST /v1/coding_plan/search`（扒包源码所得，TS fetch 实测连通）。证据：evidence/T10/websearch-http-probe.md
4. **T6 ASR 选型**：MiniMax 实测无语音识别接口（任务书前提与现实不符，以实际为准）。选浏览器原生 Web Speech API + 不支持环境优雅降级；拒绝第三方 ASR（需新 key 违背零人工介入）。证据：evidence/T6/asr-investigation.md

## 证据目录

docs/delivery/evidence/T<N>/ —— 按任务编号分目录存自测证据。
