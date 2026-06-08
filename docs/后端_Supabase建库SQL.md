# AI 图书馆 · 后端建库 SQL（Supabase）

> 生成：阶段2 建库。架构＝**Supabase 直连 + Supabase Auth + RLS 主防线**。
> 本文 SQL 已经过多智能体「安全/RLS + 类型正确性」双复核与收紧，可放心粘贴执行。
> **每本书的「封面 / 视频 / 音频」在阿里云 OSS**：`books` 的 `cover_url / video_url / audio_url` 直接填 OSS 公开 URL。
> 氛围图(hero)/海报(poster) 是按分类的**前端静态装饰图**（`public/`，前端按 categoryId 取，不入库）；作者头像 APP 未用、不入库。
> **Supabase 只建 `avatars` 一个桶**（存用户「编辑资料」上传的头像，见第④批）。

## 怎么跑
1. Supabase 控制台左侧 **SQL Editor → New query**。
2. **按 ①→②→③ 顺序**，每次复制**一整批**粘进去 → 右下 **Run**（或 Ctrl+Enter）→ 看到 **Success. No rows returned** 即成功。
3. **顺序很重要**：② 建好 auth/profiles 后，③ 的 `(select auth.uid())` 归属判断才有依据；④ 存储桶建议用控制台。
4. 每批都可**重复执行不报错**（幂等）。

## 字段已覆盖「智学 Agent」所需
- 书：`ai_digest`（200字概要：为什么推荐/解决问题/中心思想）；章：`ai_summary`（100字章概要）；章正文 `content`。
- 用户笔记/书评（notes/reviews）、收藏/在读/已读（favorites/reading_history/text_progress/media_progress）、学习总时长（profiles.read_seconds）。
- 「存但前端不展示」字段：`rating`（书评均分1位小数）/`readers`（在读+读完人数）/`likes`/`fav_count`（收藏人数）/`review_count`/`read_count`（阅读次数，同一人多次累加）。

---

## 第 ① 批 · 目录表（categories / books / chapters，公开读）

```sql
-- =====================================================================
-- A组：目录表（公开读 / 仅 service_role 维护）
-- 对应前端 lib/types.ts 的 Book / Chapter / Category
-- 说明：id 沿用前端文本 id（如 'mindset'/'mindset-c1'/'psy'），便于平滑迁移。
-- 本块可在 Supabase SQL Editor 一次粘贴执行，且可重复执行不报错。
-- =====================================================================

-- ---------- 1. 分类表 categories ----------
-- 对应 Category：id / name / icon（lucide 名）。
-- 前端 Category.count（每类书数）不在此存，迁移后用 count 查询实时算。
create table if not exists public.categories (
  id          text primary key,                 -- 文本主键，如 'psy'/'growth'
  name        text not null,                    -- 分类名，如 '心学'
  icon        text not null default '',         -- lucide 图标名，如 'Brain'
  sort_order  int  not null default 0           -- 排序权重（前端按此或固定顺序展示）
);
comment on table public.categories is 'A组-目录：图书分类（公开读，后台维护）';

-- ---------- 2. 书籍表 books ----------
-- 对应 Book。注意命名 snake_case：
--   cover->cover_url, coverSeed->cover_seed,
--   categoryId->category_id, durationMin->duration_min,
--   favCount->fav_count, reviewCount->review_count,
--   createdAt->created_at, shelvedAt->shelved_at。
-- 前端 Book.category（分类显示名）不单独存，迁移后用 books 关联 categories.name 得到。
create table if not exists public.books (
  id                 text primary key,                 -- 文本主键，如 'mindset'
  title              text not null,                    -- 书名
  author             text not null default '',         -- 作者
  cover_url          text,                             -- 封面图 URL（阿里云 OSS）；空则前端用 cover_seed 渲染兜底封面
  cover_seed         int  not null default 1,          -- 兜底封面种子
  -- 注：氛围图(hero)/海报(poster) 是「按分类的前端静态装饰图」(public/heroes、public/posters，前端按 categoryId 取)，不入库；
  --     作者头像 APP 未使用，故不设字段。每本书只在 OSS 存 封面/视频/音频 三个 URL。
  category_id        text not null
                       references public.categories(id) on update cascade,  -- 所属分类
  tags               text[] not null default '{}',     -- 标签数组（前端会把分类名作为首个标签置顶，可不重复存）
  summary            text not null default '',         -- 简介
  intro              text not null default '',         -- 乱翻一句话
  words              int  not null default 0,          -- 字数
  duration_min       int  not null default 0,          -- 预估阅读分钟
  has_video          boolean not null default false,   -- 是否有视频
  has_audio          boolean not null default false,   -- 是否有音频
  has_text           boolean not null default false,   -- 是否有文字稿
  video_url          text,                             -- 视频地址（阿里云 OSS 公开 URL）
  audio_url          text,                             -- 音频地址（阿里云 OSS 公开 URL）
  featured           boolean not null default false,   -- 是否精选/热门好书
  rating             numeric(2,1) not null default 0 check (rating between 0 and 5),  -- 评分 0-5（存但前端不展示）
  readers            int  not null default 0,          -- 在读人数=在读+读完人数（存但前端不展示）
  fav_count          int  not null default 0,          -- 收藏人数（点赞即收藏，无独立 likes；存但前端不展示）
  review_count       int  not null default 0,          -- 书评数（存但前端不展示）
  read_count         int  not null default 0,          -- 阅读次数（同一人多次累加、不去重；存但前端不展示；后端经 RPC 自增，详见「计数维护机制」）
  ai_digest          text,                             -- 供「智学」Agent 的 200字概要（为什么推荐/解决问题/中心思想；不展示）
  created_at         timestamptz not null default now(),-- 出版/创作时间（热门好书按此由远到近排序）
  shelved_at         timestamptz not null default now() -- 入库时间（分类默认倒序 / Banner 取每类最新）
);
comment on table public.books is 'A组-目录：书籍（公开读，后台维护）';

-- books 常用查询索引：按分类筛选、按入库/出版时间排序、阅读类型筛选
create index if not exists idx_books_category_shelved on public.books (category_id, shelved_at desc);  -- 分类列表/首页每类最新（最左列 category_id 等值过滤亦覆盖，无需再建单列索引）
create index if not exists idx_books_shelved_at on public.books (shelved_at desc);  -- 分类默认排序/Banner
create index if not exists idx_books_created_at on public.books (created_at);        -- 热门好书排序
create index if not exists idx_books_featured   on public.books (featured) where featured = true;
-- tags 数组按标签搜索（搜索页 tags 模糊匹配可配合）
create index if not exists idx_books_tags_gin   on public.books using gin (tags);

-- ---------- 3. 章节表 chapters ----------
-- 对应 Chapter：id / bookId->book_id / no / title / content / audioStart->audio_start。
-- 前端 Chapter.status（已读态）属于用户数据，由 text_progress.read_chapter_ids 派生，不在此存。
create table if not exists public.chapters (
  id           text primary key,                       -- 文本主键，如 'mindset-c1'
  book_id      text not null
                 references public.books(id) on delete cascade on update cascade,  -- 所属书
  no           int  not null,                          -- 章序号（从 1 起）
  title        text not null,                          -- 章标题
  content      text not null default '',               -- 章完整正文（Agent「读取章内容工具」用）
  ai_summary   text,                                    -- 供「智学」Agent 的 100字章概要（中心思想/解决什么问题；不展示）
  audio_start  int  not null default 0                 -- 该章在整书音频中的起始秒（切章 seek）
);
comment on table public.chapters is 'A组-目录：章节（公开读，后台维护）';

-- 按书取章节并按 no 排序
create index if not exists idx_chapters_book on public.chapters (book_id, no);

-- ---------- 4. 开启 RLS + 公开读 policy（不给写 policy，写仅 service_role） ----------
-- 项目「自动 RLS」虽会 enable，但这里显式 enable 以保证幂等可靠。
alter table public.categories enable row level security;
alter table public.books      enable row level security;
alter table public.chapters   enable row level security;

-- 公开读：anon（游客）+ authenticated（登录用户）均可 select。
-- drop if exists 保证可重复执行。
drop policy if exists "目录公开读_categories" on public.categories;
create policy "目录公开读_categories"
  on public.categories for select
  to anon, authenticated
  using (true);

drop policy if exists "目录公开读_books" on public.books;
create policy "目录公开读_books"
  on public.books for select
  to anon, authenticated
  using (true);

drop policy if exists "目录公开读_chapters" on public.chapters;
create policy "目录公开读_chapters"
  on public.chapters for select
  to anon, authenticated
  using (true);

-- ---------- 5. 显式 grant（Supabase 通常 auto，这里为稳妥显式给只读 SELECT） ----------
grant usage on schema public to anon, authenticated;
grant select on public.categories to anon, authenticated;
grant select on public.books      to anon, authenticated;
grant select on public.chapters   to anon, authenticated;
-- 不授予 anon/authenticated 的 insert/update/delete：写入只走 service_role（后台）。
```

**验证**：左侧 **Table Editor** 出现 `categories` / `books` / `chapters` 三张空表（数据第④步录入）。

---

## 第 ② 批 · 账号与资料（profiles + 新用户自动建档）

```sql
-- =====================================================================
-- B组：账号与资料（profiles + 自动建档触发器 + updated_at 触发器函数）
-- auth.users 用 Supabase 内置，不在此建。
-- 对应前端 lib/types.ts 的 UserProfile（email 来自 auth.users，不冗余存 profiles）。
-- 本块可一次粘贴执行，可重复执行不报错。
-- =====================================================================

-- ---------- 0. 通用 updated_at 自动维护函数（A/B/C 三组共用） ----------
-- 任何带 updated_at 列的表，挂上 trigger 后，每次 UPDATE 自动把 updated_at 刷成 now()。
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
comment on function public.set_updated_at() is '通用触发器：UPDATE 时自动维护 updated_at';

-- ---------- 1. 资料表 profiles ----------
-- 对应 UserProfile：id / nickname / bio / avatarSeed->avatar_seed / avatarUrl->avatar_url / account。
-- email 不存这里（直接读 auth.users.email）。
-- stats（hours/read/notes/reviews）不存，迁移后用查询实时算；唯一例外 read_seconds 存这里。
create table if not exists public.profiles (
  id           uuid primary key
                 references auth.users(id) on delete cascade,   -- 与 auth.users 一一对应
  nickname     text not null default '书友',                    -- 昵称
  bio          text not null default '',                        -- 简介
  avatar_seed  int  not null default 1,                         -- 兜底头像种子
  avatar_url   text,                                            -- 头像 URL（Storage）
  account      text,                                            -- 登录账号（账号密码登录时填）
  read_seconds int  not null default 0,                         -- 累计阅读/收听时长（秒，用于「我的-总时长」）
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.profiles is 'B组-资料：用户公开资料（与 auth.users 1:1）';

-- profiles 的 updated_at 自动维护
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- 2. 开启 RLS ----------
alter table public.profiles enable row level security;

-- 资料策略（自封闭，避免泄露 account 登录账号）：
--   - 仅本人可 select / insert / update（id = (select auth.uid())）。本版「读者评价」数据-only 不展示，前端无需读他人资料。
--   - 不提供 delete（删号由 auth.users 级联，service_role 维护）。
--   - 将来要展示他人昵称/头像时，再单独建只含安全列(id/nickname/avatar_*)的视图公开，account 不外泄。
drop policy if exists "资料公开读_profiles" on public.profiles;   -- 清掉可能存在的旧公开读策略
drop policy if exists "资料本人可读_select" on public.profiles;
create policy "资料本人可读_select"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists "资料本人可改_update" on public.profiles;
create policy "资料本人可改_update"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- 一般情况下新用户由触发器（SECURITY DEFINER）自动建档，无需前端 insert；
-- 仍保留一条「本人可插入」策略以防补建（id 必须等于自己）。
drop policy if exists "资料本人可插_insert" on public.profiles;
create policy "资料本人可插_insert"
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

-- ---------- 3. 新用户自动建档触发器 handle_new_user ----------
-- auth.users 每插入一个新用户，自动在 profiles 建一行。
-- nickname 默认取邮箱「@」前缀；无邮箱则用 '书友'。
-- SECURITY DEFINER：以函数属主权限运行，绕过 RLS 写入 profiles。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nickname, account)
  values (
    new.id,
    coalesce(nullif(split_part(new.email, '@', 1), ''), '书友'),  -- 邮箱前缀作默认昵称
    new.email
  )
  on conflict (id) do nothing;   -- 已存在则跳过，保证幂等
  return new;
end;
$$;
comment on function public.handle_new_user() is 'B组：auth.users 插入新用户时自动建 profiles';

-- 绑定到 auth.users 的插入事件（先 drop 保证可重复执行）
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 4. 显式 grant ----------
grant select, insert, update on public.profiles to authenticated;  -- 不授予 anon（游客无资料）
```

**验证**：出现 `profiles` 表。可在 **Authentication → Users** 手动新增一个用户，回 Table Editor 看 `profiles` 是否自动多了一行（说明触发器生效）。

---

## 第 ③ 批 · 用户数据（收藏/笔记/书评/历史/进度/对话 + RLS）

```sql
-- =====================================================================
-- C组：用户数据（RLS 仅本人 user_id = (select auth.uid()) 可增删改查）
-- 对应前端 lib/store.ts 的 useLibrary / useChat 等。
-- 本块自包含（含 set_updated_at 函数），可独立、重复执行不报错。
-- =====================================================================

-- ---------- 0. 通用 updated_at 函数（与 B组同名，create or replace 幂等，重复定义无害） ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- 1. 收藏 favorites ----------
-- 对应 useLibrary.favorites（string[] 书 id）。PK(user_id, book_id) 天然去重。
create table if not exists public.favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  book_id    text not null,                           -- 书 id（不外键到 books，便于解耦/迁移）
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
comment on table public.favorites is 'C组-用户数据：收藏';
create index if not exists idx_favorites_user on public.favorites (user_id, created_at desc);

-- ---------- 2. 笔记 notes ----------
-- 对应 NoteItem：excerpt（原文摘录）/ note（我的笔记）/ color（高亮色）/
--   start->start_offset / end->end_offset（章内字符偏移，精确定位重复文本）。
-- bookTitle/chapterTitle/bookCoverSeed 不冗余存，迁移后由 books/chapters 关联得到。
create table if not exists public.notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  book_id      text not null,
  chapter_id   text not null,
  excerpt      text not null default '',              -- 原文摘录
  note         text not null default '',              -- 我的笔记
  color        text not null default '',              -- 高亮色，如 '#8FB39B'
  start_offset int,                                   -- 摘录在本章正文中的起始字符偏移
  end_offset   int,                                   -- 结束字符偏移
  created_at   timestamptz not null default now()
);
comment on table public.notes is 'C组-用户数据：阅读笔记/高亮';
create index if not exists idx_notes_user            on public.notes (user_id, created_at desc);
create index if not exists idx_notes_user_book_chap  on public.notes (user_id, book_id, chapter_id);  -- notesOfChapter 查询

-- ---------- 3. 书评 reviews ----------
-- 对应 Review。每人每书一条 → UNIQUE(user_id, book_id) 支持 upsert（store.upsertReview）。
-- nickname/avatarSeed 不冗余存，迁移后关联 profiles 得到。
create table if not exists public.reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  book_id    text not null,
  rating     numeric(2,1) not null default 5 check (rating >= 0.5 and rating <= 5 and (rating * 2) = floor(rating * 2)),  -- 评分 0.5–5（半星，前端 StarPicker 支持 0.5 步进）
  title      text,                                    -- 书评标题（可空）
  content    text not null default '',                -- 书评正文
  likes      int  not null default 0,                 -- 点赞数（由 review_likes 聚合维护/或后台刷新）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, book_id)                           -- 每人每书唯一，配合 upsert(onConflict)
);
comment on table public.reviews is 'C组-用户数据：书评（每人每书一条）';
create index if not exists idx_reviews_book on public.reviews (book_id, created_at desc);  -- 书详情页书评列表
create index if not exists idx_reviews_user on public.reviews (user_id, created_at desc);  -- 我的书评

-- reviews 的 updated_at 自动维护
drop trigger if exists trg_reviews_updated_at on public.reviews;
create trigger trg_reviews_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

-- ---------- 4. 书评点赞 review_likes ----------
-- 对应 useLibrary.likedReviews。PK(user_id, review_id) 去重。
create table if not exists public.review_likes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  review_id  uuid not null references public.reviews(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, review_id)
);
comment on table public.review_likes is 'C组-用户数据：书评点赞';
create index if not exists idx_review_likes_review on public.review_likes (review_id);

-- ---------- 5. 阅读历史 reading_history ----------
-- 对应 HistoryItem + store.pushHistory 的去重口径：
--   音视频共用一条(mode_category='av')，文字稿单独一条('text')。
-- PK(user_id, book_id, mode_category) → 每书每大类一条。
create table if not exists public.reading_history (
  user_id        uuid not null references auth.users(id) on delete cascade,
  book_id        text not null,
  mode_category  text not null check (mode_category in ('av', 'text')),  -- 'av'=音视频（前端 video/audio 落库前统一映射为 av）/ 'text'=文字稿
  progress       int  not null default 0 check (progress between 0 and 100),  -- 进度 0-100
  last_at        timestamptz not null default now(),                     -- 最近访问时间
  primary key (user_id, book_id, mode_category)
);
comment on table public.reading_history is 'C组-用户数据：阅读历史（按 书+大类 去重）';
create index if not exists idx_reading_history_user on public.reading_history (user_id, last_at desc);

-- ---------- 6. 文字稿进度 text_progress ----------
-- 对应 useLibrary.progress（Progress）+ readChapters（已读章节）。
-- PK(user_id, book_id) → 每书一条文字进度。
create table if not exists public.text_progress (
  user_id          uuid not null references auth.users(id) on delete cascade,
  book_id          text not null,
  last_chapter_id  text,                              -- 续读章节 id，如 'mindset-c3'
  last_chapter_no  int,                               -- 续读章序号
  pct              int not null default 0 check (pct between 0 and 100),  -- 全书阅读百分比
  read_chapter_ids text[] not null default '{}',      -- 已读毕章节 id 列表（判定整本读完）
  updated_at       timestamptz not null default now(),
  primary key (user_id, book_id)
);
comment on table public.text_progress is 'C组-用户数据：文字稿阅读进度';

drop trigger if exists trg_text_progress_updated_at on public.text_progress;
create trigger trg_text_progress_updated_at
  before update on public.text_progress
  for each row execute function public.set_updated_at();

-- ---------- 7. 音视频进度 media_progress ----------
-- 对应 useLibrary.mediaProgress（续播位置 position）+ mediaPlayed（真实覆盖 played）。
-- PK(user_id, book_id) → 每书一条音视频进度（详情↔乱翻共享）。
create table if not exists public.media_progress (
  user_id    uuid not null references auth.users(id) on delete cascade,
  book_id    text not null,
  position   numeric(5,4) not null default 0 check (position between 0 and 1),  -- 续播位置 0-1
  played     numeric(5,4) not null default 0 check (played   between 0 and 1),  -- 真实播放覆盖 0-1（只增）
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
comment on table public.media_progress is 'C组-用户数据：音视频续播/覆盖进度';

drop trigger if exists trg_media_progress_updated_at on public.media_progress;
create trigger trg_media_progress_updated_at
  before update on public.media_progress
  for each row execute function public.set_updated_at();

-- ---------- 8. 智学对话 chat_sessions ----------
-- 对应 ChatSession：id（文本，前端生成）/ title / messages（整段 ChatMessage[] 存 jsonb）。
create table if not exists public.chat_sessions (
  id         text not null,                           -- 会话 id（前端文本 id）
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default '',
  messages   jsonb not null default '[]'::jsonb,      -- ChatMessage[]（内含 citations/recommendations；建议只存 book_id+章序号，渲染时 JOIN 避免历史陈旧）
  compressed_history text,                             -- 智学 Agent 上下文压缩历史 {$HistoryConversation}（≥500K 压成约 10K）
  compressed_until   int,                              -- 已压缩到第几条消息（最近 20 轮不压缩；区分"保留消息 / 压缩摘要"）
  updated_at timestamptz not null default now(),
  primary key (user_id, id)                           -- 同一用户内 id 唯一
);
comment on table public.chat_sessions is 'C组-用户数据：智学对话会话';
create index if not exists idx_chat_sessions_user on public.chat_sessions (user_id, updated_at desc);

drop trigger if exists trg_chat_sessions_updated_at on public.chat_sessions;
create trigger trg_chat_sessions_updated_at
  before update on public.chat_sessions
  for each row execute function public.set_updated_at();

-- =====================================================================
-- C组：开启 RLS + per-user 四类策略（select/insert/update/delete）
-- 用 do $$ 循环为「以 user_id 标识归属」的表批量建策略，避免重复手写。
-- insert 用 with check；update 用 using + with check；select/delete 用 using。
-- =====================================================================
do $$
declare
  t text;
  -- 这些表都用 user_id 列标识归属（review_likes 也是 user_id）
  tbls text[] := array[
    'favorites', 'notes', 'reviews', 'review_likes',
    'reading_history', 'text_progress', 'media_progress', 'chat_sessions'
  ];
begin
  foreach t in array tbls loop
    -- 开启 RLS
    execute format('alter table public.%I enable row level security;', t);

    -- 先删旧策略（幂等）
    execute format('drop policy if exists "本人可读_%1$s" on public.%1$s;', t);
    execute format('drop policy if exists "本人可插_%1$s" on public.%1$s;', t);
    execute format('drop policy if exists "本人可改_%1$s" on public.%1$s;', t);
    execute format('drop policy if exists "本人可删_%1$s" on public.%1$s;', t);

    -- SELECT：仅本人
    execute format(
      'create policy "本人可读_%1$s" on public.%1$s for select to authenticated using (user_id = (select auth.uid()));', t);
    -- INSERT：仅本人（with check）
    execute format(
      'create policy "本人可插_%1$s" on public.%1$s for insert to authenticated with check (user_id = (select auth.uid()));', t);
    -- UPDATE：仅本人（using + with check）
    execute format(
      'create policy "本人可改_%1$s" on public.%1$s for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));', t);
    -- DELETE：仅本人
    execute format(
      'create policy "本人可删_%1$s" on public.%1$s for delete to authenticated using (user_id = (select auth.uid()));', t);
  end loop;
end$$;

-- 本版「读者评价（他人书评）」数据-only、不前端展示，故 reviews / review_likes 一律「仅本人可读」
-- （上面的循环已配好 per-user 四类策略），不开公开读。
-- 将来要展示读者评价/点赞数时，再单独建「只读安全视图或 count RPC」公开，避免越权读他人明细。
drop policy if exists "书评公开读_reviews"        on public.reviews;       -- 清掉可能存在的旧公开读
drop policy if exists "点赞公开读_review_likes"   on public.review_likes;  -- 清掉可能存在的旧公开读

-- ---------- 显式 grant（C组表全部仅授予 authenticated；不给 anon——用户数据需登录） ----------
grant select, insert, update, delete on
  public.favorites, public.notes, public.reviews, public.review_likes,
  public.reading_history, public.text_progress, public.media_progress, public.chat_sessions
  to authenticated;

-- =====================================================================
-- C组补充：乱翻每日推荐 flip_feed + 搜索词流水 search_logs（非标准 per-user CRUD，单独配策略）
-- =====================================================================

-- 9. 乱翻「猜你想读」每日书单（每天凌晨由 minimax 异步生成 50 本/人，前端轮询）
create table if not exists public.flip_feed (
  user_id    uuid not null references auth.users(id) on delete cascade,
  gen_date   date not null,                            -- 生成日期
  book_ids   text[] not null default '{}'
               check (array_length(book_ids, 1) is null or array_length(book_ids, 1) <= 50),  -- ≤50 本书 id（已排序，前端轮询；新用户回退可少于50）
  created_at timestamptz not null default now(),
  primary key (user_id, gen_date)
);
comment on table public.flip_feed is 'C组：乱翻每日「猜你想读」书单（service_role 写，本人只读）';
alter table public.flip_feed enable row level security;
drop policy if exists "本人可读_flip_feed" on public.flip_feed;
create policy "本人可读_flip_feed" on public.flip_feed for select to authenticated using (user_id = (select auth.uid()));
-- 写入仅 service_role（定时任务）：不建写策略即默认拒绝前端写。
grant select on public.flip_feed to authenticated;

-- 10. 搜索词流水（聚合「热门搜索」Top20 用；个人「最近搜索」仍前端本地）
create table if not exists public.search_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,  -- 可空：游客搜索也计入热门
  term       text not null,
  created_at timestamptz not null default now()
);
comment on table public.search_logs is 'C组：搜索词流水（只插入；热门聚合走后台，明细不公开读）';
create index if not exists idx_search_logs_term    on public.search_logs (term);
create index if not exists idx_search_logs_created on public.search_logs (created_at desc);
alter table public.search_logs enable row level security;
drop policy if exists "任何人可写_search_logs" on public.search_logs;
create policy "任何人可写_search_logs" on public.search_logs for insert to anon, authenticated with check (true);
grant insert on public.search_logs to anon, authenticated;
```

**验证**：出现 10 张表（favorites / notes / reviews / review_likes / reading_history / text_progress / media_progress / chat_sessions / flip_feed / search_logs）。前 8 张「仅本人可读写」；`flip_feed` 本人只读（后台写）；`search_logs` 只可写不可读（热门聚合走后台）。reviews/review_likes 本版不公开读（读者评价数据-only）。

---

## 第 ④ 批 · 存储桶（只建 avatars 用户头像桶）

> 封面/氛围图/海报/音视频都在**阿里云 OSS**（填 URL 即可），所以 Supabase 只需 `avatars` 一个桶存用户上传的头像。
> 推荐用**方案A（控制台建桶）**，零权限问题；方案B 是等价 SQL，权限不足时跳过即可。

```sql
-- =====================================================================
-- Storage：对象存储桶（仅 avatars 用户头像）
-- 【重要】每本书的封面/视频/音频都在【阿里云 OSS】：books.cover_url / video_url / audio_url 填 OSS 公开 URL，
--   因此 Supabase 不需要 covers/audio/video 桶。（氛围图/海报为按分类的前端静态装饰图、不入库；作者头像未使用。）
-- 本批只建一个桶：
--   - avatars ← 用户在「编辑资料」里上传的头像（走 supabase-js 上传，必须有本桶）。
-- 表里只存 URL，文件本体放对应存储。游客也要能看头像 → 公开读。
-- =====================================================================

-- ========== 方案A（推荐，控制台操作，零权限问题） ==========
-- 控制台 → Storage → New bucket，建 1 个桶并勾选 Public bucket：
--   avatars （用户上传的头像，对应 profiles.avatar_url）
-- 勾上 Public bucket 后，桶内文件可经公开 URL 直接读取，无需额外读策略。
-- 封面/视频/音频无需建桶：books.cover_url/video_url/audio_url 直接填阿里云 OSS 公开 URL。

-- ========== 方案B（SQL 建桶，权限足够时可一次执行） ==========
-- 1) 创建公开桶（public=true 即公开读）；on conflict 幂等。
insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

-- 2) storage.objects 默认已 enable RLS。策略要点：
--    - avatars「公开读」：任何人可 select（读取头像）。
--    - avatars「登录用户可写自己目录」：约定路径以 "<uid>/..." 开头，则本人可 insert/update/delete。
-- 若 create policy 报权限错（storage.objects owner 非当前角色），改用方案A即可，效果等价。

drop policy if exists "桶公开读" on storage.objects;
create policy "桶公开读"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

-- 头像：登录用户可写自己目录（路径首段 = 自己的 uid）
drop policy if exists "头像_本人可传" on storage.objects;
create policy "头像_本人可传"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "头像_本人可改" on storage.objects;
create policy "头像_本人可改"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "头像_本人可删" on storage.objects;
create policy "头像_本人可删"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- 上传头像示例（前端 supabase-js）：
--   supabase.storage.from('avatars').upload(`${user.id}/avatar.webp`, file, { upsert: true })
-- 取公开 URL：
--   supabase.storage.from('avatars').getPublicUrl(`${user.id}/avatar.webp`).data.publicUrl
-- 然后把 publicUrl 写入 profiles.avatar_url。
```

**验证**：**Storage** 里出现 `avatars` 一个 **Public** 桶（封面/音视频都走阿里云 OSS，不在 Supabase）。

---

## 计数字段的维护机制（字段已建表，后端阶段补触发器/定时任务）
以下「存但前端不展示」的计数列已在 `books` 表中，但**需后端维护**，否则会一直是 0：
- `books.rating` = `round(avg(reviews.rating),1)`、`books.review_count` = 该书 reviews 条数 → 在 reviews 上加 after insert/update/delete 触发器或定时任务回写。
- `books.fav_count`（收藏人数，**点赞即收藏**、无独立 likes）= 该书 favorites 条数 → 在 favorites 上加 after insert/delete 触发器回写。
- `books.readers`（在读+读完人数）= 该书在 reading_history/text_progress/media_progress 出现的 distinct user 数 → 定时任务/视图统计回写。
- `books.read_count`（阅读次数，同一人多次累加）= 后端在「判定一次阅读」时经 service_role RPC `read_count = read_count + 1`（**不去重**，与去重的 reading_history 无关）。需后端定义「何为一次阅读」（如进入阅读/播放达一定比例）。

> ⚠️ **这些维护用的触发器/函数务必 `SECURITY DEFINER`**（并 `set search_path = public`、以表属主/service_role 身份创建）：`books` 对 `authenticated` 无 update 策略，普通调用者权限的触发器去 update `books` 会被 RLS 拒绝——这是后端阶段最易踩的坑。

## 其它口径说明
- **聊天卡片**：`chat_sessions.messages` 里的 recommendations/citations 建议只存 `book_id`(+章序号)，渲染时实时 JOIN books/chapters（避免书名/封面改动后历史卡片陈旧）。
- **踩反馈原因**（推荐偏差/答疑有误/解读没用/其它+自定义文本）：随对应 message 对象一起存进 `chat_sessions.messages`（message 结构里加 feedback_reasons/feedback_text）；若日后要跨用户做 Agent 质量分析，再单建 `chat_feedback` 表。
- **hiddenSamples（隐藏示例会话）**：上线后「对话历史」全是真实会话（无 mock 示例），删除即真删，该前端字段自然失效、无需入库。
- **最近搜索（个人 5 条）**：保持前端本地（`useUI.recentSearches`）；**热门搜索 Top20** 走 `search_logs` 聚合（限定 term 命中现有 books 的 title/author/tags）。
- **学习总时长**：`profiles.read_seconds` 是合并总秒数（满足「我的-总时长」）；如日后要按音视频/文字分项再拆列，当前不需。
- **user 数据 book_id 不外键 books**（解耦/便于迁移）：删书可能留孤儿行，前端/后端关联一律 left join + 兜底；可选后台定期清理。
- **点赞即收藏**：乱翻双击/侧栏「爱心」走 `toggleFav`(写 favorites)，**没有独立"点赞"概念**；收藏人数=`fav_count`。前端 store 的 `likedBooks`/`toggleBookLike` 与 `Book.likes` 是历史冗余、当前未使用，阶段3 接前端时清除。

## 阶段3（后端开发）待办 —— 不影响现在建表
- **乱翻「猜你想读」**：`flip_feed` 表已建；待接 minimax 每天凌晨定时任务为每人生成 50 本（排除已读、在读优先、参考对话/压缩历史偏好）写入；新用户当天无数据回退「最新入库 50 本」。
- **智学 Agent（小涤）**：System Instruction + 5 工具（推荐书目/读书本目录/读章内容/引用章节/联网搜索）+ 上下文压缩（≥500K 压到 10K、留最近20轮，写 `chat_sessions.compressed_history`/`compressed_until`，字段已建）。
- **联网搜索**：先调研 minimax TokenPlan 是否支持，否则火山等。
- **全部大模型调用走 minimax TokenPlan**。
- **按数据量增长再加的索引（当前 19 本/小流量不必加，宁缺毋滥）**：`search_logs(term, created_at desc)`（+必要时启用 `pg_trgm`）；分类按阅读类型的部分索引 `books(category_id, shelved_at desc) where has_text` / `where (has_video or has_audio)`；若「历史对话搜索」改后端再给 `chat_sessions.messages` 加 GIN（默认前端本地搜索，不需）。
