import { CheckIcon, FilmSlateIcon, MagnifyingGlassIcon, StarIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { memo, useDeferredValue, useMemo, useSyncExternalStore, useState } from "react";
import { CATEGORY_LABEL, categoryCounts, categoryOf, posterSrc, shareLibrary, type Category, type LibraryItem } from "../api/posters";
import { shareProgressKey } from "../api/share";
import { CategoryFilter } from "./CategoryFilter";
import { ErrorState } from "./ErrorState";
import { Strip } from "./SeriesPanel";
import { formatClock, recentProgress, subscribeProgress, watched } from "../lib/progress";
import { basename } from "../lib/path";
import { spring } from "../lib/motion";

type LibrarySort = "recent" | "rating" | "year" | "title";

/**
 * 片库 of a share: the films and series a share holds, with the same cards,
 * categories and sorting as the signed-in library. A visitor needs no account;
 * every path here is relative to the share, and a video's place is kept in
 * this browser (share progress never goes to an account).
 */

type Props = {
  sid: string;
  code: string;
  /** Called with a share-relative path to open a folder in the file view. */
  onOpenDir: (path: string) => void;
  /** Called with a file's share-relative path to play it. */
  onPlay: (path: string) => void;
};

let tick = 0;
subscribeProgress(() => { tick++; });
const useProgressTick = (): number => useSyncExternalStore(subscribeProgress, () => tick);

/* ---------------------------------------------------------------- card */

const Card = memo(function Card({ sid, item, index, onOpen }: { sid: string; item: LibraryItem; index: number; onOpen: () => void }) {
  useProgressTick();
  const seen = watched(shareProgressKey(sid, item.path));
  return (
    <motion.button type="button" className="tile group/card text-left" onClick={onOpen}
      initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: Math.min(index, 24) * 0.03 }}>
      <div className="hairline relative aspect-[2/3] overflow-hidden rounded-[12px] bg-[var(--hover)] transition-transform duration-300 ease-[var(--ease-expo)] group-hover/card:-translate-y-1"
        style={{ boxShadow: "var(--shadow-lift)" }}>
        {item.poster
          ? <img src={posterSrc(item.poster, "w342")} alt="" loading="lazy" decoding="async" className="thumb absolute inset-0 size-full object-cover" />
          : <span className="absolute inset-0 grid place-items-center text-faint"><FilmSlateIcon size={32} /></span>}
        {seen >= 1 && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 py-0.5 pl-1.5 pr-2 text-[11px] font-medium text-white backdrop-blur-md">
            <CheckIcon size={11} weight="bold" className="text-accent" />已看完
          </span>
        )}
        {item.seasons ? (
          <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md tabular">{item.seasons} 季</span>
        ) : null}
        {seen > 0 && seen < 1 && (
          <span className="absolute inset-x-2 bottom-2 h-[3px] overflow-hidden rounded-full bg-black/45">
            <span className="block h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${seen})` }} />
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 px-0.5 text-[13px] font-medium leading-snug text-ink" title={item.path}>{item.title}</p>
      <p className="flex items-center gap-1.5 px-0.5 text-[12px] text-muted tabular">
        {item.year ? <span>{item.year}</span> : null}
        {item.rating ? <span className="inline-flex items-center gap-0.5"><StarIcon size={10} weight="fill" className="text-accent" />{item.rating.toFixed(1)}</span> : null}
      </p>
    </motion.button>
  );
});

/* -------------------------------------------------------------- library */

export function ShareLibrary({ sid, code, onOpenDir, onPlay }: Props) {
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search);
  const [cat, setCat] = useState<Category | "all">("all");
  const [sort, setSort] = useState<LibrarySort>("recent");
  useProgressTick();

  const query = useQuery({ queryKey: ["share-library", sid, code], queryFn: () => shareLibrary(sid, code), retry: false, staleTime: 60_000 });

  const all = useMemo(() => query.data?.items ?? [], [query.data]);
  const byPath = useMemo(() => Object.fromEntries(all.map(item => [item.path, item])), [all]);
  const counts = useMemo(() => categoryCounts(all.map(item => item.path), byPath), [all, byPath]);
  const chosen = counts.some(([key]) => key === cat) ? cat : "all";
  const items = useMemo(() => {
    const q = deferred.toLowerCase();
    return all
      .filter(item => (chosen === "all" || categoryOf(item) === chosen) && (!q || item.title.toLowerCase().includes(q) || (item.original ?? "").toLowerCase().includes(q) || basename(item.path).toLowerCase().includes(q)))
      .sort((a, b) => {
        if (sort === "rating") return (b.rating ?? 0) - (a.rating ?? 0) || (b.year ?? 0) - (a.year ?? 0);
        if (sort === "year") return (b.year ?? 0) - (a.year ?? 0) || (b.rating ?? 0) - (a.rating ?? 0);
        if (sort === "title") return a.title.localeCompare(b.title, ["zh-CN", "en"], { numeric: true });
        return b.at - a.at;
      });
  }, [all, chosen, deferred, sort]);

  // 继续观看 inside this share: its own keys only, never another account's.
  const prefix = `share:${sid}`;
  const resumable = useMemo(() => {
    const out = recentProgress(200).filter(entry => entry.path.startsWith(prefix));
    return out.slice(0, 12).map(({ path, progress }) => {
      const rel = path.slice(prefix.length);
      let owner: LibraryItem | undefined;
      let depth = -1;
      for (const item of all) {
        for (const place of item.places ?? [item.path]) {
          if ((place === rel || rel.startsWith(place + "/")) && place.length > depth) { owner = item; depth = place.length; }
        }
      }
      return { path: rel, progress, owner };
    });
  }, [all, prefix, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isPending) {
    return (
      <div className="grid grid-cols-3 gap-x-2.5 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-x-5 sm:gap-y-7">
        {Array.from({ length: 12 }, (_, i) => <div key={i} className="aspect-[2/3] animate-pulse rounded-[12px] bg-[var(--hover)]" style={{ animationDelay: `${i * 60}ms` }} />)}
      </div>
    );
  }
  if (query.isError) return <ErrorState className="mx-1" error={query.error} onRetry={() => { void query.refetch(); }} />;
  if (!all.length) {
    return (
      <div className="grid place-items-center py-20 text-center">
        <FilmSlateIcon size={38} className="text-faint" />
        <p className="mt-3 text-[15px] font-medium text-ink">这个分享里还没有配上海报的影视</p>
        <p className="mt-1 max-w-[34ch] text-[13px] text-muted">切成「文件」看看全部内容，或者让分享者先在片库里认一下这些片子。</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="text-[13px] text-muted tabular">
          {deferred || chosen !== "all" ? `${items.length} / ${all.length} 部` : `${all.length} 部`}
        </p>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-3">
          {counts.length > 1 && <CategoryFilter path={`share-${sid}`} counts={counts} total={all.length} value={chosen} onChange={setCat} />}
          <div className="flex items-center gap-1 text-[13px]" role="group" aria-label="排序">
            {([["recent", "最近添加"], ["rating", "评分"], ["year", "年份"], ["title", "名称"]] as [LibrarySort, string][]).map(([key, label]) => (
              <button key={key} aria-pressed={sort === key} onClick={() => setSort(key)}
                className={`relative h-8 rounded-lg px-2.5 transition-colors ${sort === key ? "text-ink" : "text-muted hover:text-ink"}`}>
                {sort === key && <motion.span layoutId="share-library-sort" className="absolute inset-0 rounded-lg bg-[var(--hover)]" transition={spring.snappy} />}
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>
          <label className="flex h-9 w-full max-w-[220px] items-center gap-2 rounded-[11px] bg-surface px-3 text-muted hairline focus-within:text-ink">
            <MagnifyingGlassIcon size={15} className="shrink-0" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜片名" aria-label="搜索片库"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint" />
            {search && <button aria-label="清空" onClick={() => setSearch("")} className="text-faint hover:text-ink"><XIcon size={13} /></button>}
          </label>
        </div>
      </div>

      {resumable.length > 0 && (
        <section className="mb-7">
          <h2 className="mb-3 px-1 text-[15px] font-semibold text-ink">继续观看</h2>
          <Strip className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none]">
            {resumable.map(({ path, progress, owner }) => (
              <button key={path} onClick={() => onPlay(path)}
                className="hairline group/row flex w-[min(78vw,300px)] shrink-0 snap-start items-center gap-3 rounded-[14px] bg-[var(--hover)] p-2 text-left">
                <span className="relative aspect-[2/3] w-[54px] shrink-0 overflow-hidden rounded-[9px] bg-[var(--hover)]">
                  {owner?.poster
                    ? <img src={posterSrc(owner.poster, "w185")} alt="" loading="lazy" className="size-full object-cover" />
                    : <span className="grid size-full place-items-center text-faint"><FilmSlateIcon size={18} /></span>}
                  <span className="absolute inset-x-1 bottom-1 h-[3px] overflow-hidden rounded-full bg-black/50">
                    <span className="block h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${progress.duration ? progress.time / progress.duration : 0})` }} />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{owner?.title ?? basename(path)}</span>
                  <span className="block truncate text-[12px] text-muted tabular">看到 {formatClock(progress.time)}</span>
                </span>
              </button>
            ))}
          </Strip>
        </section>
      )}

      {items.length ? (
        <div className="grid grid-cols-3 gap-x-2.5 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-x-5 sm:gap-y-7">
          {items.slice(0, 600).map((item, index) => (
            <Card key={item.path} sid={sid} item={item} index={index} onOpen={() => onOpenDir(item.path)} />
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-[13.5px] text-muted">片库里没有「{deferred || CATEGORY_LABEL[chosen as Category]}」</p>
      )}
    </div>
  );
}
