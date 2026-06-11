# -*- coding: utf-8 -*-
"""MiniMax Token Plan MCP web_search 的轻量客户端封装（纯标准库）。

用法:
    from mcp_websearch import WebSearchMCP
    with WebSearchMCP() as ws:
        results = ws.search("查询词")   # 返回 dict: {"organic": [...]}
"""
import json
import os
import shutil
import subprocess
import sys
import threading


class WebSearchMCP:
    def __init__(self, api_key=None, api_host=None):
        self.api_key = api_key or os.environ.get("MINIMAX_API_KEY")
        self.api_host = api_host or os.environ.get("MINIMAX_API_HOST", "https://api.minimaxi.com")
        if not self.api_key:
            raise RuntimeError("缺少 MINIMAX_API_KEY（Token Plan 订阅 Key）")
        self._proc = None
        self._id = 0

    def _server_command(self):
        if shutil.which("uvx"):
            return ["uvx", "minimax-coding-plan-mcp", "-y"]
        exe = shutil.which("minimax-coding-plan-mcp")
        if exe:
            return [exe, "-y"]
        raise RuntimeError("请先安装: pip install minimax-coding-plan-mcp (或 uv)")

    def __enter__(self):
        env = os.environ.copy()
        env["MINIMAX_API_KEY"] = self.api_key
        env["MINIMAX_API_HOST"] = self.api_host
        self._proc = subprocess.Popen(
            self._server_command(),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=env, text=True, encoding="utf-8",
        )
        threading.Thread(
            target=lambda: [None for _ in self._proc.stderr], daemon=True
        ).start()
        self._rpc("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "agent-websearch", "version": "0.1"},
        })
        self._notify("notifications/initialized")
        return self

    def __exit__(self, *exc):
        if self._proc:
            self._proc.terminate()

    def _send(self, payload):
        self._proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        self._proc.stdin.flush()

    def _notify(self, method):
        self._send({"jsonrpc": "2.0", "method": method})

    def _rpc(self, method, params):
        self._id += 1
        self._send({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params})
        while True:
            line = self._proc.stdout.readline()
            if not line:
                raise RuntimeError("MCP 服务器已退出")
            line = line.strip()
            if not line:
                continue
            msg = json.loads(line)
            if msg.get("id") == self._id:
                if "error" in msg:
                    raise RuntimeError(f"MCP 错误: {msg['error']}")
                return msg["result"]

    def search(self, query):
        result = self._rpc("tools/call", {"name": "web_search", "arguments": {"query": query}})
        for item in result.get("content", []):
            if item.get("type") == "text":
                try:
                    return json.loads(item["text"])
                except json.JSONDecodeError:
                    return {"raw": item["text"]}
        return {"raw": ""}
