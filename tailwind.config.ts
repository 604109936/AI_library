import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 新中式 New-Chinese palette
        moon: "#F4F2ED", // 月白 背景
        snow: "#FBFAF7", // 素白 卡片
        ink: {
          DEFAULT: "#2A2C2E", // 黛墨 主文字
          700: "#4A4D50",
          500: "#76797C",
          300: "#A8ABAD",
        },
        line: "#E6E3DB", // 描边/分隔
        celadon: {
          DEFAULT: "#7C9885", // 青瓷 主强调
          700: "#5E7768",
          500: "#7C9885",
          300: "#A6BCAC",
          soft: "#E3EAE3", // 青瓷浅底
        },
        brass: "#B89B6E", // 黄铜 次强调
        rouge: "#A8423A", // 胭脂 高亮/评分/收藏
        // dark mode
        "dark-bg": "#14140F",
        "dark-card": "#1F1E18",
        "dark-text": "#EDE6D6",
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "-apple-system",
          "PingFang SC",
          "Noto Sans SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
        serif: [
          "var(--font-serif)",
          "Noto Serif SC",
          "Songti SC",
          "SimSun",
          "serif",
        ],
      },
      borderRadius: {
        sm: "8px",
        DEFAULT: "14px",
        lg: "18px",
        xl: "22px",
        "2xl": "24px",
      },
      boxShadow: {
        sm: "0 1px 3px rgba(42,44,46,0.05)",
        DEFAULT: "0 4px 16px rgba(42,44,46,0.06)",
        lg: "0 10px 36px rgba(42,44,46,0.08)",
        celadon: "0 8px 24px rgba(124,152,133,0.18)",
      },
      maxWidth: {
        app: "480px",
      },
      keyframes: {
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "like-burst": {
          "0%": { opacity: "0", transform: "scale(0.3)" },
          "20%": { opacity: "1", transform: "scale(1.15)" },
          "100%": { opacity: "0", transform: "scale(1) translateY(-22px)" },
        },
        // 双击收藏的小心心：从中心向随机方向（--tx/--ty 内联变量）散开淡出
        "like-fly": {
          "0%": { opacity: "0", transform: "translate(0, 0) scale(0.4)" },
          "30%": { opacity: "1" },
          "100%": { opacity: "0", transform: "translate(var(--tx, 0px), var(--ty, -48px)) scale(1)" },
        },
        "spin-slow": {
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.22s cubic-bezier(0.4,0,0.2,1)",
        "scale-in": "scale-in 0.18s cubic-bezier(0.4,0,0.2,1)",
        "like-burst": "like-burst 0.8s cubic-bezier(0.4,0,0.2,1) forwards",
        "like-fly": "like-fly 0.6s ease-out both", // both：动画延迟期间也保持 0% 的透明态
        "spin-slow": "spin-slow 8s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
