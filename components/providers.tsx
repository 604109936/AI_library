"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useUI } from "@/lib/store";
import { Toaster } from "@/components/ui/Toaster";
import { LoginSheet } from "@/components/shell/LoginSheet";

function ThemeApplier() {
  const theme = useUI((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark =
        theme === "dark" ||
        (theme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", dark);
    };
    apply();
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);
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
      {children}
      <Toaster />
      <LoginSheet />
    </QueryClientProvider>
  );
}
