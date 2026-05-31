import { EmptyState } from "@/components/ui/States";

// 全局 404：无效路由兜底，提供返回泡馆入口。
export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center">
      <EmptyState
        icon="search"
        title="页面走丢了"
        subtitle="这个地址似乎不存在或已下架"
        actionText="返回泡馆"
        actionHref="/library"
      />
    </main>
  );
}
