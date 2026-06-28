"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { getHome } from "@/lib/api";

const SPLASH_MS = 3000;

/**
 * 开屏页：简介 AI 图书馆，给用户第一印象；停留约 3 秒里预取首页数据做加载缓冲，
 * 到时自动进入泡馆首页，亦可点「跳过」立即进入。
 */
export default function SplashPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [imgOk, setImgOk] = useState(true);
  const [count, setCount] = useState(Math.ceil(SPLASH_MS / 1000));

  useEffect(() => {
    qc.prefetchQuery({ queryKey: ["home"], queryFn: getHome }).catch(() => {});
    const t = setTimeout(() => router.replace("/library"), SPLASH_MS);
    const iv = setInterval(() => setCount((c) => (c > 1 ? c - 1 : c)), 1000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [router, qc]);

  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-start overflow-hidden bg-moon dark:bg-dark-bg">
      {/* 背景：codex 生成的开屏图 /splash.webp；缺图回退青瓷渐变 */}
      <div className="absolute inset-0 bg-gradient-to-b from-celadon-soft via-moon to-snow dark:from-dark-card dark:via-dark-bg dark:to-dark-bg" />
      {imgOk && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/splash.webp"
          alt=""
          onError={() => setImgOk(false)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* 顶部柔化，保证文字清晰；中下部留白露出图中的山 */}
      <div className="absolute inset-x-0 top-0 h-[48%] bg-gradient-to-b from-moon/85 via-moon/40 to-transparent dark:from-dark-bg/90 dark:via-dark-bg/45" />

      {/* 跳过 + 倒计时 */}
      <button
        onClick={() => router.replace("/library")}
        className="absolute right-4 top-[calc(env(safe-area-inset-top)+16px)] z-10 flex items-center gap-1 rounded-full bg-black/10 px-3 py-1 text-xs text-ink-700 backdrop-blur active:scale-95 dark:bg-white/10 dark:text-dark-text"
      >
        跳过 <span className="tabular-nums opacity-70">{count}s</span>
      </button>

      {/* 主体：与底图同帧呈现（不做入场动画） */}
      <div className="relative left-[10px] z-10 mt-[calc(6vh+58px)] flex transform-gpu flex-col items-center px-8 text-center">
        <span className="relative h-16 w-16 overflow-hidden rounded-2xl shadow-celadon">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/emblem.webp" alt="馆徽" className="h-full w-full object-cover" />
        </span>
        <h1 className="mt-4 font-serif text-lg tracking-[0.08em] text-[#384a40] [text-shadow:0_1px_4px_rgba(30,45,38,0.28)] dark:text-dark-text">AI 图书馆</h1>
        <p className="mt-2.5 max-w-[340px] text-xs font-medium leading-6 text-celadon-700 [text-shadow:0_1px_3px_rgba(30,45,38,0.22)] dark:text-dark-text/85">
          一座懂你的智慧图书馆
          <br />
          汇尽古今好书，伴你在阅读中遇见自己
        </p>
      </div>

      {/* 加载进度（与停留时长同步） */}
      <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+40px)] z-10 h-1 w-32 overflow-hidden rounded-full bg-line/70 dark:bg-white/15">
        <motion.div
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: SPLASH_MS / 1000, ease: "linear" }}
          className="h-full rounded-full bg-celadon"
        />
      </div>
    </main>
  );
}
