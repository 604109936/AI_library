---
name: import-books
description: 校验并把书籍 JSON 数据导入本项目的 Supabase 数据库（categories/books/chapters），支持「非覆盖(默认,已存在则跳过)」与「覆盖(已存在则更新)」两种模式。当用户要导入/录入/更新书籍数据、说"导入书库/录数据/books.json 好了/把书导进去/覆盖导入"时使用。
---

# 书库导入 Skill

把符合格式的书籍 JSON **校验 + 导入** Supabase。所有面向用户的输出用**中文**。

## 两种写入模式
- **非覆盖（默认）**：库中已存在的 `book_id` **直接跳过、不动已有数据**（保护现有）。新书才导入。
- **覆盖**（加 `--overwrite`）：已存在的书**更新**为新数据（其章节先删后插，保证章节集合一致）。
- 无论哪种模式，**新书**都按数组顺序逐本插入，`shelved_at` 自动取插入时间（**JSON 里靠后=更新**）。
- ⚠️ 默认就是「非覆盖」。只有用户**明确说"覆盖/更新已有"**时才加 `--overwrite`。

## 前置条件
- `.env.local` 已配 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。
- 数据文件默认 `data/books.json`；格式见 `docs/书库导入JSON格式.md`。
- 脚本：`scripts/import-books.mjs`（校验+导入）、`scripts/db-stats.mjs`（回读统计）。

## 执行步骤（务必按序）
1. **确认模式**：默认非覆盖；用户说要覆盖/更新已有时才用覆盖（命令加 `--overwrite`）。
2. **确认数据文件路径**：默认 `data/books.json`；用户指定别的就用那个（命令末尾加路径）。
3. **干跑校验**（只检查 + 预判跳过/更新，不写库）：
   ```
   node --env-file=.env.local scripts/import-books.mjs              # 非覆盖预览
   node --env-file=.env.local scripts/import-books.mjs --overwrite  # 覆盖预览
   ```
   把校验报告 + 导入计划（将新增 N 本 / 跳过或更新 M 本）给用户看。
4. **看结果**：有 ❌ 错误 → 报告并停下，等修复后重跑；只有 ⚠️ 提示 → 不阻断，由用户决定。
5. **真正导入**（征得用户确认后）：
   ```
   node --env-file=.env.local scripts/import-books.mjs --commit              # 非覆盖
   node --env-file=.env.local scripts/import-books.mjs --commit --overwrite  # 覆盖
   ```
6. **回读确认**：`node --env-file=.env.local scripts/db-stats.mjs`，把分类/书/章节条数与每本概览给用户看。

## 关键约定（写/校验数据时遵守）
- JSON 顶层只需 `books` 数组；**6 个分类脚本自动建**（psy/growth/tech/biz/lit/his）。
- **时间字段都不用填**：`created_at` 已弃用；`shelved_at` 按数组顺序自动生成（**JSON 里最后一本=最新**）。
- **形态自动推导，无需 `modes`**：有 `video_url`→有视频、有 `audio_url`→有音频、章节有 `content`→有文字稿。
- `audio_start` **弃用**（音视频是独立"解读"版、与文字稿不同源，无章节↔音频映射）。
- `category_id` 只能填 6 个合法值之一，填错会因外键约束失败。
- 计数列（rating/readers/fav_count/review_count/read_count）不填，后端触发器/RPC 维护。

## 注意
- service_role secret key 是最高权限机密，只在 `.env.local`，绝不打印/外泄。
- 脚本可安全重复运行、可分批补：默认非覆盖不会动到已有书。
