# -*- coding: utf-8 -*-
"""MiniMax Token Plan MCP web_search 连通性测试。

不依赖第三方库：直接以 stdio JSON-RPC 与 MCP 服务器通信。
用法:
    set MINIMAX_API_KEY=你的订阅Key
    set MINIMAX_API_HOST=https://api.minimaxi.com   (国内站; 国际站用 https://api.minimax.io)
    python test_mcp_websearch.py "今天有什么AI新闻"
"""
import json
import os
import subprocess
import sys
import shutil
import threading

QUERY = sys.argv[1] if len(sys.argv) > 1 else "MiniMax M2 模型 最新发布"


def find_server_command():
    """优先 uvx，其次已 pip 安装的入口脚本。"""
    if shutil.which("uvx"):
        return ["uvx", "minimax-coding-plan-mcp", "-y"]
    exe = shutil.which("minimax-coding-plan-mcp")
    if exe:
        return [exe, "-y"]
    print("未找到 uvx 或 minimax-coding-plan-mcp，请先安装：pip install uv 或 pip install minimax-coding-plan-mcp")
    sys.exit(1)


def main():
    if not os.environ.get("MINIMAX_API_KEY"):
        print("请先设置 MINIMAX_API_KEY 环境变量（Token Plan 订阅 Key）")
        sys.exit(1)
    env = os.environ.copy()
    env.setdefault("MINIMAX_API_HOST", "https://api.minimaxi.com")

    proc = subprocess.Popen(
        find_server_command(),
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=env, text=True, encoding="utf-8",
    )
    # stderr 透传，便于看服务器报错
    threading.Thread(target=lambda: [print("[server]", l, end="", file=sys.stderr) for l in proc.stderr], daemon=True).start()

    msg_id = [0]

    def send(method, params=None, notify=False):
        m = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            m["params"] = params
        if not notify:
            msg_id[0] += 1
            m["id"] = msg_id[0]
        proc.stdin.write(json.dumps(m, ensure_ascii=False) + "\n")
        proc.stdin.flush()
        return msg_id[0] if not notify else None

    def recv(expect_id):
        while True:
            line = proc.stdout.readline()
            if not line:
                raise RuntimeError("MCP 服务器已退出")
            line = line.strip()
            if not line:
                continue
            m = json.loads(line)
            if m.get("id") == expect_id:
                return m

    # 1. initialize
    rid = send("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "websearch-test", "version": "0.1"},
    })
    init = recv(rid)
    print("== 服务器:", json.dumps(init["result"].get("serverInfo", {}), ensure_ascii=False))
    send("notifications/initialized", notify=True)

    # 2. tools/list
    rid = send("tools/list", {})
    tools = recv(rid)["result"]["tools"]
    print("== 可用工具:", [t["name"] for t in tools])

    # 3. tools/call web_search
    print(f"== 搜索: {QUERY}")
    rid = send("tools/call", {"name": "web_search", "arguments": {"query": QUERY}})
    result = recv(rid)
    if "error" in result:
        print("!! 调用失败:", json.dumps(result["error"], ensure_ascii=False))
        sys.exit(2)
    for item in result["result"].get("content", []):
        if item.get("type") == "text":
            print(item["text"][:3000])

    proc.terminate()
    print("\n== 测试完成：web_search 调用成功 ==")


if __name__ == "__main__":
    main()
