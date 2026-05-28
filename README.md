# AI 图书馆 H5

一座"会回答问题"的图书馆 H5 应用。四大模块：**智学**（AI 问答）· **泡馆**（分类阅读）· **乱翻**（竖滑视频流）· **我的**（收藏/笔记/书评）。

## 技术栈

- React 18 + Next.js 14 (App Router) + TypeScript
- Tailwind CSS（新中式设计 token）+ Framer Motion
- Zustand（状态）+ TanStack Query（数据）
- 当前为前端 + Mock 数据；后端将接 Supabase + 火山 Viking + 七牛云

## 本地开发

```bash
pnpm install
pnpm dev          # http://localhost:3000（已监听 0.0.0.0，局域网手机可访问）
```

## 构建

```bash
pnpm build && pnpm start
```

## 部署

推送到 GitHub 后，在 Vercel 导入本仓库即可（自动识别 Next.js，零额外配置）。

## 文档

- `docs/01_功能清单.md` 功能清单
- `docs/02_设计规范.md` 新中式设计规范
- `docs/03_原型图清单.md` / `docs/04_功能清单_原型映射.md` 原型与映射
- `docs/05_交互说明.md` 逐页交互说明
- `prototypes/` 29 张新中式原型图
