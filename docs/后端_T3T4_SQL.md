# 后端 SQL · T3.4 热门搜索聚合 + T4.3 头像桶策略 + T4.4 反馈表

> 2026-06-10 由 `node scripts/run-sql.mjs docs/后端_T3T4_SQL.md` 直连执行。
> 全部幂等（重复执行不报错、不产生副作用）。

## 一、T3.4 热门搜索 Top20 聚合 RPC

search_logs 只有「任何人可写」策略、没有读策略（防爬隐私），聚合必须走 `SECURITY DEFINER` RPC。
只返回**仍命中现有馆藏（书名/作者/标签）**的词——书下架后热词自动消失，点出去必有结果。

```sql
create or replace function public.get_hot_searches(p_limit int default 20, p_days int default 30)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(term order by cnt desc, last_at desc), '{}')
  from (
    select btrim(s.term) as term, count(*) as cnt, max(s.created_at) as last_at
    from search_logs s
    where s.created_at > now() - make_interval(days => p_days)
      and btrim(s.term) <> ''
      and exists (
        select 1 from books b
        where b.title ilike '%' || btrim(s.term) || '%'
           or b.author ilike '%' || btrim(s.term) || '%'
           or exists (select 1 from unnest(b.tags) tg where tg ilike '%' || btrim(s.term) || '%')
      )
    group by btrim(s.term)
    order by cnt desc, last_at desc
    limit p_limit
  ) t
$$;

grant execute on function public.get_hot_searches(int, int) to anon, authenticated;
```

## 二、T4.3 avatars 桶访问策略

桶已存在且 public（公开读走 CDN URL）。写/改/删限定**本人目录** `<uid>/...`：

```sql
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='头像公开可读') then
    create policy "头像公开可读" on storage.objects
      for select using (bucket_id = 'avatars');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='本人可传头像') then
    create policy "本人可传头像" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='本人可改头像') then
    create policy "本人可改头像" on storage.objects
      for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='本人可删头像') then
    create policy "本人可删头像" on storage.objects
      for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
```

## 三、T4.4 意见反馈表（只写不读）

普通用户只能写入自己的反馈；没有任何读策略 → 只有管理员（Dashboard / service_role）能看。
注销账号时 `on delete set null` 保留反馈内容（运营资产），仅脱去身份。

```sql
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='feedback' and policyname='本人可写_feedback') then
    create policy "本人可写_feedback" on public.feedback
      for insert to authenticated
      with check (user_id = auth.uid());
  end if;
end $$;
```
