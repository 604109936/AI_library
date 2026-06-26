"use client";

/** 根级错误边界：当根布局自身出错时兜底。需自带 html/body，并用内联样式（此时全局 CSS 可能不可用）。 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <head>
        {/* global-error 替换根布局后会丢失 layout 的 viewport；客户端组件不能用 export const viewport，
            必须手写 meta，否则崩溃兜底页在手机上按桌面 ~980px 缩放、文字与「重试」按钮被缩到难以点中（Bug#24） */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body style={{ margin: 0, background: "#F4F2ED", color: "#2A2C2E", fontFamily: "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" }}>
        <main
          style={{
            minHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 32px",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>出了点小状况</p>
          <p style={{ fontSize: 14, color: "#76797C", marginTop: 8 }}>请刷新页面，或稍后再试</p>
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              border: "none",
              borderRadius: 999,
              background: "#7C9885",
              color: "#FBFAF7",
              padding: "10px 24px",
              fontSize: 14,
            }}
          >
            重试
          </button>
        </main>
      </body>
    </html>
  );
}
