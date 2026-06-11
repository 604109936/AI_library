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
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#F4F2ED",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // 键盘弹起时收缩视口而非覆盖：否则智学输入框会被软键盘整个盖住（Android Chrome 108+ 默认 overlay）
  interactiveWidget: "resizes-content",
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
            让比例与微信内置浏览器一致；桌面大屏(≥1024)不处理。
            注意保留 user-scalable=no：此前重写把 Next viewport 配置里的禁缩放参数整个丢掉了 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{if(window.innerWidth>=1024)return;var sw=(window.screen&&window.screen.width)||393;var t=(sw>=320&&sw<=500)?sw:393;var m=document.querySelector('meta[name=\"viewport\"]');if(m)m.setAttribute('content','width='+t+', viewport-fit=cover, interactive-widget=resizes-content, user-scalable=no');}catch(e){}})();",
          }}
        />
        <Providers>
          <div className="app-shell">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
