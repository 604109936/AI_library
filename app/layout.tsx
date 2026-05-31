import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "AI 图书馆",
  description: "智学 · 泡馆 · 乱翻 · 我的 —— 一座会回答问题的图书馆",
  applicationName: "AI 图书馆",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "AI 图书馆",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"],
    apple: [{ url: "/icon.svg" }],
  },
  formatDetection: { telephone: false, email: false, address: false, date: false },
};

export const viewport: Viewport = {
  // 明暗双值：PWA/状态栏底色跟随系统配色，避免暗色用户看到月白状态栏
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F2ED" },
    { media: "(prefers-color-scheme: dark)", color: "#14140F" },
  ],
  width: "device-width",
  initialScale: 1,
  // 允许放大（WCAG 1.4.4）：不再禁用缩放
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {/* 视口归一：部分手机的"添加到主屏幕"WebView 不按设备真实宽度渲染，
            导致内容偏宽偏松。这里在移动端把布局视口锁定为手机真实宽度，
            让比例与微信内置浏览器一致；桌面大屏(≥1024)不处理。 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{if(window.innerWidth>=1024)return;var sw=(window.screen&&window.screen.width)||393;var t=(sw>=320&&sw<=500)?sw:393;var m=document.querySelector('meta[name=\"viewport\"]');if(m)m.setAttribute('content','width='+t+', viewport-fit=cover, maximum-scale=5');}catch(e){}})();",
          }}
        />
        {/* 暗色首屏防闪：在水合前按本地存储的主题偏好提前加 .dark，避免 dark/system 用户先闪一屏月白 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t='light';var raw=localStorage.getItem('ail-ui');if(raw){var s=JSON.parse(raw);if(s&&s.state&&s.state.theme)t=s.state.theme;}var dark=t==='dark'||(t==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark)document.documentElement.classList.add('dark');}catch(e){}})();",
          }}
        />
        <Providers>
          <div className="app-shell">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
