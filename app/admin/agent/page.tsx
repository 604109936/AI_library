"use client";
// Agent 调试管理后台（v1）：系统提示词（左改右预览）+ 工具描述 + 参数配置；保存即实时生效（本地）。
// v1 暂无门禁（按选择「先直接访问」）。桌面布局。
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Cfg {
  systemInstructions: string;
  toolDescriptions: Record<string, string>;
  model: string;
  temperature: number;
  mainMaxTokens: number;
  compressKeep: number;
  compressBatchMin: number;
  compressTemperature: number;
  compressPrompt: string;
  memoryMinNew: number;
  memoryTemperature: number;
  memoryPrompt: string;
}

const TOOL_LABELS: Record<string, string> = {
  recommend_books: "recommend_books · 推荐书目卡片",
  read_book_toc: "read_book_toc · 读取书本目录",
  read_chapter: "read_chapter · 读取章内容",
  cite_chapters: "cite_chapters · 引用章节卡片",
  web_search: "web_search · 联网搜索",
};

export default function AgentAdminPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [defaults, setDefaults] = useState<Cfg | null>(null);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<string | null>(null); // 完整提示词只读预览（null=未打开）
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewEmail, setPreviewEmail] = useState("604109936@qq.com"); // 按此邮箱用户口径预览（留空=游客）
  const [userSummary, setUserSummary] = useState<string | null>(null); // 该用户历史压缩值（当前摘要），只读
  const [userMemory, setUserMemory] = useState<string | null>(null); // 该用户历史记忆值（7 维度现值），只读
  const [loadingValues, setLoadingValues] = useState(false);

  useEffect(() => {
    fetch("/api/admin/agent")
      .then((r) => r.json())
      .then((j) => { setCfg(j.effective); setDefaults(j.defaults); })
      .catch(() => setStatus("加载失败"));
  }, []);

  async function save() {
    if (!cfg) return;
    setSaving(true);
    setStatus("");
    try {
      const r = await fetch("/api/admin/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) });
      const j = await r.json().catch(() => ({}));
      setStatus(r.ok ? "✅ 已保存，实时生效——下一条对话即用新配置" : "❌ " + (j.error ?? "保存失败"));
    } catch {
      setStatus("❌ 网络错误");
    } finally {
      setSaving(false);
    }
  }

  // 查看完整提示词：当前编辑的指令块 ＋ 运行时注入的动态数据段（游客口径，只读）
  async function openPreview() {
    if (!cfg) return;
    setLoadingPreview(true);
    try {
      const em = previewEmail.trim();
      const r = await fetch(`/api/admin/agent?preview=1${em ? `&email=${encodeURIComponent(em)}` : ""}`);
      const j = await r.json();
      const note = em && j.found === false ? `（⚠️ 未找到邮箱「${em}」对应的用户，以下为游客口径）\n\n` : "";
      setPreview(note + cfg.systemInstructions + (j.dataSection ?? "\n\n（动态数据段加载失败）"));
    } catch {
      setPreview(cfg.systemInstructions + "\n\n（动态数据段加载失败）");
    } finally {
      setLoadingPreview(false);
    }
  }

  // 查看「邮箱用户」的历史压缩值（当前摘要）+ 历史记忆值（7 维度现值），只读
  async function loadUserValues() {
    const em = previewEmail.trim();
    if (!em) { setUserSummary("（请先在 ① 区填用户邮箱）"); setUserMemory("（请先在 ① 区填用户邮箱）"); return; }
    setLoadingValues(true);
    try {
      const r = await fetch(`/api/admin/agent?preview=1&email=${encodeURIComponent(em)}`);
      const j = await r.json();
      if (j.found === false) { setUserSummary(`（未找到邮箱「${em}」的用户）`); setUserMemory(`（未找到邮箱「${em}」的用户）`); return; }
      setUserSummary((j.compressedHistory ?? "").trim() || "（该用户暂无对话摘要——聊得还不够长，没到压缩门槛）");
      setUserMemory((j.memory ?? "").trim() || "（该用户暂无长期记忆——还没攒够更新门槛）");
    } catch {
      setUserSummary("（加载失败）"); setUserMemory("（加载失败）");
    } finally {
      setLoadingValues(false);
    }
  }

  if (!cfg || !defaults) return <div className="p-10 text-sm text-ink-500 dark:text-dark-text/60">{status || "加载中…"}</div>;

  const SaveBtn = (
    <button onClick={save} disabled={saving} className="rounded-xl bg-celadon px-6 py-2.5 text-sm font-medium text-snow shadow-celadon transition active:scale-95 disabled:opacity-50">
      {saving ? "保存中…" : "保存并生效"}
    </button>
  );

  return (
    <main className="mx-auto max-w-[1120px] px-6 py-8">
      <header className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-xl font-bold text-ink dark:text-dark-text">Agent 调试管理 · 小涤</h1>
          <p className="mt-1 text-xs text-ink-400 dark:text-dark-text/50">改完点「保存并生效」即实时生效（本地 dev）。清空某项 = 恢复出厂默认。v1 暂无门禁。</p>
        </div>
        {SaveBtn}
      </header>

      {status && <div className="mb-5 rounded-xl border border-line bg-snow px-4 py-2.5 text-sm text-ink-700 shadow-sm dark:border-white/10 dark:bg-dark-card dark:text-dark-text">{status}</div>}

      {/* 系统提示词：左改右预览 */}
      <section className="mb-9">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink dark:text-dark-text">① 系统提示词（指令块）</h2>
          <div className="flex items-center gap-3">
            <input
              value={previewEmail}
              onChange={(e) => setPreviewEmail(e.target.value)}
              placeholder="用户邮箱（留空=游客）"
              className="w-52 rounded-lg border border-line bg-snow px-2.5 py-1 text-xs text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text"
            />
            <button onClick={openPreview} disabled={loadingPreview} className="shrink-0 text-xs font-medium text-celadon-700 hover:underline disabled:opacity-50 dark:text-celadon-300">{loadingPreview ? "加载中…" : "查看完整提示词（只读）"}</button>
            <button onClick={() => setCfg({ ...cfg, systemInstructions: defaults.systemInstructions })} className="shrink-0 text-xs text-ink-400 hover:underline dark:text-dark-text/50">恢复默认</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <textarea
            value={cfg.systemInstructions}
            onChange={(e) => setCfg({ ...cfg, systemInstructions: e.target.value })}
            spellCheck={false}
            className="h-[62vh] resize-none rounded-xl border border-line bg-snow p-3.5 font-mono text-xs leading-6 text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text"
          />
          <div className="prose-cn h-[62vh] overflow-auto rounded-xl border border-line bg-snow p-4 dark:border-white/10 dark:bg-dark-card">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{cfg.systemInstructions}</ReactMarkdown>
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-300 dark:text-dark-text/40">运行时会在这段指令后自动拼接〔图书馆书单〕〔这位读者〕〔长期记忆〕〔对话摘要〕等动态数据（不在此编辑）。</p>
      </section>

      {/* 工具描述 */}
      <section className="mb-9">
        <h2 className="mb-2 text-sm font-semibold text-ink dark:text-dark-text">② 工具描述（模型看到的工具说明）</h2>
        <div className="space-y-3">
          {Object.keys(defaults.toolDescriptions).map((name) => (
            <div key={name}>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-ink-700 dark:text-dark-text/80">{TOOL_LABELS[name] ?? name}</label>
                <button onClick={() => setCfg({ ...cfg, toolDescriptions: { ...cfg.toolDescriptions, [name]: defaults.toolDescriptions[name] } })} className="text-[11px] text-celadon-700 hover:underline dark:text-celadon-300">恢复默认</button>
              </div>
              <textarea
                value={cfg.toolDescriptions[name] ?? ""}
                onChange={(e) => setCfg({ ...cfg, toolDescriptions: { ...cfg.toolDescriptions, [name]: e.target.value } })}
                spellCheck={false}
                className="h-24 w-full resize-none rounded-xl border border-line bg-snow p-3 text-xs leading-6 text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text"
              />
            </div>
          ))}
        </div>
      </section>

      {/* 参数配置 */}
      <section className="mb-9">
        <h2 className="mb-2 text-sm font-semibold text-ink dark:text-dark-text">③ 参数配置</h2>
        <div className="flex flex-wrap gap-6">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-700 dark:text-dark-text/80">模型 model</span>
            <input value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} className="w-60 rounded-xl border border-line bg-snow px-3 py-2 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-700 dark:text-dark-text/80">温度 temperature（0~2，主对话轮）</span>
            <input type="number" step="0.1" min={0} max={2} value={cfg.temperature} onChange={(e) => setCfg({ ...cfg, temperature: Number(e.target.value) })} className="w-32 rounded-xl border border-line bg-snow px-3 py-2 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-700 dark:text-dark-text/80">最大生成 maxTokens（主对话轮·含思考）</span>
            <input type="number" step="512" min={512} max={40000} value={cfg.mainMaxTokens} onChange={(e) => setCfg({ ...cfg, mainMaxTokens: Number(e.target.value) })} className="w-32 rounded-xl border border-line bg-snow px-3 py-2 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text" />
          </label>
        </div>
      </section>

      {/* ④ 对话摘要（长会话压缩） */}
      <section className="mb-9">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink dark:text-dark-text">④ 对话摘要（长会话压缩 · 后台自动跑）</h2>
          <div className="flex items-center gap-4">
            <button onClick={loadUserValues} disabled={loadingValues} className="text-xs font-medium text-celadon-700 hover:underline disabled:opacity-50 dark:text-celadon-300">{loadingValues ? "加载中…" : "查看该用户当前摘要/记忆值（用①邮箱）"}</button>
            <button onClick={() => setCfg({ ...cfg, compressKeep: defaults.compressKeep, compressBatchMin: defaults.compressBatchMin, compressTemperature: defaults.compressTemperature, compressPrompt: defaults.compressPrompt })} className="text-xs text-ink-400 hover:underline dark:text-dark-text/50">恢复默认</button>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-6">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-700 dark:text-dark-text/80">保留最近多少条不压</span>
            <input type="number" min={2} value={cfg.compressKeep} onChange={(e) => setCfg({ ...cfg, compressKeep: Number(e.target.value) })} className="w-32 rounded-xl border border-line bg-snow px-3 py-2 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-700 dark:text-dark-text/80">攒够多少条才压一次</span>
            <input type="number" min={1} value={cfg.compressBatchMin} onChange={(e) => setCfg({ ...cfg, compressBatchMin: Number(e.target.value) })} className="w-32 rounded-xl border border-line bg-snow px-3 py-2 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-700 dark:text-dark-text/80">温度（低=忠实）</span>
            <input type="number" step="0.1" min={0} max={2} value={cfg.compressTemperature} onChange={(e) => setCfg({ ...cfg, compressTemperature: Number(e.target.value) })} className="w-28 rounded-xl border border-line bg-snow px-3 py-2 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text" />
          </label>
        </div>
        <label className="mb-1 block text-xs font-medium text-ink-700 dark:text-dark-text/80">压缩器指令</label>
        <textarea value={cfg.compressPrompt} onChange={(e) => setCfg({ ...cfg, compressPrompt: e.target.value })} spellCheck={false} className="h-28 w-full resize-none rounded-xl border border-line bg-snow p-3 text-xs leading-6 text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text" />
        {userSummary !== null && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-ink-700 dark:text-dark-text/80">该用户当前对话摘要（历史压缩值 · 运行时注入压缩器的「已有摘要」· 只读）</p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-moon/60 p-3 font-mono text-[11px] leading-5 text-ink-700 dark:border-white/10 dark:bg-white/5 dark:text-dark-text/80">{userSummary}</pre>
          </div>
        )}
      </section>

      {/* ⑤ 长期记忆（读者画像） */}
      <section className="mb-9">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink dark:text-dark-text">⑤ 长期记忆（读者画像 · 后台自动跑）</h2>
          <button onClick={() => setCfg({ ...cfg, memoryMinNew: defaults.memoryMinNew, memoryTemperature: defaults.memoryTemperature, memoryPrompt: defaults.memoryPrompt })} className="text-xs text-ink-400 hover:underline dark:text-dark-text/50">恢复默认</button>
        </div>
        <div className="mb-3 flex flex-wrap gap-6">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-700 dark:text-dark-text/80">攒够多少条新消息才更新</span>
            <input type="number" min={1} value={cfg.memoryMinNew} onChange={(e) => setCfg({ ...cfg, memoryMinNew: Number(e.target.value) })} className="w-32 rounded-xl border border-line bg-snow px-3 py-2 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-700 dark:text-dark-text/80">温度（低=忠实）</span>
            <input type="number" step="0.1" min={0} max={2} value={cfg.memoryTemperature} onChange={(e) => setCfg({ ...cfg, memoryTemperature: Number(e.target.value) })} className="w-28 rounded-xl border border-line bg-snow px-3 py-2 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text" />
          </label>
        </div>
        <label className="mb-1 block text-xs font-medium text-ink-700 dark:text-dark-text/80">记忆管理器指令（7 维度提炼规则）</label>
        <textarea value={cfg.memoryPrompt} onChange={(e) => setCfg({ ...cfg, memoryPrompt: e.target.value })} spellCheck={false} className="h-28 w-full resize-none rounded-xl border border-line bg-snow p-3 text-xs leading-6 text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text" />
        {userMemory !== null && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-ink-700 dark:text-dark-text/80">该用户当前长期记忆（历史记忆值 · 运行时注入记忆器的「记忆现值」· 只读）</p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-moon/60 p-3 font-mono text-[11px] leading-5 text-ink-700 dark:border-white/10 dark:bg-white/5 dark:text-dark-text/80">{userMemory}</pre>
          </div>
        )}
      </section>

      <div className="flex justify-end">{SaveBtn}</div>

      {/* 完整提示词只读预览：编辑的指令块 ＋ 运行时动态变量（游客口径） */}
      {preview !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-6 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <div className="flex h-[86vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl bg-snow shadow-2xl dark:bg-dark-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3 dark:border-white/10">
              <div>
                <h3 className="text-sm font-semibold text-ink dark:text-dark-text">完整提示词（模型实际收到的 · 只读）</h3>
                <p className="mt-0.5 text-[11px] text-ink-300 dark:text-dark-text/40">＝ 你编辑的指令块 ＋ 运行时注入的动态变量（图书馆书单 / 这位读者 / 长期记忆 / 对话摘要，游客口径）</p>
              </div>
              <button onClick={() => setPreview(null)} className="shrink-0 rounded-lg px-3 py-1 text-sm text-ink-500 hover:bg-moon dark:text-dark-text/60 dark:hover:bg-white/5">关闭</button>
            </div>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-xs leading-6 text-ink dark:text-dark-text">{preview}</pre>
          </div>
        </div>
      )}
    </main>
  );
}
