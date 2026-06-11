# T7 · user_memory 用户长期记忆表（2026-06-11，run-sql.mjs 已直连执行）

> 每用户一行，字段即记忆维度；服务端 M3 异步增量更新（lib/server/memory.ts），注入智学 system 变量⑦。
> RLS：仅本人可读；写入只走 service_role（不开任何写策略 + revoke 写权限双防线）。

```sql
create table if not exists public.user_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  identity text not null default '',        -- 身份画像（职业/身份/人生阶段）
  reading_pref text not null default '',    -- 阅读偏好（题材/深浅/节奏/读法）
  interests text not null default '',       -- 兴趣主题
  chat_style text not null default '',      -- 聊天风格偏好
  facts text not null default '',           -- 重要个人事实
  recent_focus text not null default '',    -- 近期关注
  follow_ups text not null default '',      -- 待跟进事项
  processed_until integer not null default 0, -- 已消化到 main 会话（请求口径）第几条消息
  updated_at timestamptz not null default now()
);
alter table public.user_memory enable row level security;
create policy "本人可读_user_memory" on public.user_memory for select to authenticated using (user_id = auth.uid());
revoke all on public.user_memory from anon, authenticated;
grant select on public.user_memory to authenticated;
```

## 机制要点（决策记录）

- **触发时机**：每轮回复完成后 route.ts afterAnswer 经 `waitUntil` 托管 fire-and-forget（Vercel serverless 响应关闭后实例冻结，纯 fire-and-forget 永远跑不完——与压缩器同方案）；攒够 4 条新消息（processed_until 进度）才真正调模型，客户端零感知（实测有/无记忆 TTFB 差 <1s）。
- **更新方式**：M3 对照「7 维记忆现值 + 新对话」输出需更新维度的 JSON（增量合并后的完整新值，保留仍成立的、并入新的、删除被推翻的）。
- **防膨胀**：模型限每维度 ≤120 字提炼；写库前硬截 300 字。
- **注入**：buildSystem 变量⑦「你对这位读者的长期了解」+「自然体现绝不复述清单」指令。
- 验收 7/7 见 docs/delivery/evidence/T7/（落表前后对比 / 清史后跨历史认知样本 / TTFB / RLS 双断言）。
