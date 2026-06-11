# T1 上半场 · 数据库安全收紧 SQL（2026-06-11）

> 背景：RLS 行级策略本身扎实（四路审查实测确认），但**表级授权面比文档声明宽一大圈**——
> anon/authenticated 实际持有全部表的 ALL 权限（Supabase 默认授权未回收），安全完全依赖 RLS 单防线。
> 本批 SQL 把授权面收到「实际需要」，建立纵深：未来任何一次误关 RLS / 新表漏配策略，不再立即变成全表可写。
>
> 本批**不改任何表数据**（仅权限/策略/函数/约束），无需数据备份；执行前现状已留底
> docs/delivery/evidence/T1/（grants 全量 ALL 的实测、search_logs with check 'true'、handle_new_user 旧定义）。
> 执行方式：node scripts/run-sql.mjs docs/后端_T1安全收紧SQL.md 不支持 md——逐段用 -e 执行（见文末记录）。

## ① 表级写权限收紧（修复：anon/authenticated 持有 ALL）

```sql
-- 1a. 公开只读表：两角色一律收掉全部写
revoke insert, update, delete, truncate, references, trigger
  on public.books, public.categories, public.chapters, public.flip_feed
  from anon, authenticated;

-- 1b. 用户数据表：authenticated 保留 DML（RLS 限行），收掉 DDL 级危险权限
revoke truncate, references, trigger
  on public.profiles, public.favorites, public.notes, public.reviews, public.reading_history,
     public.text_progress, public.media_progress, public.review_likes, public.chat_sessions,
     public.search_logs, public.feedback
  from anon, authenticated;

-- 1c. anon：用户数据表全部写权限收掉，仅保留 search_logs 的 INSERT（游客搜索上报是产品口径）
revoke insert, update, delete
  on public.profiles, public.favorites, public.notes, public.reviews, public.reading_history,
     public.text_progress, public.media_progress, public.review_likes, public.chat_sessions,
     public.feedback
  from anon;
revoke update, delete on public.search_logs from anon, authenticated;

-- 1d. 修正默认授权：未来新表只自动授 SELECT（写权限按需手工授予）
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public grant select on tables to anon, authenticated;
```

## ② 函数执行权收紧（修复：维护函数 PUBLIC 可执行）

```sql
-- 维护型函数仅 service_role 可调（cron/服务端用）：堵「anon key 反复触发全表重算」的 DoS 放大面
revoke execute on function public.refresh_books_readers() from public, anon, authenticated;
revoke execute on function public.recalc_book_review_stats(text) from public, anon, authenticated;
-- 学习时长只增 RPC：仅登录用户（文档本就声明 authenticated-only，实测 anon 残留 EXECUTE）
revoke execute on function public.add_read_seconds(integer) from public, anon;
-- 保留：get_hot_searches（搜索页直调）、increment_read_count（游客也计阅读量是产品口径，
-- 刷量风险接受——read_count 仅展示用，不涉权限/资金；记入决策记录）
```

## ③ search_logs 防伪造（修复：with check 'true' 可插任意 user_id）

```sql
alter policy "任何人可写_search_logs" on public.search_logs
  with check (user_id is null or user_id = auth.uid());
```

## ④ profiles 列级保护 + 长度约束（修复：可直改 read_seconds/account；无长度上限）

```sql
-- read_seconds 只能走 add_read_seconds RPC（只增）；account 是注册口径不可改
revoke update on public.profiles from authenticated;
grant update (nickname, bio, avatar_seed, avatar_url) on public.profiles to authenticated;
-- 长度护栏（前端限 16/30 字，约束给余量防直连滥用；现有数据 max 4/0 字，安全）
alter table public.profiles add constraint profiles_nickname_len check (char_length(nickname) <= 40);
alter table public.profiles add constraint profiles_bio_len check (bio is null or char_length(bio) <= 200);
```

## ⑤ handle_new_user 读注册昵称（修复：邮箱确认开启时昵称静默丢失）

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, nickname, account)
  values (
    new.id,
    coalesce(
      nullif(left(coalesce(new.raw_user_meta_data->>'nickname', ''), 40), ''),  -- 注册填的昵称（随 signUp metadata 传入）
      nullif(split_part(new.email, '@', 1), ''),                                 -- 兜底：邮箱前缀
      '书友'
    ),
    new.email
  )
  on conflict (id) do nothing;   -- 已存在则跳过，保证幂等
  return new;
end;
$function$;
```

## 执行与验证记录

- 执行：2026-06-11，scripts/run-sql.mjs 直连逐段执行，全部成功
- 验证（执行后实测）：
  - role_table_grants：anon 对用户数据表无写权限、authenticated 无 TRUNCATE/REFERENCES/TRIGGER ✅
  - 维护函数 ACL 仅 service_role/postgres ✅
  - search_logs 伪造他人 uid 插入被拒（42501）✅
  - profiles 直改 read_seconds 被拒（42501）、改 nickname 正常 ✅
  - 注册新用户带 metadata nickname → profiles.nickname 正确写入 ✅
  - 全套 E2E 回归（登录/收藏/笔记/进度/聊天）✅
