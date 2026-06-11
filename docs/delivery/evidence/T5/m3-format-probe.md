# T5 证据：MiniMax-M3 模型 ID 与输出格式实测

- 实测时间：2026-06-11
- 实测脚本：`scripts/probe-models.mjs`、`scripts/probe-m3-format.mjs`（真实 key 调 api.minimaxi.com）

## ① 模型 ID 确认（probe-models.mjs 实测输出）

```
✅ MiniMax-M3 → 可用
✅ MiniMax-M2.5 → 可用
✅ MiniMax-M2 → 可用
❌ abab-m3 → HTTP 400 unknown model
✅ MiniMax-Text-01 → 可用
```

另据 docs/minimax-websearch/MiniMax联网搜索接入文档.md（GET /v1/models 实测）：
`MiniMax-M3、MiniMax-M2.7、MiniMax-M2.7-highspeed、MiniMax-M2.5、MiniMax-M2.5-highspeed、MiniMax-M2.1、MiniMax-M2.1-highspeed、MiniMax-M2`

**结论：最新模型确切 ID = `MiniMax-M3`。**

## ② 输出格式实测（probe-m3-format.mjs 原始输出）

### 非流式 message 结构

```
message 字段： [ 'content', 'role', 'name', 'audio_content' ]
  content: "<think>\nThe user is asking ...\n</think>\n读书可以拓宽视野、丰富知识、滋养心灵，..."
```

→ **思考段以 content 内联 `<think>…</think>` 承载，无独立 reasoning_content 字段。**

### 流式 delta 结构

```
delta: {"content":"<think>用户","role":"assistant"}
...
全部 delta 字段并集： [ 'content', 'role' ]
```

→ 流式同样只有 content 一路，<think> 混在 content 增量里（可能被 chunk 边界拆开）。

### 工具调用 message 结构

```
message 字段： [ 'content', 'role', 'tool_calls' ]
  content: "<think>用户询问北京今天的天气。我需要使用 get_weather 工具来查询。</think>\n\n"
  tool_calls: [{"id":"call_019eb...","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"北京\"}"}}]
```

→ 工具调用轮的思考也在 content 的 <think> 段里。

### 思考链回灌验证（interleaved thinking）

把 assistant 消息**原样**（content 含 <think> + tool_calls）回灌历史 + 追加 tool 结果，再次请求：

```
✅ 回灌成功，最终回答： "<think>工具返回了北京今天的天气信息...</think>\n\n北京今天的天气情况如下：..."
```

**结论：思考链回灌方式 = 工具循环内 assistant 历史消息的 content 完整保留 <think> 段（不剥离）。
面向用户的流式输出仍需剥 <think>；回灌与展示必须是两路。**
