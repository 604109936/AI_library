"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useUI, useAuth } from "@/lib/store";
import { Toaster } from "@/components/ui/Toaster";
import { LoginSheet } from "@/components/shell/LoginSheet";

function ThemeApplier() {
  const theme = useUI((s) => s.theme);
  useEffect(() => {
    // 本期：外观仅「浅色 / 深色」，不再跟随系统
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  return null;
}

// 首屏恢复 Supabase 登录会话（刷新不掉线）
function AuthInit() {
  useEffect(() => {
    useAuth.getState().initAuth();
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const qc = useRef(
    new QueryClient({
      defaultOptions: {
        queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
      },
    })
  );
  return (
    <QueryClientProvider client={qc.current}>
      <ThemeApplier />
      <AuthInit />
      {children}
      <Toaster />
      <LoginSheet />
    </QueryClientProvider>
  );
}
