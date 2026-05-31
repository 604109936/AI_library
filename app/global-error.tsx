"use client";

// 根级错误边界：当 root layout 自身渲染出错时替换整个文档，
// 必须自带 <html>/<body>，且不能依赖外部样式（用内联样式兜底）。
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          background: "#F4F2ED",
          color: "#2A2C2E",
          fontFamily:
            "-apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif",
          padding: "0 32px",
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: "18px", fontWeight: 600 }}>应用遇到了一点问题</p>
        <p style={{ fontSize: "14px", color: "#76797C" }}>
          请刷新重试，给你带来不便十分抱歉
        </p>
        <button
          onClick={() => reset()}
          style={{
            marginTop: "8px",
            padding: "10px 24px",
            borderRadius: "9999px",
            border: "none",
            background: "#7C9885",
            color: "#FBFAF7",
            fontSize: "14px",
          }}
        >
          刷新重试
        </button>
      </body>
    </html>
  );
}
