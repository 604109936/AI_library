# AI 图书馆 · APP 功能清单（交付文档）

> **项目**：AI 图书馆 H5 APP（Next.js 14 + Supabase 直连 + MiniMax-M3）
> **线上地址**：https://www.goodcontent.cn （Vercel 项目 ai-library；`*.vercel.app` 国内被墙不可用）
> **代码基线**：commit `7e486cb`（2026-06-11，工作区干净）
> **文档口径**：本清单逐条以源码核实为准（文档与代码冲突处一律以代码为准），覆盖全 APP 所有功能，不只本轮改动。
>
> **「本轮」定义** = 全面优化任务书 T1~T10：T1 全面 Bug 扫描修复（上下半场）/ T5 切换 MiniMax-M3 + 思考链回灌 + 压缩放宽 / T4 全局单一会话 / T3 卡片三层加固 / T8 水波纹 shimmer / T6 语音输入 / T10 联网搜索 / T7 Memory 记忆 / T9 限流放宽 / T2 UI 交互择优落地。对应提交区间 `061a828..7e486cb`。
>
> **状态图例**：〔本轮新增〕功能本轮从无到有；〔本轮修改〕功能原已存在、本轮有实质或细节改动（括注改动内容）；〔原有未动〕本轮未触碰。

**全文共 89 个功能点**，分 6 个模块：

| 模块 | 功能点数 | 本轮新增 | 本轮修改 |
|---|---|---|---|
| 一、智学（AI 读书伙伴「小涤」） | 24 | 5 | 15 |
| 二、泡馆（图书馆）与搜索 | 12 | 0 | 3 |
| 三、阅读器与书评 | 13 | 0 | 4 |
| 四、乱翻（短视频式刷书） | 12 | 0 | 4 |
| 五、我的（个人中心）与账号体系 | 16 | 0 | 10 |
| 六、基础设施 | 12 | 0 | 3 |

---

## 一、智学 —— AI 读书伙伴「小涤」

智学是全 APP 的核心模块：一个读过馆里所有书、也认识用户本人的 AI 对话伙伴，支持荐书、书本答疑、解读原文、联网查询，带长期记忆。本轮 10 项任务中 8 项落在本模块。

### 1.1 对话主链路（发送 → 流式回复 → 打字机渐显）〔本轮修改：全量切 M3、事件流增 web 事件〕

**一句话描述**：用户输入问题，服务端以 NDJSON 事件流逐段返回 AI 回答，前端以「追赶式打字机」平滑渐显。

**前端入口与交互流程**：底部导航「智学」Tab → `/chat`。输入框输入（≤500 字）→ Enter（输入法候选态不误发）或点发送钮 → 消息上屏、出现思考态占位 → 回答逐字浮现 → 流结束显示操作栏（复制/重新生成/赞/踩）。

**后端接口**：`POST /api/chat`。请求头 `Authorization: Bearer <Supabase access_token>`（游客不带）；请求体 `{ messages: [{role, content}...], stream: true }`。响应 `application/x-ndjson` 逐行事件：
- `{"t":"d","v":"文本增量"}` 正文片段
- `{"t":"status","v":"翻开《书名》"}` 工具执行状态
- `{"t":"recs","v":[{id,title}]}` 推荐书卡
- `{"t":"cites","v":[{b,c,bt,ct,sn,cs,cv}]}` 引用章节卡
- `{"t":"web","v":{q,items:[{t,u,d}]}}` 联网来源卡
- `{"t":"end"}` 正常结束 / `{"t":"err","v":"..."}` 出错结束

非流式（`stream:false`，调试用）返回一次性 JSON。错误码：400 请求体非法、429 限流、502 上游失败。

**数据库表**：`chat_sessions(user_id, id='main', title, messages jsonb, compressed_history, compressed_until, updated_at)`——流结束后由前端写穿透落库；服务端 `waitUntil` 异步触发压缩与记忆更新。

**关键代码**：`D:\ClaudeCode\AI_library\app\api\chat\route.ts`（路由、限流、上下文裁剪、Agent 循环）；`D:\ClaudeCode\AI_library\lib\server\minimax.ts`（`streamChat()` 流式调用）；`D:\ClaudeCode\AI_library\app\chat\page.tsx`（`send()`、流消费、打字机 `smooth()`）。

**实现要点与已知限制**：MiniMax 上游为大块推送，前端打字机每 16ms 推进 `max(2, ceil(落后量/25))` 字符——落后越多追越快，体感连续；上下文裁剪：最近 40 条（20 轮）+ 绝对上限 64 条，有压缩摘要时从 `compressed_until` 后截取。已知限制：客户端仍上行整段历史，会话极长时请求体偏大（见附录改进建议第 6 条）。

### 1.2 MiniMax-M3 模型与思考链处理（剥离 + 回灌）〔本轮修改·T5：模型由 Text-01 全量切 M3〕

**一句话描述**：全链路统一 MiniMax-M3 模型；M3 在正文内联输出 `<think>…</think>` 推理段，服务端跨 chunk 剥离不外露，但在多轮工具循环内完整回灌保持「不失忆」。

**前端入口**：无独立入口，作用于所有智学对话。

**后端接口**：MiniMax `https://api.minimaxi.com`（环境变量 `MINIMAX_BASE_URL`）。模型 ID 均默认 `MiniMax-M3`，可经环境变量覆盖：主对话 `MINIMAX_MODEL`、压缩摘要 `MINIMAX_COMPRESS_MODEL`、记忆更新 `MINIMAX_MEMORY_MODEL`、乱翻排序 `MINIMAX_FEED_MODEL`。密钥 `MINIMAX_API_KEY` 仅存服务端。

**数据库表**：无直接操作。

**关键代码**：`D:\ClaudeCode\AI_library\lib\server\minimax.ts` —— `makeThinkFilter()`（跨 chunk 切分 `<think>` 双路输出）、`stripThink()`。

**实现要点与已知限制**：M3 思考段无独立字段、内联在 content 中（实测确认，见 `docs/delivery/evidence/T5/m3-format-probe.md`），因此「展示」与「回灌」必须两路处理：给用户的流剥掉思考；工具循环内 assistant 历史保留原始 `<think>`，否则每轮工具调用模型都会丢失推理上下文（实测回灌被上游接受）。

### 1.3 思考过程包装提示（thinkhint）〔本轮新增·T8〕

**一句话描述**：把 M3 的思考原文实时提炼为 ≤20 字的人话短句（如「在《认知觉醒》里找最相关的章」），随流更新展示，绝不直出思考原文。

**前端入口与交互流程**：流式期间消息上方显示过程提示（水波纹扫光呈现）；新正文到达即淡出；思考太短不触发时回退本地句池轮换（登录/游客两套文案）。

**后端接口**：随 `POST /api/chat` 的 `status` 事件下发，无独立接口。**纯服务端推导**，不落库。

**关键代码**：`D:\ClaudeCode\AI_library\lib\server\thinkhint.ts`（`makeThinkHint()` 规则引擎）。

**实现要点与已知限制**：信号优先级：联网搜索 > 核对原文 > 章节比较 > 读者偏好 > 挑书推荐 > 书名兜底 > 通用首句；提示最多 1 次/秒防闪烁；超 24 字截为 23 字+省略符；提示句硬性排除工具名、book_id、系统提示词、报错文本。限制：纯规则匹配，覆盖不到的思考内容回退通用句。

### 1.4 文字水波纹扫光（ShimmerText）〔本轮新增·T8〕

**一句话描述**：所有「进行中」等待文案用一道高光从左到右扫过的水波纹动效呈现，全仓替代省略号/跳点。

**前端入口**：智学思考态、工具状态文案等待处自动出现。

**后端接口**：纯前端。

**关键代码**：`D:\ClaudeCode\AI_library\components\chat\ShimmerText.tsx`；动画定义在 `D:\ClaudeCode\AI_library\app\globals.css`（`.shimmer-win` 系列）。

**实现要点与已知限制**：双层文字——基底淡墨全文 + 上层青瓷高光窄窗（容器宽 36%），窗口 `translateX` 扫动、文字反向补偿位移，视觉上文字纹丝不动只有光掠过；纯 transform 合成器动画，0 paint/0 layout，60fps；配套地，本轮把全仓 UI 文案中的省略号清零（「加载中…」→「加载中」等，涉及泡馆/阅读器/我的/设置多处文件）。

### 1.5 Agent 工具循环与失配三层加固〔本轮修改·T3：三层加固 + 轮次上限 5→8〕

**一句话描述**：模型可多轮调用工具（生成调用 → 服务端执行 → 结果回灌 → 继续生成），最多 8 轮；「正文说出了卡、卡却没出」的失配由三层机制兜底，实测 10 轮零失配。

**前端入口**：无独立入口，作用于所有对话。

**后端接口**：在 `POST /api/chat` 内部完成（`runAgent()` 循环）。

**数据库表**：经各工具间接读 `books`/`chapters`。

**关键代码**：`D:\ClaudeCode\AI_library\app\api\chat\route.ts`（`runAgent()`、失配检测与补救轮）；`D:\ClaudeCode\AI_library\lib\server\tools.ts`（`execTool()`）。

**实现要点与已知限制**：三层加固——①工具事件直带展示字段（书名/章题/60 字摘要），前端零查询直渲染，消灭「卡片拉数据失败」一类失配；②流结束后失配监测：正则识别「正文承诺卡片却无工具调用」「细读过章节却无引用卡」「推荐意图+提了馆藏书名+零卡片」三种模式，命中则追加一轮温度 0.3 的补救请求（指示「只许出卡不许出字」）；③轮次耗尽时仅放行纯出卡工具（recommend_books/cite_chapters），其余丢弃不丢卡。轮次上限由 5 上调至 8（M3 多步规划强，toc→多章细读→出卡是常态）。限制：补救轮仍失败时只记日志，极端情况下正文与卡片可能不一致。验证：`scripts/verify-cards-10rounds.mjs` 10 轮零失配（兜底层实际拦截过一次失配）。

### 1.6 荐书 —— 推荐书目卡（recommend_books 工具）〔本轮修改：随 T3/T5 加固〕

**一句话描述**：用户要推荐时，模型先讲理由、再调工具弹出 1~5 本馆藏书卡片（封面+书名+作者+个人化徽标），点卡直达书页。

**前端入口与交互流程**：智学中问「推荐本书」类问题 → 正文中说明理由 → 推荐卡横滑列表在正文中间位置亮相（fade-up）→ 点卡跳 `/library/book/{id}`。卡上按本人数据叠徽标：「已读完」（文字 pct≥100 或媒体 played≥90%）/「在读 N%」/「在书架」（已收藏）。

**后端接口**：`POST /api/chat` 内工具执行：参数 `{book_ids: string[]}`（≤5），服务端 `books` 表 `select id,title where id in (...)` 校验真伪——馆藏不存在的 id 直接报「失败」给模型，反幻觉；成功发 `recs` 事件。

**数据库表**：`books(id, title)`；徽标判定用前端本地 store（text_progress/media_progress/favorites 的内存镜像）。

**关键代码**：`D:\ClaudeCode\AI_library\lib\server\tools.ts`；`D:\ClaudeCode\AI_library\app\chat\page.tsx`（`resolveRecBooks()` 预取封面）；`D:\ClaudeCode\AI_library\components\chat\ChatMessage.tsx`（`RecsBlock`）。

**实现要点与已知限制**：System 铁律强约束「推荐必调工具、id 必须来自书单」，工具调度规则写成「不调用=失败」级强措辞 M3 才稳定服从；馆里没有的书绝不推荐（问《三体》会如实说没有并荐相近馆藏书）。

### 1.7 书本答疑 —— 读取书本目录（read_book_toc 工具）〔本轮修改：随 T3/T5 加固〕

**一句话描述**：模型答疑前先「翻目录」——获取某本书全部章节的标题与 AI 概要，确定细读哪一章。

**前端入口**：用户问某本馆藏书内容时自动触发；用户可见状态文案「翻开《书名》」（水波纹）。

**后端接口**：工具参数 `{book_id}`；服务端查 `books(id,title,author,tags,ai_digest)` + `chapters(no,title,ai_summary,content) order by no`，拼成「第 N 章《标题》：概要」清单回灌模型；前言（no=0）缺 ai_summary 时用正文开头兜底。

**数据库表**：`books.ai_digest`（全书 AI 摘要）、`chapters.ai_summary`（每章 AI 概要）。

**关键代码**：`D:\ClaudeCode\AI_library\lib\server\tools.ts`。

**实现要点与已知限制**：目录只回概要不回全文，控 token；书 id 无效时返回明确失败文案供模型纠错。

### 1.8 章节细读（read_chapter 工具）〔本轮修改：随 T3/T5 加固〕

**一句话描述**：模型获取某一章完整原文（截前 1.5 万字），用于回答涉及具体内容、需要引用原文的问题。

**前端入口**：自动触发；状态文案「细读《书名》第 N 章」（chapter_no=0 显示「前言」）。

**后端接口**：工具参数 `{book_id, chapter_no}`；服务端查 `chapters(no,title,content) where book_id=? and no=?`，content 截 15000 字回灌。

**数据库表**：`chapters(book_id, no, title, content)`。

**关键代码**：`D:\ClaudeCode\AI_library\lib\server\tools.ts`。

**实现要点与已知限制**：调用后置位 `usedReadChapter` 标志，是失配监测第②层（细读过却没出引用卡）的信号源；超长章节超出 1.5 万字部分不可见。

### 1.9 出处引用卡（cite_chapters 工具）〔本轮修改：随 T3/T5 加固〕

**一句话描述**：回答依据了具体章节时，文末弹出可点击的「出处卡」（封面+《书名》第 N 章+章题+60 字摘要），点卡直跳原文该章。

**前端入口与交互流程**：纵向卡列表；卡上按本人进度标注「你正读到这里」/「你读过这章」；点卡跳 `/library/book/{id}/read?ch={bookId}-c{no}` 打开阅读器并定位该章。

**后端接口**：工具参数 `{items:[{book_id, chapter_no}]}`（≤4）；服务端逐章并查 `books`（书名/封面/seed）+ `chapters`（章题/正文前 60 字 snippet），发 `cites` 事件（字段 b/c/bt/ct/sn/cs/cv）。

**数据库表**：`books(title, cover_url, cover_seed)`、`chapters(no, title, content)`。

**关键代码**：`D:\ClaudeCode\AI_library\lib\server\tools.ts`；`D:\ClaudeCode\AI_library\components\chat\ChatMessage.tsx`（`CitesBlock`）。

**实现要点与已知限制**：引用不存在的章节会被服务端拦下并告知模型失败；进度标注来自前端本地 store，离线/游客无标注。

### 1.10 联网搜索（web_search 工具 + 来源卡）〔本轮新增·T10〕

**一句话描述**：问题涉及时效性内容（新闻/近况/最新出版/当下日期）时，小涤直调 MiniMax TokenPlan 搜索端点联网查询，结果以编号来源卡展示，点卡新标签打开原网页。

**前端入口与交互流程**：自然提问触发（如「最近有什么新书出版」）；状态文案「正在网上帮你查」；回答正文不罗列链接，来源卡（编号徽章+标题+域名+日期+外链箭头）由系统统一渲染在正文对应位置；点卡 `target=_blank` 打开，仅放行 http/https 协议（javascript:/data: 等降级纯文本，防注入）。

**后端接口**：服务端 `POST https://api.minimaxi.com/v1/coding_plan/search`，请求体 `{"q": query}`，请求头 `Authorization: Bearer MINIMAX_API_KEY` + `MM-API-Source: Minimax-MCP`，超时 20 秒；取前 5 条、单条摘要截 200 字，发 `web` 事件。

**数据库表**：无（结果随消息 content 的占位标记落入 `chat_sessions.messages`）。

**关键代码**：`D:\ClaudeCode\AI_library\lib\server\websearch.ts`（`searchWeb()`）；`D:\ClaudeCode\AI_library\lib\server\tools.ts`；`D:\ClaudeCode\AI_library\components\chat\ChatMessage.tsx`（`WebBlock`）。

**实现要点与已知限制**：System 强约束触发边界——馆藏书目内容、读书方法等常规问题严禁联网（实测 6/6 触发/不触发边界正确，证据 `docs/delivery/evidence/T10/`）；技术路线为扒包所得的底层 HTTP 端点直调（官方 MCP 为 Python stdio，Vercel 无 Python 不可移植），**该端点非公开文档接口，存在上游变更风险**；搜索失败时模型被告知失败、正文如实说明。

### 1.11 卡片交错渲染（占位标记机制）〔本轮修改：新增 web 标记一类 + 随 T3 加固〕

**一句话描述**：三类卡片（推荐/引用/来源）不是堆在气泡末尾，而是按工具调用的真实位置插在正文中间——模型先说理由→出卡→接着说后话。

**前端入口**：所有带卡对话自动生效。

**后端接口**：纯前端机制（服务端事件天然发生在两轮文本之间）。

**数据库表**：占位标记随 `content` 字符串落入 `chat_sessions.messages`，历史回显按位置还原。

**关键代码**：`D:\ClaudeCode\AI_library\lib\chatMarkers.ts`（`splitCardSegments()` / `stripCardMarkers()` / `hasCardMarker()`）；`D:\ClaudeCode\AI_library\app\chat\page.tsx`（事件到达时往正文插标记）；`D:\ClaudeCode\AI_library\components\chat\ChatMessage.tsx`（按标记切段、段间渲染卡组）。

**实现要点与已知限制**：标记格式 `[[recs:起,止]]` / `[[cites:起,止]]` / `[[web:起,止]]`（指向消息对象上对应数组的区间）；打字机推进遇标记区间一步跨过，不露半截标记；喂回模型的上下文与复制文本都先剥标记；无标记的老消息回退末尾渲染（兼容历史+中途停止不丢卡）。验证 `scripts/verify-chat-cards.mjs`（含「卡前有正文、卡后有正文」交错断言）。

### 1.12 个性化 System 变量注入（小涤「懂你」）〔本轮修改：新增记忆变量 + 随 M3 调整〕

**一句话描述**：每次对话的 System Instruction 动态注入馆藏书单与读者全量画像，让小涤天然知道「你是谁、读过什么」。

**前端入口**：无（服务端拼装）。

**后端接口**：`POST /api/chat` 内 `buildSystem()`；身份由请求头 Bearer token 经 `getUid()` 验证。

**数据库表与变量来源**：①图书馆书单——`books`+`categories`（每行 `[id]《书名》作者|分类|标签|概要`，10 分钟缓存）；②昵称+学习总时长——`profiles(nickname, read_seconds)`；③已读完书单（含笔记摘录≤10 条、书评前 200 字）——`text_progress(pct≥100)`+`media_progress(played≥0.9)`+`notes`+`reviews`；④在读书单（同样带笔记/书评）；⑤收藏书单——`favorites`；⑥压缩历史摘要——`chat_sessions.compressed_history`；⑦长期记忆——`user_memory` 各维度。游客仅注入①。

**关键代码**：`D:\ClaudeCode\AI_library\lib\server\agent.ts`（`buildSystem()` / `userVars()` / `libraryVar()`）。

**实现要点与已知限制**：System 末尾铁律——只推荐馆藏、绝不编造；Markdown 排版但禁表格（手机排版差，渲染层还有兜底降级）；荐书/出处/原文必须调对应工具。限制：书单缓存 10 分钟，新导入书在缓存期内对小涤不可见。

### 1.13 Memory 长期记忆系统〔本轮新增·T7〕

**一句话描述**：每用户一行 7 维度记忆（身份/阅读偏好/兴趣/聊天风格/个人事实/近期关注/待跟进），对话后由 M3 异步提炼更新——清空聊天记录后小涤仍「记得你」。

**前端入口**：无显式入口；效果体现在小涤的问候、推荐与措辞中（System 注入，要求自然体现、绝不生硬复述）。

**后端接口**：流结束后 `waitUntil(maybeUpdateMemory)` 异步执行：延迟 3.5 秒（等前端把消息 persist 上云）→ 读 `chat_sessions.messages` 取 `processed_until` 之后的新消息（攒够 4 条才触发）→ M3（温度 0.2，超时 45s）输出 `{维度:新值}` JSON → 每维硬截 ≤300 字 → upsert `user_memory`（只写模型给出的维度，未提及维度保旧值）。

**数据库表**：`user_memory(user_id PK, identity, reading_pref, interests, chat_style, facts, recent_focus, follow_ups, processed_until, updated_at)`，RLS 仅本人可读写（建表 SQL：`docs/后端_T7记忆表SQL.md`）。

**关键代码**：`D:\ClaudeCode\AI_library\lib\server\memory.ts`；`D:\ClaudeCode\AI_library\app\api\chat\route.ts`（触发点）。

**实现要点与已知限制**：单实例内有 inflight 防重；提炼输入做请求口径净化（滤 error 消息、剥卡片标记）；验收 7/7（清史后仍记得职业/猫名、TTFB 无差、RLS 隔离，证据 `docs/delivery/evidence/T7/`）。已知限制：多 serverless 实例并发时 `processed_until` 无数据库级 CAS，极端交错下可能旧写晚到覆盖（见附录改进建议第 7 条）。

### 1.14 上下文压缩（超长对话不失忆）〔本轮修改·T5：摘要模型切 M3、目标放宽至约 5K tokens〕

**一句话描述**：会话超过 48 条消息后，最近 20 轮之前的旧消息被异步压成摘要注入 System，原始消息永久保留——聊得再久旧事仍记得。

**前端入口**：无感知（后台自动）。

**后端接口**：流结束后 `waitUntil(maybeCompress)`：按请求口径计算待压范围 → M3（温度 0.3，maxTokens 8192，超时 100s）生成摘要 → 产物 <50 字视为失败不落库待重试 → 写 `compressed_history`（≤16000 字）+ `compressed_until`（消息下标）。

**数据库表**：`chat_sessions.compressed_history / compressed_until`。

**关键代码**：`D:\ClaudeCode\AI_library\lib\server\compress.ts`（含 `requestView()` 统一请求口径视图）。

**实现要点与已知限制**：触发阈值 = KEEP(40 条) + BATCH_MIN(8 条)；摘要覆盖 `[0, compressed_until)`、请求只发其后的消息，两段严格互补无「上下文黑洞」（T1 终审修复项）；压缩≠删除，原始消息全量在库。500K token 阈值在本应用以消息条数等价代理。

### 1.15 全局单一会话窗口与跨设备连续〔本轮修改·T4：由多会话架构重构为单一会话〕

**一句话描述**：智学不再有「历史会话列表/新建会话」，每位用户全局唯一一条对话（云端 `id='main'`），换设备登录无缝接着聊。

**前端入口与交互流程**：进入 `/chat` 直接是唯一对话；切 Tab 再回来画面原地；刷新/换手机登录消息全在。原 `/chat/history` 历史会话页已删除（本轮删文件）。

**后端接口**：Supabase 直连 `chat_sessions`——读 `select * where user_id=? and id='main'`；写 upsert（onConflict `user_id,id`），落库前剥流式中间态字段（streaming/toolNote）。

**数据库表**：`chat_sessions(user_id, id) 复合主键`；迁移时建有备份表 `chat_sessions_backup_t4`（旧多会话 51 行 → 3 条 main 零丢失，记录见 `docs/delivery/evidence/T4/迁移记录.md`）。

**关键代码**：`D:\ClaudeCode\AI_library\lib\store.ts`（`useChat`：loadCloud / persist v2 迁移）；`D:\ClaudeCode\AI_library\lib\supabase\userdata.ts`（`loadMainSession()` / `chatDb.upsert()`）。

**实现要点与已知限制**：跨设备合并按消息 id 并集去重、按 id 内时间戳排序；游客消息标 `ownerUid="guest"` 本地保存，登录后并入云端并回传；归属不明的 `legacy` 消息不并入（防串号）；共享体验账号（demo@ailibrary.app）登录只读云端、本地不上传（根治多设备脏数据源头）；换账号 `purgeForeign()` 清残留 + 世代校验防晚到数据回写。限制：同账号双标签同时狂聊仍可能互覆（远期项）。

### 1.16 欢迎页（登录/游客两态开场）〔原有未动〕

**一句话描述**：冷启动进入智学时展示时段问候 + 小涤近况汇报 + 4 个按个人数据动态生成的示例问题。

**前端入口与交互流程**：登录态——「早上好，昵称」（5 时段问候）+ 开场白汇报（已读 H 小时、《书名》读到 M%，附「继续读这本」「给我荐一本」按钮，纯本地拼装 0 token）+ 示例问题按 在读>刚读完>收藏未开读>有笔记 优先级生成；游客态——自我介绍 + 示例问题全部来自真实馆藏 + 一句登录钩子「登录后，小涤能记得你读过的每一本书」。点示例问题即发送。

**后端接口**：纯前端（数据来自本地 store 与 `getHome()` 缓存）。

**关键代码**：`D:\ClaudeCode\AI_library\lib\chatWelcome.ts`（`greeting()` / `buildQuestions()` / `buildGuestQuestions()`）；`D:\ClaudeCode\AI_library\app\chat\page.tsx`（`Welcome` 组件）。

**实现要点与已知限制**：游客示例问题根除了老 mock「点出馆里没有的书」的尴尬；开场白不调用 LLM，零成本。

### 1.17 语音输入（长按说话）〔本轮新增·T6〕

**一句话描述**：长按输入区说话，实时出字，松手回填输入框确认后发送；上滑取消，微信级交互。

**前端入口与交互流程**：输入框无焦点时按住 350ms 触发 → 录音浮层（实时识别文本 + 大麦克风圆钮 + ping 光晕 + 7 柱音量波形 + MM:SS 计时 + 「上滑取消」提示）→ 边说边出字（定稿+候选两层）→ 松手：识别文本回填输入框（截 500 字）供确认编辑；上滑 >90px 切红色取消态，松开丢弃；无识别结果提示「没听清，再试一次或打字告诉我」。

**后端接口**：**纯前端**——浏览器原生 Web Speech API（`SpeechRecognition`，lang=zh-CN，continuous + interimResults）；音量波形并行走 `getUserMedia({audio}) + AudioContext FFT`（失败不阻断识别，波形退化为呼吸动效）。

**数据库表**：无。

**关键代码**：`D:\ClaudeCode\AI_library\lib\useVoiceInput.ts`（识别引擎/续录/音量分析）；`D:\ClaudeCode\AI_library\app\chat\page.tsx`（长按手势、浮层 UI）。

**实现要点与已知限制**：选型背景——MiniMax 实测无 ASR 接口（任务书前提与现实不符，证据 `docs/delivery/evidence/T6/asr-investigation.md`），拒绝引入需新密钥的第三方 ASR；iOS Safari 14.5+（Siri 后端，国内可用）与桌面 Chrome/Edge 支持，**不支持的环境（部分安卓浏览器/微信内置）优雅降级**：toast「当前浏览器不支持语音输入，可以用键盘自带的语音键」；iOS 静音自动 end 时自动续录保留已定稿文本；启动期间松手（`voiceAborting`）不进录音态。自测 8/8（含 pointerleave 自杀 bug 修复、getUserMedia 不 await 防阻塞启动）。

### 1.18 点赞 / 点踩与反馈闭环〔本轮修改：踩原因在重新生成时真实喂回模型〕

**一句话描述**：每条回答可赞/踩，踩可选原因（推荐偏差/答疑有误/解读没用/其它+自填）；被踩的回答重新生成时，原因会作为指示喂回模型。

**前端入口与交互流程**：回答操作栏 👍/👎 → 踩弹原因浮层（多选标签+自定义输入）→ 提交 toast「收到啦，下次我注意」→ 已反馈状态显示「已反馈·原因」并可再编辑。

**后端接口**：随消息对象写穿透 `chat_sessions.messages`（jsonb 内字段 `feedback: 'up'|'down'`、`feedbackReasons: string[]`、`feedbackText`），无独立接口。

**关键代码**：`D:\ClaudeCode\AI_library\app\chat\page.tsx`（`setFeedback()` / `setFeedbackDetail()`）；`D:\ClaudeCode\AI_library\components\chat\ChatMessage.tsx`（反馈 UI 与浮层）。

**实现要点与已知限制**：重新生成时注入一次性指示「你上一条回答被我标记了「理由」，请换个角度重新回答」——不渲染不落库；反馈数据仅自用，无后台聚合看板。

### 1.19 停止生成 / 重新生成 / 复制〔本轮修改：复制剥卡片标记、重生防旧闭包〕

**一句话描述**：流式中可随时停止（已出内容保留）；最后一条回答可重新生成；正文一键复制。

**前端入口与交互流程**：流式中显示「停止」钮 → `AbortController.abort()`，提示「好，先停在这里。想继续随时叫我」；非流式时最后一条回答显示「重新生成」→ 删旧答、带踩原因重发；「复制」→ 剥 `[[recs:…]]` 等占位标记后写剪贴板。

**后端接口**：停止=客户端中断 HTTP 流；其余复用 `POST /api/chat`。

**关键代码**：`D:\ClaudeCode\AI_library\app\chat\page.tsx`（`stop()` / `regenerate()`）。

**实现要点与已知限制**：中途停止已出的卡片不丢（无标记回退末尾渲染）；重新生成传「截掉旧回答的消息列表」为基底，防旧闭包把已删内容混回上下文（T1 修复项）。

### 1.20 智学接口限流〔本轮修改·T9：登录 10/分+80/时 → 20/分+200/时，游客收紧为 8/分+40/时〕

**一句话描述**：登录用户每分钟 20 次、每小时 200 次；游客每分钟 8 次、每小时 40 次（按 IP）——防脚本烧 AI 费用，正常使用无感。

**前端入口**：超限时收到 429，气泡显示小涤口吻文案。

**后端接口**：`POST /api/chat` 入口处检查；超限返回 `429 {"error":"你问得好快呀——歇口气，一分钟后我们接着聊"}`。限流键：登录按 `uid`、游客按 `ip:{IP}`。

**数据库表**：无（进程内存滑动窗口）。

**关键代码**：`D:\ClaudeCode\AI_library\lib\server\ratelimit.ts`。

**实现要点与已知限制**：内存键超 5000 个触发全量清扫防泄漏；**内存级限流在 Vercel 多实例下是「每实例各自计数」**，真实放行量可能略大于标称值（可接受，目的为防滥用而非精确配额）；实测恰在阈值第 21/9 次触发（`scripts/verify-ratelimit-t9.mjs` 3/3）。

### 1.21 贴底跟随与「回到最新」浮钮〔原有未动〕

**一句话描述**：流式输出时消息区贴底自动跟随；用户上滑回看历史即停止强拽，浮出「回到最新」按钮一键回底。

**前端入口**：流式中上滑即触发。**后端接口**：纯前端。

**关键代码**：`D:\ClaudeCode\AI_library\app\chat\page.tsx`（贴底检测：离底 <80px 视为在底；scroll 事件 RAF 节流）。

**实现要点**：此为上一轮 UI Review 的 P0 修复（旧版每帧强拽回底导致无法回看）。

### 1.22 输入框多行自适应与 500 字限制〔原有未动〕

**一句话描述**：textarea 随内容自动撑高（上限 96px 后内滚），输入达 450 字起显示计数、500 字截断并提示。

**后端接口**：纯前端。**关键代码**：`D:\ClaudeCode\AI_library\app\chat\page.tsx`（`onInputChange()`；toast「一次最多 500 字，长段落可以分两次发我」只提醒一次）。

### 1.23 消息本地缓存与中间态恢复〔本轮修改：随 T4 重构〕

**一句话描述**：对话在本地持久化（localStorage `ail-chat`，版本 v2 带迁移），切 Tab/刷新回来画面原地；上次没生成完的消息自动修复为「点重新生成再试」占位。

**后端接口**：纯前端 + 云端 `chat_sessions` 双层。

**关键代码**：`D:\ClaudeCode\AI_library\app\chat\page.tsx`（模块级 `chatLive` 缓存、`normalizeMsgs()`）；`D:\ClaudeCode\AI_library\lib\store.ts`（persist v2 迁移：多会话→main 合并）。

**实现要点与已知限制**：超长会话前端只渲染最后 120 条（RENDER_WINDOW），更早消息在云端与摘要中完整保留。

### 1.24 错误处理与降级文案〔本轮修改：T2 轮 17 处客服腔文案换小涤口吻〕

**一句话描述**：断网/上游失败/限流各有差异化处理，全部用小涤口吻而非系统报错腔。

**交互细节**：中途断线已有正文→保留内容+尾注「后面断线了，可点重新生成补全」；零内容失败→错误占位+「网络有点不稳，缓一缓再问我一次吧」；上游 502→「我这边信号不太好，稍等片刻再来找我吧」；error 占位消息打标记，**不会被喂回模型上下文**（请求口径过滤）。

**关键代码**：`D:\ClaudeCode\AI_library\app\chat\page.tsx`；`D:\ClaudeCode\AI_library\app\api\chat\route.ts`；`D:\ClaudeCode\AI_library\lib\server\compress.ts`（`requestView()` 过滤）。

---

## 二、泡馆 —— 图书馆主页与搜索

### 2.1 开屏页〔原有未动〕

**一句话描述**：3 秒品牌开屏（馆徽+「一座懂你的智慧图书馆」），期间静默预热首页数据，可跳过。

**前端入口与交互流程**：访问 `/` → 开屏展示 + 倒计时 + 「跳过」钮 → 3 秒后或点跳过 `router.replace("/library")`。

**后端接口**：纯前端；后台 `prefetchQuery(["home"])` 预拉 `getHome()`。

**关键代码**：`D:\ClaudeCode\AI_library\app\page.tsx`。

**实现要点与已知限制**：背景图 `/splash.webp` 缺失自动回退青瓷渐变；rAF 节流倒计时。

### 2.2 首页轮播 Banner〔原有未动〕

**一句话描述**：横滑大卡轮播，每个分类各取最新入库一本，下方指示点同步高亮。

**前端入口与交互流程**：`/library` 顶部横滑 → 点卡进书籍详情页。

**后端接口**：Supabase 直连 `getHome()` 一次查全：`categories` 表 `select * order by sort_order` + `books` 表 `select *, category:categories(name) order by shelved_at desc`；Banner = 每分类按 `shelved_at` 倒序取首本。

**数据库表**：`books(id,title,author,cover_url,cover_seed,category_id,shelved_at,summary,tags)`、`categories(id,name,icon,sort_order)`。

**关键代码**：`D:\ClaudeCode\AI_library\app\library\page.tsx`；`D:\ClaudeCode\AI_library\lib\api.ts`（`getHome()`）。

**实现要点与已知限制**：当前卡索引按相邻卡 `offsetLeft` 差计步长 + rAF 节流推算（指示点逻辑）。

### 2.3 分类导航（含册数统计）〔原有未动〕

**一句话描述**：2 列分类网格，每类显示真实册数与 lucide 图标，点击进分类页。

**后端接口**：`getHome()` 内 `countByCategory()` 按 `category_id` 实时分组计数（计算属性不入库）。

**数据库表**：`categories.icon`（图标名）；册数由 `books` 聚合。

**关键代码**：`D:\ClaudeCode\AI_library\app\library\page.tsx`；`D:\ClaudeCode\AI_library\lib\api.ts`。

### 2.4 首页「继续阅读」〔原有未动〕

**一句话描述**：把未读完的文字稿在读书目（≤5 本，按最近阅读倒序）放在首页显眼处，一键回到阅读器。

**前端入口与交互流程**：仅当本人有 `mode="text"` 且 progress<100 的历史时显示 → 点卡进 `/library/book/{id}/read` 自动续读。

**后端接口**：纯前端（数据来自 store 的 `useLibrary.history`，登录时已由 `loadUserData` 从 `reading_history` 拉取）。

**关键代码**：`D:\ClaudeCode\AI_library\app\library\page.tsx`（continueList 计算）。

**实现要点与已知限制**：等 `hydrated=true` 后再渲染防首帧闪烁。

### 2.5 热门好书〔原有未动〕

**一句话描述**：首页书单按「入库时间从最早到最近」排序（用户钦定规则），本人已读完的书自动隐去，取前 20 本。

**后端接口**：`getHome()` 返回 `shelved_at` 升序列表；「排除已读完」在前端按本人 progress≥100 过滤。

**数据库表**：`books.shelved_at`；过滤依据 store 中 text/media 进度。

**关键代码**：`D:\ClaudeCode\AI_library\app\library\page.tsx`（hot 计算）。

### 2.6 分类页（双维筛选 + 无限滚动）〔本轮修改：仅文案省略号清零〕

**一句话描述**：按「音视频/文字稿」阅读类型 + 「全部/进行中/已读/未读」状态双维筛选分类书目，下滑自动翻页。

**前端入口与交互流程**：`/library/category/{id}` → 顶部类型下拉 + 状态 Pill（非「全部」需登录，`requireLogin` 拦截）→ IntersectionObserver 哨兵提前 200px 触发 `fetchNextPage`；稀疏筛选当前页为空时自动续拉。

**后端接口**：Supabase 直连 `getBooks({categoryId, readingType, cursor})`：`eq("category_id")`；类型 av→`or("has_video.eq.true,has_audio.eq.true")`、text→`eq("has_text",true)`；`range(cursor, cursor+5)` 每页 6 条。

**数据库表**：`books(category_id, has_video, has_audio, has_text, shelved_at)`。

**关键代码**：`D:\ClaudeCode\AI_library\app\library\category\[id]\page.tsx`（`progOf()`/`doneOf()`/`pickStatus()`）；`D:\ClaudeCode\AI_library\lib\api.ts`（`getBooks()`）。

**实现要点与已知限制**：读完口径双轨——音视频 `mediaPlayed≥0.9`、文字 `pct≥100`；状态筛选在前端内存进行（每页 6 条逐页拉）。

### 2.7 书籍详情页〔本轮修改：章节目录改轻量查询 getChapterList，不再拉正文〕

**一句话描述**：一本书的总入口——媒体播放台（视频/音频）、书名标签简介、收藏、章节目录、我的评价、底部「继续阅读」常驻 CTA。

**前端入口与交互流程**：`/library/book/{id}`。顶部媒体台按字段自动决定形态：纯视频 / 纯音频 / 双模式可切 / 无媒体仅封面；简介超 3 行出「展开全文」；`hasText` 时列章节目录（序章显示「序」，各章带 已读✓/在读/未读 状态），点章直达阅读器对应章；「我的评价」区已写显示本人书评卡、未写显示空态+「写书评」；底部 sticky CTA：有文字进度显示「继续阅读·第 N 章·M%」，无进度「开始阅读」，纯音视频书则为「播放视频/音频」（滚回顶部播放台）。

**后端接口**：Supabase 直连两查——`getBook(id)`（`select *, category:categories(name)`）+ `getChapterList(id)`（`select id,book_id,no,title,audio_start`，**不含 content**，且仅 `hasText=true` 才发起）。

**数据库表**：`books`（含计数列 `fav_count/rating/review_count/read_count/readers`，存而不展示）、`chapters`、`categories`。

**关键代码**：`D:\ClaudeCode\AI_library\app\library\book\[id]\page.tsx`；`D:\ClaudeCode\AI_library\components\library\Players.tsx`（`BookMediaHero`）；`D:\ClaudeCode\AI_library\lib\api.ts`（`getBook`/`getChapterList`）。

**实现要点与已知限制**：本轮把详情页目录从全量 `getChapters`（连正文数百 KB~MB）改为轻量清单，手机省流；书查询成功但无行 → 走 404 文案（见 2.11），与网络错误（可重试）严格区分。

### 2.8 视频播放器（详情页内）〔原有未动〕

**一句话描述**：原生 video 自绘控制层——倍速 5 档、自绘竖屏全屏、静音、进度拖动，看到哪记到哪。

**前端入口与交互流程**：详情页媒体台点播放 → 若有历史进度（0~99%）自动 seek 续播 → 点画面暂停/继续；倍速钮循环切 0.75/1/1.25/1.5/2；全屏为自绘（非浏览器原生，支持竖屏），进入时 `history.pushState` 压栈，**系统返回手势只退全屏不退页面**。

**后端接口**：进度经 store 写穿透 Supabase `media_progress`（见 4.9 同一机制）；播放中 `useReadingClock` 计学习时长、`useReadCountBump` 满 30 秒记一次阅读。

**数据库表**：`media_progress(user_id, book_id, position, played)`。

**关键代码**：`D:\ClaudeCode\AI_library\components\library\Players.tsx`（`VideoStage`、`useHistoryReporter`：`trackPlayed()` 真实播放增量 0~1.5s 才累计 / `seekReset()` 拖动后重置基准 / `report()` 5 秒节流 / `flush()` 暂停立即落）。

**实现要点与已知限制**：`position`（续播位置）与 `played`（真实覆盖量，只增）双字段分离——拖动大跳不虚增观看量；非全屏画面裁切铺满不留黑边。

### 2.9 音频播放器（听书）〔原有未动〕

**一句话描述**：唱片台座视觉的整本朗读播放器——环形进度大按钮、±15 秒快进退、倍速 5 档、两段式拖动进度条。

**前端入口与交互流程**：详情页音频模式 → 播放时唱片旋转；拖动进度条时只移滑块（`scrub` 临时值），松手 `commitSeek` 才真正定位；±15 秒钮 `skipBy(±15)`。

**后端接口/数据表**：同视频（`media_progress` + 时长/次数埋点）。

**关键代码**：`D:\ClaudeCode\AI_library\components\library\Players.tsx`（`AudioStage`；SVG 环形进度 strokeDashoffset）。

**实现要点与已知限制**：两段式拖动避免高频写 `audio.currentTime` 卡顿；封面加载失败降级书名首 2 字+渐变底。

### 2.10 收藏（点赞=收藏口径）〔原有未动〕

**一句话描述**：心形按钮收藏一本书（即业务口径的「点赞」），乐观更新、跨设备同步。

**前端入口与交互流程**：详情页心形钮 / 乱翻双击与右侧钮 → 未登录弹登录引导 → 已收藏再点取消。

**后端接口**：Supabase 直连 `favorites`：`insert {user_id, book_id}` / `delete where user_id=? and book_id=?`；`books.fav_count` 由数据库触发器自动 ±1。

**数据库表**：`favorites(user_id, book_id, created_at)`、`books.fav_count`。

**关键代码**：`D:\ClaudeCode\AI_library\lib\store.ts`（`toggleFav()` 写穿透）；`D:\ClaudeCode\AI_library\lib\supabase\userdata.ts`（`db.addFav`/`db.removeFav`）。

**实现要点与已知限制**：本地乐观反转，写库失败 toast；界面按用户要求不展示 fav_count 数字。

### 2.11 失效书 404 出路〔原有未动〕

**一句话描述**：打开不存在/已下架的书显示「书架上没有这一页」+ 一键回泡馆，与网络错误（可重试）区分。

**前端入口**：错误深链/已删书直达时触发。

**后端接口**：`getBook(id)` 查询成功但无行（区别于 isError）。

**关键代码**：`D:\ClaudeCode\AI_library\app\library\book\[id]\page.tsx`；路由级兜底 `D:\ClaudeCode\AI_library\app\not-found.tsx`。

**实现要点**：404 态不给重试钮（重试无意义）、返回用 `router.push("/library")`（深链无后退历史）。

### 2.12 全局搜索（最近搜索 + 真实热词 + 行为上报）〔本轮修改：isPlaceholderData 防误记历史/误报日志〕

**一句话描述**：按书名/作者/标签搜书；「最近搜过」可单删可清空；「热门搜索」来自全站真实搜索词聚合（双人阈值防刷），冷启动用书目补足。

**前端入口与交互流程**：首页搜索钮 → `/search` 自动聚焦 → 输入 300ms 防抖出结果（回车/点热词跳过防抖立即搜）→ 有结果时写入最近搜索（localStorage，最多 5 条）并延迟 1.2 秒上报日志；空输入态显示最近搜索 + 热门搜索 Pill。

**后端接口**：
- 搜索：Supabase 直连拉全部 `books` 后前端子串过滤 title/author/tags（代码注释明确：数据量大后改服务端 ilike + GIN/trgm）；
- 热词：RPC `get_hot_searches(p_limit=20, p_days=30)`（SECURITY DEFINER 聚合近 30 天 `search_logs`，仅保留仍命中馆藏的词，`having ≥2` 双人阈值防刷，参数钳制 + position() 通配符免疫）；RPC 失败或热词 <12 个时用最新 30 本书名（前 8）+ 高频标签补足；结果 10 分钟模块级缓存；
- 上报：`logSearch(term)` → `search_logs` insert `{term(≤50 字), user_id(游客为 null)}`，fire-and-forget。

**数据库表**：`search_logs(term, user_id nullable, created_at)`（pg_cron 90 天 TTL 自动清理）；`books(title, author, tags)`。

**关键代码**：`D:\ClaudeCode\AI_library\app\search\page.tsx`；`D:\ClaudeCode\AI_library\lib\api.ts`（`search()`/`getHotSearches()`/`logSearch()`）；`D:\ClaudeCode\AI_library\lib\store.ts`（`useUI.recentSearches`）。

**实现要点与已知限制**：1.2 秒延迟上报使输入中间态前缀词（打「认知觉醒」途中的「认」）被后续输入取消，不污染热榜；同 SPA 生命周期同词去重（模块级 Set）；本轮修复——换词瞬间 React Query 的 placeholder 旧数据会被误判「新词有结果」，现以 `isPlaceholderData` 排除，杜绝误记历史/误报日志。限制：搜索为前端子串匹配，无相关性排序。

---

## 三、阅读器（读全文）与书评

### 3.1 阅读器启动与续读恢复〔本轮修改·T1：续读决议门禁 resolved，根治进度被洗〕

**一句话描述**：进入阅读器自动回到上次读到的章节与章内精确位置；深链 `?ch=`/`?mark=` 优先。

**前端入口与交互流程**：详情页 CTA / 首页继续阅读 / 智学引用卡 → `/library/book/{id}/read`。恢复顺序：URL 参数 > 本地精确位置（localStorage `ail-chpos-{bookId}`，存章 id+章内比例）> 云端全书 pct 反算；定位后滚动到对应位置。

**后端接口**：Supabase 直连 `text_progress` upsert（onConflict `user_id,book_id`）；正文 `getChapters(bookId)` 全量拉取。

**数据库表**：`text_progress(user_id, book_id, last_chapter_id, last_chapter_no, pct, read_chapter_ids[])`。

**关键代码**：`D:\ClaudeCode\AI_library\app\library\book\[id]\read\page.tsx`（续读 effect、`pendingPct`、滚动恢复）。

**实现要点与已知限制**：本轮 P0 修复——新增 `resolved` 门禁：续读决议（含云端加载等待）完成前**禁止任何进度上报**，否则进入瞬间的「默认第 1 章 0%」会把云端精确位置洗掉；try-finally 保证所有路径都置位。本地精确位置精度优于云端整数 pct，跨设备时退化为按 pct 反算章内比例。

### 3.2 章节目录抽屉〔原有未动〕

**一句话描述**：侧滑抽屉列全书章节，当前章高亮圆点、已读章打✓，点击即切章。

**前端入口与交互流程**：底栏「目录」→ 抽屉左滑入（宽 50%、最大 360px）→ 自动把当前章滚到视野中央 → 点章 `gotoChapter()`（更新 URL `?ch=`、滚回顶）。

**后端接口**：纯前端（已读集来自 store 的 `readChapters`，源头 `text_progress.read_chapter_ids`）。

**关键代码**：`D:\ClaudeCode\AI_library\app\library\book\[id]\read\page.tsx`。

### 3.3 字号四档〔原有未动〕

**一句话描述**：16/18/20/22px 四档（小/中/大/超大）即点即生效，本地持久化。

**后端接口**：纯前端（Zustand `useReader` persist，key `ail-reader`）。

**关键代码**：`read/page.tsx`（FONT_STEPS）；`D:\ClaudeCode\AI_library\lib\store.ts`（`useReader.setFontSize`）。

**实现要点**：段距用 `my-[0.9em]` 相对单位随字号自适应。限制：偏好仅存本机，不云同步。

### 3.4 背景四色〔原有未动〕

**一句话描述**：白/米黄/护眼绿/深灰四种阅读背景，切换即生效并联动高亮配色。

**后端接口**：纯前端（`useReader.setBg`）。

**关键代码**：`read/page.tsx`（BG_OPTIONS）。

**实现要点**：深灰底下高亮透明度由 50% 降到 30% 并加下划线补强可读性（mark 背景 = 颜色 + `4D`/`80` alpha 后缀）。

### 3.5 亮度调节〔原有未动〕

**一句话描述**：滑块 0.5~1.0（步进 0.02）调正文容器 `brightness()` 滤镜。

**后端接口**：纯前端。**关键代码**：`read/page.tsx` 设置面板。

### 3.6 沉浸模式〔原有未动〕

**一句话描述**：点正文纵向中部 1/3 区域收起顶/底栏，隐藏时顶部出 1.5px 细进度线（本章进度）。

**后端接口**：纯前端。**关键代码**：`read/page.tsx`（`onContentClick()`，排除 mark/按钮/链接等交互元素；切章自动恢复工具栏）。

### 3.7 划线高亮与写想法（完整链路）〔本轮修改·T1：正文按章 `key` 重挂载，防命令式高亮 DOM 与 React diff 冲突白屏〕

**一句话描述**：选中文字 → 四色任选划线或直接写想法；选中文本**完整精确标记**（含跨段落），高亮可换色、想法可改可删，点高亮回看。

**前端入口与交互流程**：长按/拖选正文 → `selectionchange` 防抖 130ms 检出选区 → 浮出工具条（4 色点，上次用色排首带✓ + 「笔记」钮）→ 点色即划线；点「笔记」弹输入浮层（摘录预览底色=划线色，可改色）→ 保存；点已有高亮 → 浮层支持 查看想法/编辑想法/换色/删除；与已有划线重叠时拦截提示（防「保存成功却永不显示」的幽灵笔记）。

**后端接口**：Supabase 直连 `notes`：insert / update（仅 note 文本）/ delete；换色=删旧+新建同位笔记（无独立改色接口）。

**数据库表**：`notes(id, user_id, book_id, chapter_id, excerpt, note, color, start_offset, end_offset, created_at)`——offset 为章 textContent 坐标系字符偏移，写库前强制取整（防 Range 浮点写 int 列失败）。

**关键代码**：`read/page.tsx` —— `rangePointToOffset()`（TreeWalker 把 DOM Range 映射到 textContent 坐标，**根治跨段落划线失败的历史顽疾**：Selection.toString() 跨段会插 "\n\n" 而 textContent 不会）、`locate()`（重复文本就近匹配）、`applyHighlights()`/`wrapRange()`（splitText 包 `<mark>`，id=`mk-{noteId}`）、`overlapsExisting()`、`doHighlight()`/`recolorNote()`/`editThought()`。

**实现要点与已知限制**：高亮渲染是命令式 DOM 操作，本轮给正文容器加 `key={cur.id}` 按章整棵重挂载，杜绝 React diff 与 mark 节点冲突白屏；4 色固定（青瓷/黄铜/胭脂/淡墨）无自定义色；章节内容若被重新编辑，旧笔记按 excerpt 就近重定位，找不到则该条不显示（数据仍在）。

### 3.8 我的笔记面板与原文定位〔原有未动〕

**一句话描述**：底栏「笔记」列出本章全部划线（色块+摘录+想法），点击跳回原文并闪烁定位；「我的-笔记」页深链 `?mark=` 同样精确定位。

**后端接口**：纯前端（notes 已随 `loadUserData` 在库）。

**关键代码**：`read/page.tsx`（`?mark=` 轮询 `mk-{id}` 元素最多 25 次×150ms，找到 `scrollIntoView` + brightness 闪烁 1.2s，只定位一次）。

### 3.9 阅读进度上报与读毕判定〔本轮修改·T1：随 resolved 门禁联动加固〕

**一句话描述**：每 5 秒上报一次进度；只有「真读到底」才算读完本章——滚动 ≥95% 或内容不足一屏（活跃路径判定），退出时只落进度永不误打勾。

**前端入口**：阅读中自动进行。

**后端接口**：Supabase 直连双写——`text_progress` upsert + `reading_history` upsert（onConflict `user_id,book_id,mode_category`）；多设备合并由数据库触发器 `merge_text_progress` 保证（pct 取大、read_chapter_ids 取并集，旧设备快照不回退进度）。

**数据库表**：`text_progress`、`reading_history(mode_category='text', progress, last_at)`。

**关键代码**：`read/page.tsx`（5s `setInterval(report(true))`；读毕条件 `pct≥95 || scrollHeight-clientHeight≤4`；cleanup 路径 `allowMark=false` 仅落进度）；`D:\ClaudeCode\AI_library\lib\store.ts`（`setProgress`/`markChapterRead`/`pushHistory`，全部过 `canSync()` 双门禁 uid+hydrated）。

**实现要点与已知限制**：全书进度 = `(已读完章数+当前章比例)/总章数`，未全读完封顶 99%、全读完才 100%；历史顽疾（cleanup 时 scrollRef 为 null 误判「不足一屏」导致没读完也打勾）已在前轮根治、本轮回归通过。

### 3.10 读毕仪式卡〔原有未动〕

**一句话描述**：最后一章读完时出现胭脂色印章「读毕」+「全书 N 章·已读完」+「写一篇书评/回到书页」按钮。

**后端接口**：纯前端。**关键代码**：`read/page.tsx`（条件：当前章为末章且在已读集中）。

### 3.11 学习时长与「一次阅读」埋点〔原有未动〕

**一句话描述**：真实阅读/播放才计时（后台不算、挂机不算）——时长每 3 秒增量上云；同一会话累计 30 秒记一次书的阅读次数。

**前端入口**：阅读器/视频/音频/乱翻播放中自动进行。

**后端接口**：RPC `add_read_seconds(p_delta)`（**增量累加** `profiles.read_seconds`，多设备并行不互覆）；RPC `increment_read_count(p_book_id)`（`books.read_count+1`，SECURITY DEFINER，fire-and-forget）。

**数据库表**：`profiles.read_seconds`、`books.read_count`。

**关键代码**：`D:\ClaudeCode\AI_library\lib\useReadingClock.ts`（`useReadingClock()`：每秒累计、`visibilityState==="visible"` 才计、满 3 秒批量写、卸载 flush 零头；`useReadCountBump()`：满 30 秒一次、换书重置）。

**实现要点与已知限制**：read_count 口径=单次会话真实阅读/播放累计 ≥30 秒记 1 次，不按用户去重；该数据存而不展示。

### 3.12 正文 Markdown 渲染〔原有未动〕

**一句话描述**：react-markdown + remark-gfm + remark-cjk-friendly 渲染章节正文，新中式排版（衬线标题/青瓷引用线/列表），图片不渲染。

**后端接口**：纯前端（content 来自 `chapters.content`）。

**关键代码**：`read/page.tsx`（`mdComponents` 自定义各元素样式；按章 useMemo，划线变化不重渲正文）。

**实现要点**：remark-cjk-friendly 根治「**中文加粗**紧贴标点解析失败」的 CommonMark 顽疾。

### 3.13 书评撰写与编辑〔本轮修改·T1：深链返回兜底 goBack + 文案省略号清零〕

**一句话描述**：星级（必填，失望/一般/还行/推荐/力荐伴随文案）+ 标题（≤30 字可选）+ 内容（10~2000 字必填），一书一条、可改可删，写一半返回有确认。

**前端入口与交互流程**：详情页「写书评/更新书评」、阅读器读毕卡、乱翻右侧 💬 → `/library/book/{id}/review/new`；已有书评自动预填进编辑模式；点发布（防双击 submitLock）→ 未登录先弹登录、成功后续发 → toast 后返回；有改动未发布时返回弹「书评尚未发布，确定离开？」。

**后端接口**：Supabase 直连 `reviews` upsert（onConflict `user_id,book_id`，数据库唯一约束保证一书一评）；删除在「我的-书评」页。

**数据库表**：`reviews(id, user_id, book_id, rating 1-5, title, content, likes, created_at)`；`books.rating/review_count` 由触发器自动维护均分与条数。

**关键代码**：`D:\ClaudeCode\AI_library\app\library\book\[id]\review\new\page.tsx`（`doPublish()`/`goBack()`/dirty 判定）。

**实现要点与已知限制**：页面门禁等 `authHydrated && libHydrated` 双水合完成才初始化表单（防直刷时空表单提交洗掉云端旧书评）；本轮新增深链兜底——history 栈长 1 时 `router.replace` 回详情页（原 `router.back()` 在分享链接直开时无处可退）；编辑保留原 createdAt 防列表排序错乱。他人书评按用户口径只存数据不展示。

---

## 四、乱翻 —— 像刷短视频一样刷书

### 4.1 竖滑视频流与 3 解码器池〔本轮修改·T1/T8：快滑竞态 stillActive 守卫，根治旧槽复活后台播放〕

**一句话描述**：全屏竖滑视频流，上下滑切换、自动连播循环；无论刷多少本书，始终只有 3 个 `<video>` 解码器复用，100+ 本不崩。

**前端入口与交互流程**：底部导航「乱翻」→ `/flip` 自动播放第一条 → 上下滑切换（CSS scroll-snap 跟手）→ 滑到倒数第 2 条自动 `loadMore()` 续拉。

**后端接口**：见 4.4 getFlip。

**数据库表**：见 4.4。

**关键代码**：`D:\ClaudeCode\AI_library\app\flip\page.tsx` —— `SLOTS=3`、`slotOf(i)=((i%3)+3)%3`、`slotIdx()`（槽位在 [active-1, active, active+1] 窗口内分配）；video 绝对定位在滚动容器内随手指流动。

**实现要点与已知限制**：本轮修复快滑竞态四连环——`play()` Promise 落定时用户可能已滑走，旧逻辑会复活旧槽后台播放/静音污染/误弹提示/旧源错误盖新条，现统一加 `stillActive()`（比对 activeIdx 槽位）守卫；预加载窗口固定 ±1，连跳 5 屏以上会有解码等待。

### 4.2 每日个性化书单生成器（AI 日更）〔本轮修改·T5：排序模型切 M3 + 逐用户信号查询 + LLM 超时 20s 加固〕

**一句话描述**：每天凌晨为每位用户生成专属乱翻书单（≤50 本）：排除已读完、在读置顶、其余按收藏/笔记/书评/聊天画像由 AI 排序。

**前端入口**：用户无入口（Cron 自动）；效果次日打开乱翻可见。

**后端接口**：`GET /api/cron/flip-feed`，鉴权 `Authorization: Bearer <CRON_SECRET>`（无/错 → 401），参数 `?force=1` 跳过「当天已生成」检查强制重跑；`maxDuration=60`。

**数据库表**：读 `profiles`（全用户）、`books`（has_video 且 video_url 非空候选池）、`text_progress`/`media_progress`（读完/在读判定）、`favorites`、`notes`（每人 ≤8 条）、`reviews`（≤5 条）、`chat_sessions`（≤8 条摘要）；写 `flip_feed(user_id, gen_date, book_ids text[])` upsert（onConflict `user_id,gen_date`）。

**关键代码**：`D:\ClaudeCode\AI_library\lib\server\flipfeed.ts`（`generateFlipFeeds()`/`collectSignals()`/`rankByLLM()`/`fetchAll()` 分页拉全/`mapLimit()` 并发池/`bjToday()` 北京时区）；`D:\ClaudeCode\AI_library\app\api\cron\flip-feed\route.ts`。

**实现要点与已知限制**：排序流水线——候选剔除已读完 → 在读置顶 → 其余前 120 本交 M3（温度 0.3、超时 20s）按画像排序 → 拼接 → 取 50；LLM 失败/解析失败自动退最新入库序（llmFallback 计数，用户无感）；用户分批 24 人/批、批内 LLM 并发 4、总时间预算 50 秒，**按批落库可断点续做**（超时被掐已写批次永留，再调自动跳过）；无任何信号的新用户不写行（读侧回退）；`fetchAll` 规避 PostgREST 默认 1000 行静默截断；本轮把画像查询从批级共享 limit 改为逐用户 `mapLimit(8)`，防重度用户独占配额导致轻度用户被误判新用户。

### 4.3 Cron 定时调度〔原有未动〕

**一句话描述**：Vercel Cron 每天 UTC 20:00（北京时间次日 04:00）自动调用日更接口，线上已启用。

**后端接口**：`vercel.json`：`{"crons":[{"path":"/api/cron/flip-feed","schedule":"0 20 * * *"}]}`；Vercel 平台自动携带 CRON_SECRET。

**关键代码**：`D:\ClaudeCode\AI_library\vercel.json`。

**实现要点**：手动补跑：带 `Authorization: Bearer $CRON_SECRET` 调同一路径。

### 4.4 Feed 读取（个性化/回退双轨 + 缓存）〔原有未动〕

**一句话描述**：登录用户读最近一期个性化书单（严格保序）；游客/新用户回退最新入库 50 本有视频书；5 分钟缓存按账号隔离。

**前端入口**：进乱翻自动加载；续拉同源。

**后端接口**：Supabase 直连——`flip_feed` `order by gen_date desc limit 1` 取最近一期（当天 Cron 偶发失败自动退上一期）→ 按 `book_ids` 查 `books` 并**严格按 feed 序还原**；无行/游客 → `books where has_video=true order by shelved_at desc limit 50`。

**数据库表**：`flip_feed`、`books(has_video, video_url, shelved_at)`。

**关键代码**：`D:\ClaudeCode\AI_library\lib\api.ts`（`getFlip(seenIds)`、模块级 `flipPoolCache` 按 uid 隔离 5 分钟 TTL）。

**实现要点与已知限制**：首轮 `getFlip([])` 返回原序（个性化生效）；续拉传已看 id，池打乱重发、id 加 `__f{轮次}_{seed}` 后缀防 React key 冲突；返回 `owner` 戳防冷启动时把登录用户的池误标为游客缓存。

### 4.5 双击爆心收藏与右侧收藏按钮〔原有未动〕

**一句话描述**：双击屏幕爱心爆开（4 颗小心散飞）直接收藏；右侧 ❤ 按钮可收藏/取消并 toast。

**前端入口与交互流程**：双击（280ms 内二次 tap）→ 未收藏则收藏+爆心（已收藏双击无操作）；右侧钮单击切换，收藏时爆心+按钮弹跳。

**后端接口**：同 2.10（`favorites` 直连，`toggleFav` 写穿透）。

**关键代码**：`app\flip\page.tsx`（`FlipOverlay`：`favOnly()`/`triggerBurst()`，minis 随机散射参数）。

### 4.6 乱翻内写书评入口〔原有未动〕

**一句话描述**：右侧 💬 按钮直达本书书评编辑页，已写过显示「编辑书评」。

**后端接口**：纯前端路由（`requireLogin` → `/library/book/{id}/review/new`）。

**关键代码**：`app\flip\page.tsx`（`openReview()`）。

### 4.7 「读这本书」直达详情〔原有未动〕

**一句话描述**：右下角按钮一键跳书籍详情页，进度无缝接续。

**后端接口**：纯前端路由。**关键代码**：`app\flip\page.tsx`。

### 4.8 底部播放进度条（按住拖动定位）〔原有未动〕

**一句话描述**：平时 2.5px 细线，按住变粗 5px 可拖动定位，拖动中显示「当前/总时长」气泡。

**前端入口与交互流程**：底部 20px 命中区按下 → 变粗+气泡 → 拖动 → 松手 seek 并同步续播位置（暂停态拖动也同步）。

**后端接口**：纯前端 + seek 后立即落 `media_progress`。

**关键代码**：`app\flip\page.tsx`（`FlipProgress`：rAF 直写 DOM 宽度零 React 重渲；`targetRef` 按下瞬间锁定目标 video——拖动中滑屏不串台；seek 后重置真实播放基准）。

### 4.9 播放进度互通与真实观看量〔原有未动〕

**一句话描述**：乱翻看一半 → 详情页接着看（反之亦然）；「真实观看量」与「续播位置」分账，拖动跳跃不虚增。

**前端入口**：自动进行。

**后端接口**：Supabase 直连 `media_progress(user_id, book_id, position, played)` upsert，5 秒节流（首调即写+尾写合并）；数据库触发器 `merge_media_progress` 保证多设备合并 played 取大。

**关键代码**：`app\flip\page.tsx` —— `onSlotTime()`（Δt∈(0,1.5s) 才算真实播放累计）、`primeActive()`（**切条/onLoadedMetadata 双时序还原 playedSec 基线**，根治「新书继承旧书秒数、划过的书误入历史」的数据级 bug）、`writeMedia(force)`（卸载/切后台强制落账）、visibilitychange 回前台续播+落账。

**实现要点与已知限制**：续播仅当 0<position<0.99 时 seek（避开未播与完播）；倍速播放会使 Δt 累计略偏（乱翻无倍速钮，仅详情页有，影响有限）。

### 4.10 乱翻历史落账〔原有未动〕

**一句话描述**：每条真实看过的视频（played>0）按「书+音视频大类」记入阅读历史，进度 ≥90% 记为 100。

**后端接口**：`reading_history` upsert（onConflict `user_id,book_id,mode_category`，mode_category='av' 与文字稿分轨）。

**关键代码**：`app\flip\page.tsx`（`writeMedia()`）；`D:\ClaudeCode\AI_library\lib\store.ts`（`pushHistory()` 同书同类同进度去重，本地留 50 条）。

### 4.11 声音开关 / 单击暂停 / 前后台切换〔本轮修改·T1：竞态守卫（同 4.1）〕

**一句话描述**：右上声音钮开关不打断播放；单击暂停/再点继续；切后台自动落账、回前台自动续播（不打破用户主动暂停）。

**交互细节**：单击经 280ms 延时与双击判别（快滑时定时器自校验不误停下一条）；开声只管声音、不强行取消用户暂停；浏览器禁自动播放时静音兜底 + 「轻点开启声音」提示（4 秒自隐，每会话一次）。

**后端接口**：纯前端。**关键代码**：`app\flip\page.tsx`（`toggleSound()`/`playActive()`/visibilitychange 护栏）。

### 4.12 坏源兜底与出路〔本轮修改·T1：错误判定加 stillActive 守卫〕

**一句话描述**：视频源坏了不卡死——显示「这本书的视频暂时无法播放」+「重试」「看图文详情」两条出路；加载前由「音乐播放器式」封面垫底图撑画面。

**交互细节**：垫底构图=大图重度 blur 压暗氛围 + 居中 w-44 锐利封面（上轮按用户要求由全屏糊脸改小）；onError 且当前条才置错（旧槽错误不盖新条）。

**后端接口**：纯前端。**关键代码**：`app\flip\page.tsx`（vErr 状态机、错误 UI、封面垫底层）。

**已知限制**：重试只重新 load 当前源，源真坏会反复失败（出路是图文详情）。

---

## 五、我的 —— 个人中心与账号体系

### 5.1 个人中心首页与数据卡〔原有未动〕

**一句话描述**：头像档案区 + 四张数据卡（**阅读时长 / 已读 / 进行中 / 收藏**）+ 菜单（我的书评/我的笔记/设置/关于），卡片点击直达对应页面。

**前端入口与交互流程**：底部导航「我的」→ `/me`；未登录显示登录引导卡。数据卡点击联动：已读/进行中卡跳 `/me/history?status=…&mode=…`——mode 自动带「有记录的大类」，避免「卡上显示已读 1，点进去却因默认筛选显示空态」。

**后端接口**：纯前端统计（数据源已由 `loadUserData` 在库）：时长=`profiles.read_seconds` 格式化；已读=`reading_history` 任一模式 progress≥100 按书去重；进行中=有进度未读完按书去重（已读完的书不再计入）；收藏=`favorites` 行数。

**关键代码**：`D:\ClaudeCode\AI_library\app\me\page.tsx`。

**实现要点与已知限制**：游客期阅读时长不入账（仅登录后写库部分）；未登录数据卡显示「—」。

### 5.2 主题切换「拉绳台灯」〔原有未动〕

**一句话描述**：个人中心右上角可拖拽的拉绳台灯，下拉松手切换浅色/深色主题（设置页另有常规开关）。

**后端接口**：纯前端（`useUI.setTheme` → `documentElement.classList.toggle("dark")`，localStorage `ail-ui` 持久化；不跟随系统）。

**关键代码**：`app\me\page.tsx`（LampPull，framer-motion drag + dragSnapToOrigin）。

### 5.3 编辑资料（昵称/简介/头像上传）〔本轮修改·T1：Avatar 失败态随 src 复位（修「换头像不生效」）〕

**一句话描述**：改昵称（≤16 字）、一句话简介（≤30 字）；头像支持 8 个预设 + 相册/拍照上传真头像，云端同步换机可见。

**前端入口与交互流程**：`/me` 或设置页 → `/me/settings/profile` → 点头像弹选择层（8 预设 + 上传钮）→ 选图 canvas 压缩（最长边 ≤512px、JPEG 质量 0.85，透明 PNG 先铺白底防黑底）→ **点保存才真上传**（取消不留垃圾文件）→ toast 反馈。

**后端接口**：Supabase 直连 `profiles` update（nickname/bio/avatar_seed/avatar_url）；Storage `avatars` 桶——固定路径 `<uid>/avatar.jpg` 覆盖上传，公网 URL 加 `?v=时间戳` 破 CDN 缓存；桶策略：公开读，写/改/删仅限本人 `<uid>/` 目录，限 2MB 且仅图片 MIME。

**数据库表**：`profiles(nickname, bio, avatar_seed, avatar_url)`。

**关键代码**：`D:\ClaudeCode\AI_library\app\me\settings\profile\page.tsx`（`compressImage()`/`save()`）；`D:\ClaudeCode\AI_library\components\ui\Avatar.tsx`。

**实现要点与已知限制**：冷加载回填门禁（inited ref）防直刷时空表单保存洗掉云端；换回预设头像 = avatar_url 置 null（updateProfile「键存在即写」语义）；本轮修复 Avatar 组件一次 404 后失败态不复位、导致换头像视觉上「不生效」的 bug。

### 5.4 阅读历史页〔本轮修改：仅文案（T8 省略号清零）〕

**一句话描述**：读过/看过/听过的书全在，按「音视频/文字稿」筛选、按状态（已读/进行中）过滤，可单删。

**前端入口与交互流程**：`/me/history`（支持 `?mode=av|text&status=read|reading` 入口参数）→ 列表（封面/书名/进度条/最后阅读时间）→ 删除 X / 「继续」「重读」按钮按模式跳阅读器或详情页。

**后端接口**：Supabase 直连 `reading_history` select（loadUserData 批量）/ delete（按 `user_id+book_id+mode_category`，**只删同大类**，防删音视频时误删同书文字记录——前轮数据级修复）。

**数据库表**：`reading_history(user_id, book_id, mode_category, progress, last_at)`。

**关键代码**：`D:\ClaudeCode\AI_library\app\me\history\page.tsx`。

**已知限制**：删除无二次确认、无撤销。

### 5.5 我的笔记页〔本轮修改：仅文案〕

**一句话描述**：全部划线与想法按书分组（手风琴），支持搜索（笔记/摘录/书名）、就地编辑、删除，点条目跳回原文位置。

**前端入口与交互流程**：`/me/notes` → 搜索框实时过滤 → 点条目 → `/library/book/{id}/read?ch={chapterId}&mark={noteId}` 精确定位闪烁。

**后端接口**：Supabase 直连 `notes` update/delete。

**关键代码**：`D:\ClaudeCode\AI_library\app\me\notes\page.tsx`。

**已知限制**：搜索为前端 JS 过滤，无全文索引（数据量大时性能受限）。

### 5.6 我的书评页〔原有未动〕

**一句话描述**：全部书评列表（封面/星级/标题/正文截断/日期），可编辑（跳编辑页）可删除（二次确认弹层）。

**后端接口**：Supabase 直连 `reviews` delete（按 user_id+book_id）。

**关键代码**：`D:\ClaudeCode\AI_library\app\me\reviews\page.tsx`（删除确认弹层 + useLockBodyScroll）。

### 5.7 我的收藏页〔原有未动〕

**一句话描述**：收藏书目网格（最新/最早收藏排序），取消收藏带 4 秒「撤销」窗口。

**前端入口与交互流程**：`/me/favorites` → 卡片右上小心心取消 → toast「已取消收藏」+撤销动作钮（点击恢复）→ 卡片 0.18s 退场动效。

**后端接口**：Supabase 直连 `favorites`；书详情 `getBooksByIds()` 批量查。

**关键代码**：`D:\ClaudeCode\AI_library\app\me\favorites\page.tsx`（queryKey 固定 favKey 防每次 toggle 闪加载态）。

### 5.8 设置页（阅读偏好/主题/分组入口）〔本轮修改：仅文案〕

**一句话描述**：设置中枢——个人信息、默认字号四档、默认背景四色、浅色/深色主题、修改密码、注销账号、意见反馈、协议/隐私/关于、退出登录。

**后端接口**：阅读偏好与主题纯前端持久化（`useReader`/`useUI`）；其余见各专条。

**关键代码**：`D:\ClaudeCode\AI_library\app\me\settings\page.tsx`。

### 5.9 修改密码〔原有未动〕

**一句话描述**：先验原密码再改新密码，改完旧密码立即失效。

**前端入口与交互流程**：设置页 → 修改密码弹层（原密码/新密码 ≥6 位/确认新密码，两次不一致即时红字）→ 确认。

**后端接口**：Supabase Auth——先 `signInWithPassword`（原密码重验证，失败「原密码不正确」）→ `auth.updateUser({password})`；新旧相同拦截提示。

**关键代码**：`app\me\settings\page.tsx`（`submitPwd()`）。

**已知限制**：忘记密码的邮件重置流程无 UI 入口。

### 5.10 注销账号〔本轮修改·T1：补头像 Storage 整目录清理（隐私闭环）〕

**一句话描述**：二次确认后永久删号并清空云端全部个人数据（含头像文件），不可恢复。

**前端入口与交互流程**：设置页 → 注销账号 → 红色确认弹层（明示清除范围）→ 确认 → 成功后登出并回泡馆。

**后端接口**：`POST /api/account/delete`，请求头 `Authorization: Bearer <access_token>`（401 拦未登录）；服务端 service_role：①先列删 Storage `avatars/<uid>/` 全部文件（失败不阻断删号但记日志）→ ②`admin.auth.admin.deleteUser(uid)` → 个人数据表（profiles/favorites/notes/reviews/reading_history/text_progress/media_progress/chat_sessions/user_memory/flip_feed/review_likes）经外键 `on delete cascade` 级联清除；`feedback` 脱敏保留（user_id set null）。

**关键代码**：`D:\ClaudeCode\AI_library\app\api\account\delete\route.ts`。

**实现要点与已知限制**：service_role 密钥仅存服务端环境变量；无数据导出/恢复机制（注销即终局）。

### 5.11 意见反馈〔原有未动〕

**一句话描述**：设置页提交反馈（≤500 字）真实落库后台可查，只写不可读。

**后端接口**：Supabase 直连 `feedback` insert `{user_id, content}`；RLS：仅本人可 INSERT、无 SELECT 策略（任何前端读不到他人或自己的反馈）。

**数据库表**：`feedback(user_id nullable, content, created_at)`。

**关键代码**：`app\me\settings\page.tsx`（`submitFeedback()`，acting 防重复提交；会话失效明确提示）。

### 5.12 用户协议 / 隐私政策 / 关于〔本轮修改：仅文案〕

**一句话描述**：三份静态文档页（`?doc=about|terms|privacy`），隐私政策已按「云端存储」口径撰写，更新日期 2026-06-10。

**后端接口**：纯前端硬编码。**关键代码**：`D:\ClaudeCode\AI_library\app\me\legal\page.tsx`。

**已知限制**：内容更新需改代码（无 CMS）。

### 5.13 登录 / 注册（LoginSheet）〔本轮修改·T1：注册昵称改走 user_metadata + 触发器，双保险〕

**一句话描述**：底部弹层式邮箱+密码登录/注册，体验账号一键直登，错误信息全部中文化。

**前端入口与交互流程**：任意需登录操作触发（pending 操作挂起、登录成功自动续做）或「我的」页登录钮 → 弹层；登录↔注册一键切换；注册含昵称、确认密码、协议链接行；「试试体验账号，一键直接登录」自动填 demo@ailibrary.app/123456 并提交。

**后端接口**：Supabase Auth——`signInWithPassword` / `signUp({email,password,options.data.nickname}})`；`profiles` 行由数据库触发器 `handle_new_user` 读 `raw_user_meta_data` 自动创建。

**数据库表**：`auth.users`、`profiles`。

**关键代码**：`D:\ClaudeCode\AI_library\components\shell\LoginSheet.tsx`（`zhError()` 错误中文映射）；`D:\ClaudeCode\AI_library\lib\store.ts`（`useAuth.login/register`）。

**实现要点与已知限制**：本轮把注册昵称从「注册后客户端补写」改为随 signUp metadata 由触发器落库（兼容开启邮箱验证、注册时无会话的场景），有会话时再直写一次作双保险；不支持第三方登录。

### 5.14 登录态初始化与跨标签同步〔本轮修改·T1：SIGNED_IN 补 load、世代校验防串号〕

**一句话描述**：刷新不掉线、跨标签登录状态同步、换账号数据绝不串。

**前端入口**：应用启动自动执行。

**后端接口**：Supabase Auth `getSession()`（persistSession + autoRefreshToken）+ `onAuthStateChange` 订阅（SIGNED_IN/SIGNED_OUT/TOKEN_REFRESHED）。

**关键代码**：`D:\ClaudeCode\AI_library\components\providers.tsx`（AuthInit）；`D:\ClaudeCode\AI_library\lib\store.ts`（`initAuth()`）。

**实现要点与已知限制**：恢复会话后必须依次 `loadProfile()` + `useLibrary.load()` + `useChat.loadCloud()`，任何「user 已置位但数据未加载」的窗口都被 hydrated 门禁封死（防空基线覆写云端——本轮 P0 修复点之一）；跨标签 SIGNED_IN 经 firstSignIn 标志补齐 load；加载期间换号/退出 → 世代校验丢弃晚到数据；退出登录只清本机缓存，云端保留。

### 5.15 用户数据云同步层（loadUserData + 写穿透）〔本轮修改·T1：加载失败必抛错+800ms 重试一次，根治静默空基线〕

**一句话描述**：登录后一次性并行拉取 8 类个人数据进内存 store，所有操作本地乐观更新 + 异步写穿透；多设备合并「进度取大、已读章并集、时长增量」。

**前端入口**：登录/刷新自动执行。

**后端接口**：Supabase 直连并行 select：`favorites`/`notes`/`reviews`/`reading_history`/`text_progress`/`media_progress`/`profiles.read_seconds`/`review_likes`，再批量查 `books`/`chapters` 拼装展示字段；写侧 db.* 系列函数逐表 insert/upsert/delete；时长走增量 RPC `add_read_seconds`。

**数据库表**：上述 9 张 + 合并触发器 `merge_text_progress`/`merge_media_progress`（库端兜底陈旧快照）。

**关键代码**：`D:\ClaudeCode\AI_library\lib\supabase\userdata.ts`（`loadUserData()`/`db` 对象）；`D:\ClaudeCode\AI_library\lib\store.ts`（`useLibrary.load()`/`sync()`/`canSync()`）。

**实现要点与已知限制**：本轮修复——任何一路查询失败必须抛错（原会静默吞掉返回空数组→hydrated=true→空基线把云端洗成 0 的 P0 链路）；失败等 800ms 重试一次，仍失败保持 hydrated=false 暂停写穿透并 toast 告知；写失败 toast 不回滚（防抖动）。限制：全量加载无分页（馆藏与个人数据规模下可接受）。

### 5.16 RequireAuth 登录守卫〔本轮修改：仅文案〕

**一句话描述**：个人二级页通用守卫——未水合显示加载、未登录显示引导、已登录渲染内容。

**后端接口**：纯前端。**关键代码**：`D:\ClaudeCode\AI_library\components\shell\RequireAuth.tsx`。

---

## 六、基础设施

### 6.1 底部导航 BottomNav〔原有未动〕

**一句话描述**：智学/泡馆/乱翻/我的 四 Tab，仅四个根页挂载，选中态指示条+图标加粗，按压微缩反馈。

**后端接口**：纯前端。**关键代码**：`D:\ClaudeCode\AI_library\components\shell\BottomNav.tsx`（dark variant 供乱翻沉浸态；pb-safe 安全区）。

### 6.2 Header 与返回兜底（useGoBack）〔原有未动〕

**一句话描述**：二级页通用顶栏（返回箭头+标题+右操作区）；history 栈空（分享直链）时返回兜底跳泡馆而非无响应。

**后端接口**：纯前端。**关键代码**：`D:\ClaudeCode\AI_library\components\shell\Header.tsx`（`useGoBack()`；sticky + 毛玻璃）。

### 6.3 Toast 提示系统〔原有未动〕

**一句话描述**：全局轻提示（成功/错误/信息三型），同文案去重、最多同屏 3 条、可带「撤销」动作钮。

**后端接口**：纯前端。**关键代码**：`D:\ClaudeCode\AI_library\components\ui\Toaster.tsx`；`D:\ClaudeCode\AI_library\lib\store.ts`（`useUI.toast`，2.8s 自隐、带 action 延至 4s 留撤销窗口、底部安全区上浮）。

### 6.4 弹层背景滚动锁〔本轮修改·T1：由 overflow:hidden 升级为 position:fixed 方案，修 iOS/微信穿透〕

**一句话描述**：任何弹层打开时锁定背景页面滚动，关闭恢复原位置；多层弹层嵌套计数管理。

**后端接口**：纯前端。**关键代码**：`D:\ClaudeCode\AI_library\lib\useLockBodyScroll.ts`。

**实现要点**：iOS Safari/微信 WebView 对 body overflow:hidden 不生效（触摸滚动直接作用于文档），本轮改为 `position:fixed + top:-scrollY` 钉住页面、解锁 `scrollTo` 恢复；lockCount 计数防内层弹层关闭误解外层锁。

### 6.5 页面过渡动画〔原有未动〕

**一句话描述**：全局页面切换淡入+上移 8px（0.26s），统一节奏感。

**关键代码**：`D:\ClaudeCode\AI_library\components\shell\PageTransition.tsx`。

### 6.6 设计系统「东方典雅·古书新韵」〔本轮修改：新增 shimmer 动画 token〕

**一句话描述**：全套新中式视觉 token——月白/素白底、青瓷主色、黄铜辅色、胭脂警示色、衬线标题字、山水竹印云五种线性纹样。

**关键代码**：`D:\ClaudeCode\AI_library\tailwind.config.ts`（色板 moon/snow/ink/celadon/brass/rouge + dark 三色；圆角 8~24px 梯度；fade-up/scale-in/like-burst 等关键帧）；`D:\ClaudeCode\AI_library\app\globals.css`（本轮新增 `.shimmer-win` 水波纹动画）；`D:\ClaudeCode\AI_library\components\ui\Motif.tsx`（bamboo/mountain/branch/seal/cloud 纹样）。

### 6.7 深色模式全局适配〔原有未动〕

**一句话描述**：浅色/深色二选一（手动，不跟随系统），全站组件 dark: 类名适配，含骨架屏高光调淡。

**关键代码**：`useUI.setTheme` + Tailwind `darkMode: class`。

### 6.8 安全区与响应式视口〔原有未动〕

**一句话描述**：刘海屏/底部手势区全量留白（env(safe-area-inset-*)+viewport-fit=cover）；桌面端 ≥1024px 时容器钳 480px 居中模拟手机框。

**关键代码**：`D:\ClaudeCode\AI_library\app\layout.tsx`（含动态校正 viewport 脚本，兼容微信 WebView 宽度取值不准；`interactive-widget=resizes-content` 修键盘弹起盖输入框）。

### 6.9 PWA 配置〔原有未动〕

**一句话描述**：manifest.webmanifest（standalone、start_url=/library、主题色月白），图标暂为 icon.svg 占位。

**关键代码**：`D:\ClaudeCode\AI_library\public\manifest.webmanifest`。

**已知限制**：真实 192/512 PNG 图标在延后池（见附录建议第 2 条）。

### 6.10 加载/空态/错误态与错误边界〔原有未动〕

**一句话描述**：每页骨架屏占位、空状态插画、出错重试按钮，路由级 404 与全局错误边界兜底，不白屏不卡死。

**关键代码**：`D:\ClaudeCode\AI_library\components\ui\States.tsx`（EmptyState/ErrorState，onDark 暗底变体供乱翻）；`D:\ClaudeCode\AI_library\app\error.tsx` / `app\global-error.tsx` / `app\not-found.tsx`。

### 6.11 数据库安全与完整性体系（RLS/触发器/RPC）〔本轮修改·T1：授权面收紧 7 项实测 + T7 新增记忆表〕

**一句话描述**：16 张表全量 RLS 行级隔离——任何人（包括拿到网址者）只能读写自己的数据；计数列由触发器自动维护；合并逻辑下沉数据库。

**机制清单**：
- **RLS**：个人数据 11 表均 `user_id = auth.uid()`；`books/categories/chapters` 公开只读；`feedback` 仅本人 INSERT 无 SELECT；本轮 T1 对 anon/authenticated 的多余授权面做了收紧（SQL：`docs/后端_T1安全收紧SQL.md`，实测 7/7，证据 `docs/delivery/evidence/T1/`）。
- **触发器**：`handle_new_user`（建号自动建 profiles）、`updated_at` 自动戳、`fav_count`（favorites 增删回写）、`rating/review_count`（reviews 回写均分条数）、`reviews.likes`（review_likes 聚合）、`merge_text_progress`/`merge_media_progress`（多设备进度取大/已读章并集）。
- **RPC**：`add_read_seconds`（时长增量）、`increment_read_count`（阅读次数）、`get_hot_searches`（热词聚合 v2：参数钳制/通配符免疫/双人阈值）。
- **定时**：pg_cron——`readers` 每日 19:30 UTC（北京 03:30）重算；`search_logs` 90 天 TTL 清理。
- **密钥面**：MINIMAX_API_KEY / SUPABASE service_role / CRON_SECRET 全部仅存服务端，前端零密钥。

**关键文件**：`docs/后端_T1计数触发器SQL.md`、`docs/后端_T3T4_SQL.md`、`docs/后端_Review2_SQL.md`、`docs/后端_T1安全收紧SQL.md`、`docs/后端_T7记忆表SQL.md`（均已在库执行）；`scripts/run-sql.mjs`（直连自动执行基建）。

### 6.12 部署与运维〔原有未动〕

**一句话描述**：Vercel 项目 ai-library 托管，正式域名 https://www.goodcontent.cn（apex 307→www，国内直连可达），Cron 已注册启用，媒体走阿里云 OSS 直连。

**要点**：6 个生产环境变量（Vercel 控制台维护，写入须 bash printf 防 `\r` 污染）；重新部署 = `vercel deploy --prod`；OSS 媒体无 CORS 头但 `<video>/<img>` 标签不受限；`*.vercel.app` 域名国内被墙不可用。回归资产：`scripts/verify-*.mjs` 十余套自动化验证脚本（章节读毕/flip-feed/卡片/会话同步/M3/语音/搜索/记忆/限流/shimmer/安全收紧）。

---

## 附录 A · 数据库 16 表速查

| # | 表名 | 用途 | 关键字段 | RLS |
|---|------|------|---------|-----|
| 1 | `books` | 馆藏书目 | id, title, author, cover_url, cover_seed, category_id, has_video/has_audio/has_text, video_url, audio_url, summary, tags, ai_digest, shelved_at；计数列 fav_count/rating/review_count/read_count/readers（存不展示） | 公开读 |
| 2 | `categories` | 分类 | id, name, icon, sort_order | 公开读 |
| 3 | `chapters` | 章节 | id, book_id, no(0=前言), title, content, ai_summary, audio_start | 公开读 |
| 4 | `profiles` | 用户档案 | id, nickname, bio, avatar_seed, avatar_url, read_seconds | 本人 |
| 5 | `favorites` | 收藏（=点赞） | user_id, book_id, created_at | 本人 |
| 6 | `notes` | 划线笔记 | id, user_id, book_id, chapter_id, excerpt, note, color, start_offset, end_offset | 本人 |
| 7 | `reviews` | 书评 | id, user_id, book_id, rating, title, content, likes；UNIQUE(user_id,book_id) | 本人 |
| 8 | `reading_history` | 阅读历史 | user_id, book_id, mode_category(av/text), progress, last_at | 本人 |
| 9 | `text_progress` | 文字进度 | user_id, book_id, last_chapter_id, last_chapter_no, pct, read_chapter_ids[] | 本人 |
| 10 | `media_progress` | 音视频进度 | user_id, book_id, position(续播), played(真实覆盖) | 本人 |
| 11 | `review_likes` | 书评点赞 | user_id, review_id（数据闭环不展示） | 本人 |
| 12 | `chat_sessions` | 智学会话 | (user_id,id='main') 复合主键, title, messages jsonb, compressed_history, compressed_until | 本人 |
| 13 | `flip_feed` | 乱翻日更书单 | user_id, gen_date, book_ids[] | 本人读 |
| 14 | `search_logs` | 搜索日志 | term(≤50), user_id(可空), created_at；90 天 TTL | 写入 |
| 15 | `feedback` | 意见反馈 | user_id(可空·注销脱敏), content, created_at | 仅 INSERT |
| 16 | `user_memory`〔本轮新增·T7〕 | 小涤长期记忆 | user_id PK, identity/reading_pref/interests/chat_style/facts/recent_focus/follow_ups, processed_until | 本人 |

另：`chat_sessions_backup_t4` 为 T4 迁移备份表（非业务表）。Storage：仅 `avatars` 一桶（公开读、本人写 `<uid>/`、2MB、仅图片）。

## 附录 B · 服务端接口与 RPC 总表

**自建 HTTP 接口（共 3 个，密钥/重逻辑场景才上服务端，其余 Supabase 直连）**：

| 接口 | 方法 | 鉴权 | 用途 |
|---|---|---|---|
| `/api/chat` | POST | Bearer token（游客可匿名）+ 限流 | 智学 Agent 全链路（NDJSON 流） |
| `/api/cron/flip-feed` | GET | CRON_SECRET | 乱翻日更生成（?force=1 强制） |
| `/api/account/delete` | POST | Bearer token → service_role | 注销账号级联清数据 |

**Supabase RPC**：`add_read_seconds(p_delta)` / `increment_read_count(p_book_id)` / `get_hot_searches(p_limit, p_days)`。

**外部依赖**：MiniMax `POST /v1/text/chatcompletion_v2`（对话/摘要/记忆/排序，模型 MiniMax-M3）；MiniMax `POST /v1/coding_plan/search`（联网搜索）；阿里云 OSS（封面/音视频静态直连）。

## 附录 C · 后续改进建议（本轮为何未实施）

1. **阅读器行距三档**：UI 大师 Review 轮即列延后池。本轮 T2 以高频痛点优先；行距与既有「字号四档+背景四色+亮度」叠加会使设置面板复杂化，且需对 Markdown 全部元素（标题/列表/引用）的行高梯度做全面视觉回归，使用频率低、性价比不高，故延后。
2. **PWA 真实图标（192/512 PNG）**：图片素材按项目工作流必须经 codex image_gen 管线生成（禁网络图床），属内容生产环节而非代码任务；本轮任务书 T1~T10 不含出图工作流，icon.svg 占位不影响任何线上功能，故顺延至下一次素材批产。
3. **长列表虚拟化（F41）**：当前馆藏仅 7 本、各列表（历史/笔记/收藏）数据量极小，虚拟化收益为零反增复杂度与滚动定位风险（阅读器 mark 定位、历史筛选都依赖真实 DOM）。待 T6 内容线批量导入 100+ 本书后按实测性能再决策。
4. **读者评价（他人书评）公开展示**：项目主人明确口径「只存数据不展示」。数据链路（reviews/review_likes/触发器计数）已全部闭环；将来开放展示需新建只读视图或 count RPC + 昵称头像脱敏策略，属产品决策项而非技术欠账。
5. **弱网下一条视频预加载/清晰度切换**：乱翻已有 3 解码器 ±1 窗口预载；更激进的「提前预取下一条整段」在弱网下会与当前条争抢带宽反而更卡，正确做法需配合多码率源（OSS 转码出清晰度档）整体设计。当前书源只有单码率视频，先决条件不具备。
6. **智学客户端发送窗口截断**：服务端已有「最近 40 条+硬上限 64 条+压缩摘要」裁剪，**模型侧正确性与成本不受影响**；但客户端目前仍把整段历史 POST 上行，单一会话消息累积越多请求体越大（纯上行带宽浪费）。修复需客户端按 `compressed_until` 与服务端对齐同一套裁剪口径，跨端口径联动改动面大、收益仅省流量，本轮风险收益比不划算，列入下轮。
7. **Memory 多实例单调性**：`user_memory` 更新经 `waitUntil` 在 serverless 实例内异步执行，多实例并发同用户时 `processed_until` 没有数据库级 CAS/行锁，理论上存在「旧实例晚写覆盖新值」使记忆回退一版的窗口。触发条件苛刻（同一用户秒级连发且恰好实例交错）、后果轻微（个别维度回退、下轮对话即重新提炼），本轮未引入 DB 端乐观锁（`update ... where processed_until < ?`），留待下轮一并加固。

---

*本清单基于 commit `7e486cb` 全量源码逐文件核对生成（2026-06-11）。文档若与代码冲突，以代码为准。*
