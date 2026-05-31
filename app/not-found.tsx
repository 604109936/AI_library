import Link from "next/link";
import { BookX } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-8 text-center">
      <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-celadon-soft dark:bg-celadon/15">
        <BookX className="text-celadon" size={40} strokeWidth={1.4} />
      </div>
      <p className="font-serif text-2xl text-ink dark:text-dark-text">书架上没有这一页</p>
      <p className="mt-2 text-sm text-ink-500 dark:text-dark-text/60">你要找的内容可能已被移走，或链接有误</p>
      <Link
        href="/library"
        className="mt-6 rounded-full bg-celadon px-6 py-2.5 text-sm text-snow shadow-celadon transition active:scale-95"
      >
        回到泡馆
      </Link>
    </main>
  );
}
