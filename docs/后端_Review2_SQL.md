# 后端 SQL · 自我 Review 轮加固（T3/T4 安全与数据质量）

> 2026-06-10 由 `node scripts/run-sql.mjs docs/后端_Review2_SQL.md` 直连执行。全部幂等。
> 对应审查发现：①get_hot_searches 参数不钳制+ilike 通配符未转义+无阈值 → 匿名 DoS/热榜投毒面
> ②search_logs 无长度上限、无限增长 ③avatars 桶无大小/类型限制。

## 一、get_hot_searches v2（参数钳制 + 通配符免疫 + 大小写归一 + 双人阈值）

- `p_limit/p_days` 钳到 [1,50]/[1,90]：匿名传 `(20, 36500)` 全表聚合的 DoS 面关闭
- `ilike '%term%'` 换 `position(lower(term) in lower(...))`：搜「%」「_」不再命中全库（通配符免疫），顺带英文大小写归一
- `having count(*) >= 2`：单人刷不上热榜（防投毒），也消除「一个人搜过的词全站可见」的残余隐私面

```sql
create or replace function public.get_hot_searches(p_limit int default 20, p_days int default 30)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
  dys int := least(greatest(coalesce(p_days, 30), 1), 90);
  result text[];
begin
  select coalesce(array_agg(term order by cnt desc, last_at desc), '{}') into result
  from (
    select min(btrim(s.term)) as term, count(*) as cnt, max(s.created_at) as last_at
    from search_logs s
    where s.created_at > now() - make_interval(days => dys)
      and btrim(s.term) <> ''
      and char_length(btrim(s.term)) <= 50
      and exists (
        select 1 from books b
        where position(lower(btrim(s.term)) in lower(b.title)) > 0
           or position(lower(btrim(s.term)) in lower(coalesce(b.author, ''))) > 0
           or exists (select 1 from unnest(b.tags) tg where position(lower(btrim(s.term)) in lower(tg)) > 0)
      )
    group by lower(btrim(s.term))
    having count(*) >= 2
    order by cnt desc, last_at desc
    limit lim
  ) t;
  return result;
end $$;

grant execute on function public.get_hot_searches(int, int) to anon, authenticated;
```

## 二、search_logs 长度上限 + 90 天 TTL 清理

前端本就 `slice(0,50)`，库级 check 防绕过前端直插超长串；pg_cron 每天清 90 天前数据（表不再无限增长）。

```sql
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'search_logs_term_len') then
    alter table public.search_logs add constraint search_logs_term_len check (char_length(term) <= 50);
  end if;
end $$;

-- 同名 job 重复 schedule 会自动替换（pg_cron 语义），幂等
select cron.schedule(
  'purge-search-logs',
  '30 20 * * *',  -- UTC 20:30 = 北京 04:30，避开 flip-feed 日更（04:00）
  $$delete from public.search_logs where created_at < now() - interval '90 days'$$
);
```

## 三、avatars 桶上限（2MB · 仅图片）

前端已 canvas 压缩到 ≤512px JPEG（几十 KB），桶级限制防直连 API 绕过前端无限占存储。

```sql
update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'avatars';
```
