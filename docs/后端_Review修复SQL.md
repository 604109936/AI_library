# Review 修复 SQL（多设备防回退合并 + 时长增量 RPC）

> 来源：2026-06-12 全面 Review 第三路（数据与同步层）P1-4/P1-5。
> 用法：**整段复制**贴 Supabase SQL Editor → Run。幂等可重复执行。
> 作用：①`media_progress.played` / `text_progress.read_chapter_ids·pct` 在服务端合并（旧设备的陈旧快照不再回退新进度）②学习时长改增量累加（多设备并行阅读不再互相覆盖丢时长，前端已切换调用 `add_read_seconds`，**不执行本 SQL 时长会同步失败**）。

```sql
-- ============================================================
-- ① 学习时长：增量累加 RPC（取代前端绝对值覆盖）
-- ============================================================
create or replace function public.add_read_seconds(p_delta int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set read_seconds = read_seconds + greatest(0, p_delta)
   where id = auth.uid();
$$;

revoke all on function public.add_read_seconds(int) from public;
grant execute on function public.add_read_seconds(int) to authenticated;

-- ============================================================
-- ② media_progress：played 只增（多设备防回退；position=最后位置，覆盖语义正确不合并）
-- ============================================================
create or replace function public.merge_media_progress()
returns trigger
language plpgsql
as $$
begin
  new.played := greatest(new.played, old.played);
  return new;
end;
$$;

drop trigger if exists trg_media_progress_merge on public.media_progress;
create trigger trg_media_progress_merge
  before update on public.media_progress
  for each row execute function public.merge_media_progress();

-- ============================================================
-- ③ text_progress：read_chapter_ids 取并集、pct 只增（旧设备快照不再抹掉已读章）
--    注意：运维想"清零"时需先 delete 该行再让前端重建（直接 update 清空会被本触发器合并回去），
--    或临时 alter table public.text_progress disable trigger trg_text_progress_merge。
-- ============================================================
create or replace function public.merge_text_progress()
returns trigger
language plpgsql
as $$
begin
  new.read_chapter_ids := (
    select coalesce(array_agg(distinct x), '{}')
      from unnest(coalesce(old.read_chapter_ids, '{}') || coalesce(new.read_chapter_ids, '{}')) as x
  );
  new.pct := greatest(new.pct, old.pct);
  return new;
end;
$$;

drop trigger if exists trg_text_progress_merge on public.text_progress;
create trigger trg_text_progress_merge
  before update on public.text_progress
  for each row execute function public.merge_text_progress();
```

## 执行后核对（单独跑）

```sql
select proname from pg_proc where proname = 'add_read_seconds';                       -- 应 1 行
select tgname from pg_trigger where tgname like 'trg_%_merge';                       -- 应 2 行
```

## 配套前端改动（已完成，commit 见 git log）

- `addReadSeconds` → 调 `add_read_seconds` RPC 传增量
- 写穿透全部加 hydrated 门禁（load 完成前不写云端）
- 阅读器续读等 hydrated；onAuthStateChange 补 load；对话会话按 ownerUid 防串号
