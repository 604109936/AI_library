# MiniMax Agent 联网搜索接入文档

> 适用场景：使用 MiniMax Token Plan 订阅（国内站 platform.minimaxi.com）的开发者，为自己的 Agent / 应用接入联网搜索能力。
> 本文档所有步骤已于 2026-06-11 在 Windows 11 + Python 3.10 环境实测跑通。

---

## 一、方案结论（为什么选这条路）

| 方案 | 搜索费用 | 限制 | 结论 |
|------|---------|------|------|
| **MiniMax Token Plan MCP web_search**（本文方案） | **包含在订阅内**，按目录价扣套餐共享额度，不额外付现金 | 需要 Token Plan 订阅 Key | ✅ 推荐，零新增成本 |
| 火山方舟 Web Search（联网内容插件） | 每月免费 2 万次，超出 4 元/千次 | **只能挂豆包系模型**（方舟 Responses API 服务端工具），MiniMax 模型用不了 | ❌ 不适用本场景 |
| LangSearch (langsearch.com) | 完全免费 | 第三方服务，质量自验 | 备选 |
| Tavily (tavily.com) | 每月 1000 次免费 | 国际服务，连通性自测 | 备选 |

MiniMax 官方通过 **Token Plan MCP** 提供两个专属工具：`web_search`（联网搜索）和 `understand_image`（图片理解）。API 本身（ChatCompletion v2 / Responses）的 `tools` 只支持 `function` 类型，**没有服务端内置搜索**，所以搜索要靠这个 MCP 服务器在本地执行。

---

## 二、前置条件

1. **Token Plan 订阅 Key**
   登录国内站 [订阅管理 > Token Plan](https://platform.minimaxi.com/user-center/payment/token-plan)，复制"订阅 Key"（`sk-cp-` 开头）。
   ⚠️ 订阅 Key 与普通按量计费 API Key **相互独立、不能混用**。
2. **Python 3.10+**（或 uv/uvx，二选一）
3. 安装 MCP 服务器包（实测命令）：

```powershell
pip install minimax-coding-plan-mcp
# 国内网络慢可加镜像: pip install -i https://pypi.tuna.tsinghua.edu.cn/simple minimax-coding-plan-mcp
```

4. 设置环境变量（持久化）：

```powershell
setx MINIMAX_API_KEY "sk-cp-你的订阅Key"
setx MINIMAX_API_HOST "https://api.minimaxi.com"   # 国内站；国际站用 https://api.minimax.io
```

> 实测踩坑：如果 Windows 系统残留代理配置，pip / API 调用可能报
> `ValueError: check_hostname requires server_hostname`。
> 解决：临时设置 `$env:NO_PROXY="*"` 绕过系统代理（api.minimaxi.com 是国内域名，无需代理）。

---

## 三、接入方式 A：现成 Agent 工具（Claude Code / Cursor 等）

一条命令挂载（以 Claude Code 为例）：

```bash
claude mcp add -s user MiniMax --env MINIMAX_API_KEY=你的订阅Key --env MINIMAX_API_HOST=https://api.minimaxi.com -- uvx minimax-coding-plan-mcp -y
```

或手动编辑配置（`~/.claude.json` / Cursor 的 `mcp.json` 通用结构）：

```json
{
  "mcpServers": {
    "MiniMax": {
      "command": "uvx",
      "args": ["minimax-coding-plan-mcp", "-y"],
      "env": {
        "MINIMAX_API_KEY": "sk-cp-你的订阅Key",
        "MINIMAX_API_HOST": "https://api.minimaxi.com"
      }
    }
  }
}
```

> 没装 uv 的话，把 `command` 换成 pip 安装后的入口 `minimax-coding-plan-mcp`（去掉 `uvx` 一层）。
> 验证：进入工具后输入 `/mcp`，能看到 `web_search`、`understand_image` 即成功。

---

## 四、接入方式 B：自研 Agent 代码接入（本文重点）

### 4.1 架构

```
用户问题 ──> MiniMax 模型 (function calling)
                │  返回 tool_calls: web_search(query)
                ▼
        本地 MCP 客户端 ──stdio──> minimax-coding-plan-mcp 服务器 ──> MiniMax 搜索服务
                │  返回 organic 结果列表
                ▼
        作为 role=tool 消息回填 ──> 模型生成带引用的最终回答
```

### 4.2 web_search 工具说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| query | string | ✓ | 搜索关键词 |

返回 JSON（实测结构）：

```json
{
  "organic": [
    {
      "title": "结果标题",
      "link": "https://...",
      "snippet": "摘要文本",
      "date": "2026-06-10 19:41:53"
    }
  ]
}
```

### 4.3 代码文件

本目录下两个文件即完整实现（纯标准库，无第三方依赖）：

- **`mcp_websearch.py`** —— MCP 客户端封装。以子进程方式拉起 MCP 服务器，走 stdio JSON-RPC（initialize → tools/call）。对外只暴露一个方法：

```python
from mcp_websearch import WebSearchMCP

with WebSearchMCP() as ws:
    results = ws.search("2026年6月 AI大模型 最新进展")
    # results["organic"] -> [{title, link, snippet, date}, ...]
```

- **`agent_demo.py`** —— 端到端 Agent 闭环。把 `web_search` 注册为模型的 function 工具，模型决定何时搜索：

```python
TOOLS = [{
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "联网搜索互联网上的实时公开信息。当问题涉及时效性内容、超出知识范围或需要事实核查时调用。",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "搜索关键词"}},
            "required": ["query"],
        },
    },
}]
```

模型 API 走 OpenAI 兼容端点（订阅 Key 直接可用，已实测）：

- 端点：`POST https://api.minimaxi.com/v1/chat/completions`
- 认证：`Authorization: Bearer sk-cp-...`
- 可用模型（实测 `GET /v1/models` 返回）：`MiniMax-M3`、`MiniMax-M2.7`、`MiniMax-M2.7-highspeed`、`MiniMax-M2.5`、`MiniMax-M2.5-highspeed`、`MiniMax-M2.1`、`MiniMax-M2.1-highspeed`、`MiniMax-M2`

工具调用循环的核心逻辑（完整代码见 `agent_demo.py`）：

```python
for _ in range(5):                        # 限制最大工具轮数，防失控
    data = chat(messages)                 # 调 /v1/chat/completions, 带 tools
    msg = data["choices"][0]["message"]
    if not msg.get("tool_calls"):
        print(msg["content"])             # 最终回答
        break
    messages.append(msg)                  # 先回填 assistant 的 tool_calls 消息
    for tc in msg["tool_calls"]:
        query = json.loads(tc["function"]["arguments"])["query"]
        organic = ws.search(query).get("organic", [])[:5]   # 截前5条控 token
        messages.append({
            "role": "tool",
            "tool_call_id": tc["id"],
            "content": json.dumps(organic, ensure_ascii=False),
        })
```

### 4.4 运行

```powershell
cd C:\Users\wjt\minimax-websearch
$env:MINIMAX_API_KEY = "sk-cp-你的订阅Key"
$env:NO_PROXY = "*"          # 如有系统代理残留

python test_mcp_websearch.py "测试搜索词"     # 单测 MCP 搜索
python agent_demo.py "今天AI领域有什么新闻？"  # 端到端 Agent
```

### 4.5 实测记录（2026-06-11）

- `tools/list` 返回：`['web_search', 'understand_image']` ✅
- 搜索 "2026年6月 AI大模型 最新进展"：返回 7+ 条实时结果，最新一条日期为 2026-06-10（前一天）✅
- 端到端问答（MiniMax-M2.5-highspeed）：模型自主发起 1 轮搜索后生成回答，
  消耗 `total_tokens: 1439`（prompt 1206 / completion 233，其中 reasoning 163）✅

---

## 五、计费与额度

- **搜索调用扣 Token Plan 订阅套餐的共享额度**（与模型 token 同一个池，按目录价折算），不会另外扣现金。官方原文："对于已有按量计费价格的 API 端点，用量会按对应按量计费价格扣减套餐内 Token Plan 额度。"
- 额度优先级：套餐内额度 → 已购积分（Credits）。
- 用量查询：[订阅付费 > 套餐用量](https://platform.minimaxi.com/console/usage)。
- 控制成本技巧：
  - 搜索结果截取前 N 条再回填（demo 中取 5 条），减少 prompt token；
  - 限制工具调用最大轮数（demo 中 5 轮）；
  - 日常用 `*-highspeed` 模型，复杂任务再换 M3。

---

## 六、注意事项 / 故障排查

| 现象 | 原因与处理 |
|------|-----------|
| `check_hostname requires server_hostname` | Windows 系统代理残留。设 `NO_PROXY=*` 或关闭系统代理 |
| 401 / invalid api key | 用了按量计费 Key。MCP 和本方案必须用 **订阅 Key（sk-cp- 开头）** |
| `spawn uvx ENOENT` | 未装 uv。改用 `pip install minimax-coding-plan-mcp` 后直接以 `minimax-coding-plan-mcp` 为 command |
| 回答里出现 `<think>...</think>` | M 系列模型的思维链。生产环境正则剥离：`re.sub(r'<think>.*?</think>', '', text, flags=re.S)` |
| 模型不触发搜索 | 加强 system prompt 中的触发条件描述（时效性/知识盲区/信息不足三类场景） |
| MCP 子进程常驻开销 | `WebSearchMCP` 进程可复用（demo 中整个会话只起一次），高并发服务建议做成连接池或独立 sidecar |

---

## 七、备选方案速查

1. **LangSearch**（完全免费，国内直连）：注册 https://langsearch.com 拿 Key，
   `POST https://api.langsearch.com/v1/web-search`，Header `Authorization: Bearer sk-xxx`，
   Body `{"query": "...", "count": 5, "summary": true}`。把它替换进 4.3 节的 function 实现即可。
2. **火山方舟 Web Search**：若未来切换豆包模型，方舟 Responses API 声明
   `tools=[{"type":"web_search","max_keyword":2,"limit":10}]` 即用，每月 2 万次免费，
   文档：volcengine.com/docs/82379/1756990（功能）、/1338550（计费）。

---

## 附：官方文档索引

- Token Plan MCP 指南：https://platform.minimaxi.com/docs/guides/token-plan-mcp-guide
- Token Plan 定价：https://platform.minimaxi.com/docs/guides/pricing-token-plan
- Token Plan FAQ：https://platform.minimaxi.com/docs/token-plan/faq
- 文档全索引（适合喂给 LLM）：https://platform.minimaxi.com/docs/llms.txt

> 小技巧：官方文档站为 Mintlify 构建，任意文档页 URL 加 `.md` 后缀即可获得纯 Markdown 原文（本调研即用此法核实）。
