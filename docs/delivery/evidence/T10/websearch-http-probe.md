# T10 证据：MiniMax 联网搜索底层 HTTP 直调实测（绕过 Python MCP）

- 实测时间：2026-06-11；脚本：`scripts/probe-websearch.mjs`（真实 key）

## 底层协议（扒自 minimax_mcp 0.0.4 包源码 server.py / client.py）

```
POST https://api.minimaxi.com/v1/coding_plan/search
Headers: Authorization: Bearer <TokenPlan订阅key>
         MM-API-Source: Minimax-MCP
         Content-Type: application/json
Body:    {"q": "<搜索词>"}
返回:    { organic: [{title, link, snippet, date}], related_searches: [{query}], base_resp: {status_code, status_msg} }
```

## 实测输出（原样）

```
HTTP 200 base_resp: {"status_code":0,"status_msg":"success"}
organic 共 10 条，前 3 条：
- [2026-06-08 03:02:50] 大模型周报(05.31 - 06.07) : AI Agent新进展
  https://www.iyiou.com/data/202606081132116
- [2026-06-10 19:01:21] AI模型排行榜2026 - 大模型评测排名、价格速度与能力对比灵简AI
  https://www.jingxialai.com/
- [2026-05-26 11:27:33] OpenAI GPT-5.6 模型曝下月发布:上下文窗口达 150 万 tokens
```

**结论：无需 Python MCP 子进程，Vercel serverless 可直接 fetch 该端点——TS 移植路线成立。**
（决策记录：放弃「移植 MCP stdio 客户端」，改为「移植底层 HTTP 调用」，因 Vercel 无 Python 运行时且 HTTP 等价。）
