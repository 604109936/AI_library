"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/shell/Header";
import { Motif } from "@/components/ui/Motif";

type Doc = "about" | "terms" | "privacy";

const DOCS: Record<Doc, { title: string; sections: { h?: string; p: string }[] }> = {
  about: {
    title: "关于",
    sections: [
      { p: "AI 图书馆是一座「会回答问题的图书馆」。我们把智能问答、沉浸阅读与发现式浏览融为一体，让你在书中遇见更好的自己。" },
      { h: "智学 · 你的 AI 读书伙伴", p: "通览馆藏，为你荐书、答疑、解读原文，并附上可直达原文的引用与推荐书目。" },
      { h: "泡馆 · 视频 / 听书 / 原文", p: "同一本书支持视频解读、整本朗读与全文精读三种方式，划线即可生成高亮与笔记。" },
      { h: "乱翻 · 竖滑发现", p: "像刷短视频一样竖滑发现好书，看到喜欢的随手收藏、一键开读。" },
    ],
  },
  terms: {
    title: "用户协议",
    sections: [
      { h: "一、服务说明", p: "欢迎使用 AI 图书馆。在使用本服务前，请你仔细阅读并同意本协议。你使用本服务即视为已接受本协议的全部条款。" },
      { h: "二、账号与使用", p: "你应妥善保管账号信息，并对账号下的全部行为负责。你承诺不利用本服务从事任何违反法律法规或侵害他人合法权益的行为。" },
      { h: "三、内容与版权", p: "本服务内的文字、音视频及其它内容受相关法律保护。除法律允许或获得授权外，你不得复制、传播或用于商业用途。" },
      { h: "四、AI 生成内容", p: "智学问答由人工智能生成，可能存在不准确之处，仅供阅读参考，不构成专业建议。请你结合原文与自身判断使用。" },
      { h: "五、协议变更", p: "我们可能不时更新本协议。协议更新后，你继续使用本服务即视为同意更新后的内容。" },
    ],
  },
  privacy: {
    title: "隐私政策",
    sections: [
      { h: "一、我们收集的信息", p: "为提供阅读同步等功能，我们可能收集你的账号信息、阅读进度、收藏、笔记与书评等数据。" },
      { h: "二、信息的使用", p: "我们仅在为你提供与改进服务所必需的范围内使用上述信息，不会用于与本服务无关的用途。" },
      { h: "三、信息的存储与保护", p: "我们采取合理的技术与管理措施保护你的信息安全。当前演示版本的数据仅保存在你的本地设备中。" },
      { h: "四、你的权利", p: "你有权查看、更正或删除你的个人信息，也可随时退出登录以清空本地保存的收藏与笔记。" },
      { h: "五、联系我们", p: "如对本隐私政策有任何疑问，可通过设置页的「意见反馈」与我们联系。" },
    ],
  },
};

function LegalInner() {
  const sp = useSearchParams();
  const raw = sp.get("doc") ?? "about";
  const doc: Doc = raw === "terms" || raw === "privacy" ? raw : "about";
  const data = DOCS[doc];

  return (
    <main className="relative min-h-[100dvh] pb-16">
      <Header title={data.title} />
      <div className="px-5 pt-2">
        {doc === "about" && (
          <div className="mb-6 flex flex-col items-center pt-4 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-celadon text-snow shadow-celadon">
              <span className="font-serif text-xl">馆</span>
            </span>
            <p className="mt-3 font-serif text-xl text-ink dark:text-dark-text">AI 图书馆</p>
            <p className="mt-1 text-xs text-ink-300">版本 v1.0.0</p>
          </div>
        )}
        {data.sections.map((s, i) => (
          <section key={i} className="mb-5">
            {s.h && (
              <h2 className="mb-1.5 flex items-center font-serif text-base tracking-wide text-ink dark:text-dark-text">
                <span className="mr-2 h-4 w-[3px] rounded-full bg-celadon" /> {s.h}
              </h2>
            )}
            <p className="text-sm leading-7 text-ink-700 dark:text-dark-text/70">{s.p}</p>
          </section>
        ))}
        <p className="mt-8 text-center text-xs text-ink-300">更新日期 2026-05-31 · AI 图书馆</p>
      </div>
      <Motif name="mountain" className="mx-auto mt-4 h-14 w-56 text-celadon/20" />
    </main>
  );
}

export default function LegalPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-ink-500">加载中…</div>}>
      <LegalInner />
    </Suspense>
  );
}
