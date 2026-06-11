# T6 证据：MiniMax「语音识别接口」核实结论（任务书与现实不符点）

- 核实时间：2026-06-11

## 核实过程（三层穷尽）

1. **官方文档索引**（https://platform.minimaxi.com/docs/llms.txt 两次检索）：
   音频类条目全部为 语音合成(T2A)/音色复刻/音色设计/语音资源包，**无任何 ASR/语音识别/转写条目**。
2. **候选端点实测**（真实 key，全部 404）：
   ```
   /v1/audio/transcriptions → HTTP 404
   /v1/speech_to_text       → HTTP 404
   /v1/asr                  → HTTP 404
   /v1/coding_plan/asr      → HTTP 404
   ```
3. **chat completions 多模态音频输入实测**：以 OpenAI input_audio 格式发送 214KB 中文 wav（Windows TTS 生成
   「我喜欢看历史类的书，请帮我推荐一本」），M3 回复 "no audio file has been provided"——音频内容被忽略，不支持。
4. **MCP 包源码核对**（minimax_mcp 0.0.4 server.py）：仅 web_search 与 understand_image 两个工具，无音频工具。

## 结论与决策

**MiniMax TokenPlan 不存在语音识别接口**（任务书第 T6 条的前提与现实不符，按任务书第五节「以实际为准」处理）。

- 备选方案：
  - A. 浏览器原生 Web Speech API（webkitSpeechRecognition）：零新增 key、零成本；iOS Safari 14.5+ 走 Siri 后端国内可用；微信内置浏览器/部分国产安卓浏览器不支持需降级
  - B. 第三方 ASR（阿里云 NLS/讯飞等）：需要用户开通服务并提供新密钥——违背「全程零人工介入」与「key 已在 env 中」前提，env 实测仅有 MiniMax/Supabase 键
  - C. 放弃语音输入：不符合任务书要求
- **最终选择：A**。长按说话/松开发送/上滑取消/音量动效/计时 等交互规范照任务书实现；识别文本回填输入框；
  不支持 SpeechRecognition 的环境优雅降级（明确提示 + 不显示坏入口）。真机触感项标「待人工真机复核」。

测试音频样本：.e2e/audio/sample.wav（214,944 字节，16kHz wav）
