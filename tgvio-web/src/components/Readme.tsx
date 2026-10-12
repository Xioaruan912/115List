import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { proxyUrl } from "../lib/links";
import { join } from "../lib/path";
import type { Obj } from "../lib/types";

const Markdown = lazy(() => import("./Markdown"));

async function text(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(String(response.status));
  return response.text();
}

/** Meta readme text, a readme URL, or a README.md in the folder: first one that exists. */
export function Readme({ dir, readme, items }: { dir: string; readme: string; items: Obj[] }) {
  const file = !readme ? items.find(item => !item.is_dir && /^readme\.md$/i.test(item.name) && item.size < 512 * 1024) : undefined;
  const source = readme && /^https?:\/\//.test(readme.trim()) ? readme.trim() : file ? proxyUrl(join(dir, file.name), file) : "";
  const remote = useQuery({ queryKey: ["readme", source], queryFn: () => text(source), enabled: !!source, staleTime: 60_000, retry: false });
  const content = source ? remote.data ?? "" : readme;
  if (!content.trim()) return null;
  return (
    <section className="mx-auto mt-12 w-full max-w-[1400px] px-5 sm:px-8 enter">
      <div className="rounded-[var(--radius-sheet)] bg-surface px-6 py-5 hairline sm:px-8"><Suspense fallback={null}><Markdown source={content} /></Suspense></div>
    </section>
  );
}
