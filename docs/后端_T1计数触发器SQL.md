# T1 计数维护 SQL（触发器 / RPC / 定时任务）

> 用途：让 books 上「存但不展示」的计数列变真（fav_count / rating / review_count / readers / read_count），以及 reviews.likes 聚合。
> 用法：**整段复制**下方 SQL，贴到 Supabase Dashboard → SQL Editor → Run。幂等可重复执行。
> 约定：全部函数 `SECURITY DEFINER` + `set search_path = public`（防 books 的 RLS 拦截 + 防搜索路径劫持）。
> 「一次阅读」口径（T1.5）：**单次会话内某书真实阅读/播放累计 ≥30 秒记 1 次**，同一人多次进入多次累加（不去重），游客也计入；前端通过 RPC `increment_read_count` 上报。

```sql
-- ============================================================
-- T1 计数维护（整段执行，幂等）
-- ============================================================

-- ---------- 1. fav_count：收藏人数（点赞=收藏） ----------
-- favorites 增删后重算该书收藏数（重算式而非加减式：自愈、不怕漏事件）
create or replace function public.sync_book_fav_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bid text := coalesce(new.book_id, old.book_id);
begin
  update public.books b
     set fav_count = (select count(*) from public.favorites f where f.book_id = bid)
   where b.id = bid;
  return null; -- AFTER 触发器返回值被忽略
end;
$$;

drop trigger if exists trg_favorites_fav_count on public.favorites;
create trigger trg_favorites_fav_count
  after insert or delete on public.favorites
  for each row execute function public.sync_book_fav_count();

-- ---------- 2. rating + review_count：书评均分(1位小数) + 条数 ----------
create or replace function public.recalc_book_review_stats(bid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if bid is null then return; end if;
  update public.books b
     set review_count = s.cnt,
         rating       = s.avg_rating
    from (
      select count(*)::int as cnt,
             coalesce(round(avg(r.rating), 1), 0) as avg_rating
        from public.reviews r
       where r.book_id = bid
    ) s
   where b.id = bid;
end;
$$;

create or replace function public.sync_book_review_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bid_new text;
  bid_old text;
begin
  if tg_op in ('INSERT','UPDATE') then bid_new := new.book_id; end if;
  if tg_op in ('UPDATE','DELETE') then bid_old := old.book_id; end if;
  perform public.recalc_book_review_stats(bid_new);
  if bid_old is distinct from bid_new then
    perform public.recalc_book_review_stats(bid_old);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_reviews_book_stats on public.reviews;
create trigger trg_reviews_book_stats
  after insert or update or delete on public.reviews
  for each row execute function public.sync_book_review_stats();

-- ---------- 3. reviews.likes：书评点赞数聚合 ----------
-- 注：点赞会触发 reviews 的 set_updated_at（updated_at 变动）。本版点赞不前端生效、
--     前端展示用 created_at，无影响，不为此复杂化。
create or replace function public.sync_review_likes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid := coalesce(new.review_id, old.review_id);
begin
  update public.reviews r
     set likes = (select count(*) from public.review_likes l where l.review_id = rid)
   where r.id = rid;
  return null;
end;
$$;

drop trigger if exists trg_review_likes_count on public.review_likes;
create trigger trg_review_likes_count
  after insert or delete on public.review_likes
  for each row execute function public.sync_review_likes();

-- ---------- 4. readers：在读+读完人数（每日定时重算） ----------
-- readers = 该书在 reading_history / text_progress / media_progress 出现的 distinct user 数
create or replace function public.refresh_books_readers()
returns void
language sql
security definer
set search_path = public
as $$
  update public.books b
     set readers = (
       select count(*) from (
         select user_id from public.reading_history h where h.book_id = b.id
         union
         select user_id from public.text_progress  t where t.book_id = b.id
         union
         select user_id from public.media_progress m where m.book_id = b.id
       ) u
     );
$$;

-- 启用 pg_cron（若报权限错：Dashboard → Database → Extensions 搜 pg_cron 手动启用后，重跑本段）
create extension if not exists pg_cron;

-- 每天 19:30 UTC（北京时间次日 03:30）重算；同名 job 重复执行会覆盖更新，幂等
select cron.schedule('refresh-books-readers', '30 19 * * *', $$select public.refresh_books_readers()$$);

-- ---------- 5. read_count：阅读次数 RPC（不去重，游客也计入） ----------
create or replace function public.increment_read_count(p_book_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.books set read_count = read_count + 1 where id = p_book_id;
$$;

revoke all on function public.increment_read_count(text) from public;
grant execute on function public.increment_read_count(text) to anon, authenticated, service_role;

-- ---------- 6. 一次性回填存量数据（触发器只管以后，这里把现有数据算齐） ----------
update public.books b set
  fav_count    = (select count(*) from public.favorites f where f.book_id = b.id),
  review_count = (select count(*) from public.reviews r where r.book_id = b.id),
  rating       = coalesce((select round(avg(r.rating), 1) from public.reviews r where r.book_id = b.id), 0);

update public.reviews r
   set likes = (select count(*) from public.review_likes l where l.review_id = r.id);

select public.refresh_books_readers();
```

## 执行后的核对查询（贴 SQL Editor 单独跑）

```sql
-- ① 各书计数现状
select id, title, fav_count, review_count, rating, readers, read_count
  from public.books order by id;

-- ② 定时任务已挂上（应有一行 refresh-books-readers）
select jobid, jobname, schedule, command from cron.job;
```

## 联动验收（在 APP 里操作 → 回来查 ①）

| 操作 | 预期变化 |
| --- | --- |
| 收藏一本书 / 取消收藏 | 该书 `fav_count` +1 / -1 |
| 写一条书评（如 4.5 星） | `review_count` +1，`rating` = 均分(1位小数) |
| 更新书评改星级 / 删除书评 | `rating`、`review_count` 同步变 |
| 阅读器读满 30 秒 或 视频/音频真实播放满 30 秒 | 该书 `read_count` +1（划走/秒退不计） |
| 手动跑 `select public.refresh_books_readers();` | 读过/播过该书的人数回填进 `readers` |
