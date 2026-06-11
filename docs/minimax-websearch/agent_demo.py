# -*- coding: utf-8 -*-
"""端到端演示：MiniMax 模型 (function calling) + Token Plan web_search。

流程: 用户问题 -> 模型决定调用 web_search -> 本地经 MCP 执行搜索
      -> 结果回填给模型 -> 模型生成带引用的最终回答。

用法:
    set MINIMAX_API_KEY=你的订阅Key
    python agent_demo.py "今天AI领域有什么新闻？"
"""
import json
import os
import sys
import urllib.request

from mcp_websearch import WebSearchMCP

API_HOST = os.environ.get("MINIMAX_API_HOST", "https://api.minimaxi.com")
API_KEY = os.environ.get("MINIMAX_API_KEY")
MODEL = os.environ.get("MINIMAX_MODEL", "MiniMax-M2.5-highspeed")

QUESTION = sys.argv[1] if len(sys.argv) > 1 else "2026年6月11日前后，AI大模型领域有什么值得关注的新动态？"

TOOLS = [{
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "联网搜索互联网上的实时公开信息。当问题涉及时效性内容、超出知识范围或需要事实核查时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索关键词，简洁明确"}
            },
            "required": ["query"],
        },
    },
}]

SYSTEM = (
    "你是联网AI助手。涉及时效性/未知信息时先调用 web_search 工具，"
    "回答时引用来源链接，格式: [标题](URL)。回答末尾列出参考资料。"
)


def chat(messages):
    req = urllib.request.Request(
        API_HOST + "/v1/chat/completions",
        data=json.dumps({
            "model": MODEL,
            "messages": messages,
            "tools": TOOLS,
        }, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + API_KEY,
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    if not API_KEY:
        print("请先设置 MINIMAX_API_KEY")
        sys.exit(1)

    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": QUESTION},
    ]
    print(f"== 问题: {QUESTION}\n== 模型: {MODEL}")

    with WebSearchMCP() as ws:
        for round_no in range(5):  # 最多 5 轮工具调用
            data = chat(messages)
            msg = data["choices"][0]["message"]
            tool_calls = msg.get("tool_calls")
            if not tool_calls:
                print("\n== 最终回答 ==")
                print(msg.get("content", ""))
                usage = data.get("usage", {})
                print(f"\n== tokens 消耗: {usage}")
                return
            # 模型请求调用工具
            messages.append(msg)
            for tc in tool_calls:
                args = json.loads(tc["function"]["arguments"])
                print(f"\n[第{round_no + 1}轮] 模型发起搜索: {args['query']}")
                results = ws.search(args["query"])
                organic = results.get("organic", [])[:5]
                print(f"  -> 返回 {len(organic)} 条结果")
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(organic, ensure_ascii=False),
                })
    print("超过最大工具调用轮数")


if __name__ == "__main__":
    main()
