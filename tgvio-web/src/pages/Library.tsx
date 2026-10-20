import { ArrowUUpLeftIcon, CheckIcon, FilmSlateIcon, MagnetIcon, MagnifyingGlassIcon, StarIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { memo, useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { categoryCounts, categoryOf, library, posterSrc, type Category, type LibraryItem } from "../api/posters";
import { resources } from "../api/resources";
import { CategoryFilter } from "../components/CategoryFilter";
import { ErrorState } from "../components/ErrorState";
import { Mark } from "../components/Mark";
import { ResourceFinder } from "../components/ResourceFinder";
import { fromList, type Magnet } from "../lib/magnets";
import { spring } from "../lib/motion";
import { basename, encodePath, parent } from "../lib/path";
import { clearProgress, formatClock, recentProgress, subscribeProgress, watched } from "../lib/progress";
import { useToasts } from "../stores/toast";
import { usePrefs } from "../stores/prefs";
import { useSession } from "../stores/session";
import { useUi } from "../stores/ui";

/**
 * 片库: every film and series TMDB recognised, from all folders at once, read
 * from the poster store (no drive request). Search by title, narrow by
 * category, sort by when it arrived, rating, year or name; a folder opens in
 * the browser, a video file opens in the player.
 */

type LibrarySort = "recent" | "rating" | "year" | "title";
const SORTS: [LibrarySort, string][] = [["recent", "最近添加"], ["rating", "评分"], ["year", "年份"], ["title", "名称"]];
const collator = new Intl.Collator(["zh-CN", "en"], { numeric: true, sensitivity: "base" });

function sortItems(items: LibraryItem[], key: LibrarySort): LibraryItem[] {
  const out = [...items];
  if (key === "rating") out.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.year ?? 0) - (a.year ?? 0));
  else if (key === "year") out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.rating ?? 0) - (a.rating ?? 0));
  else if (key === "title") out.sort((a, b) => collator.compare(a.title, b.title));
  else out.sort((a, b) => b.at - a.at);
  return out;
}

function matches(item: LibraryItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return item.title.toLowerCase().includes(q) || (item.original ?? "").toLowerCase().includes(q) || basename(item.path).toLowerCase().includes(q);
}

function useProgressTick(): number {
  return useSyncExternalStore(subscribeProgress, () => tick);
}
let tick = 0;
subscribeProgress(() => { tick++; });

const Card = memo(function Card({ item, index, onOpen }: { item: LibraryItem; index: number; onOpen: (item: LibraryItem, element: HTMLElement) => void }) {
  useProgressTick();
  const seen = item.file ? watched(item.path) : 0;
  return (
    <motion.button type="button" className="tile group/card text-left" onClick={event => onOpen(item, event.currentTarget)}
      initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: Math.min(index, 24) * 0.02 }}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-[12px] bg-surface transition-transform duration-300 ease-[var(--ease-expo)] group-hover/card:-translate-y-1"
        style={{ boxShadow: "inset 0 0 0 1px var(--line), var(--shadow-lift)" }}>
        {item.poster
          ? <img src={posterSrc(item.poster, "w342")} alt="" loading="lazy" decoding="async" className="thumb absolute inset-0 size-full object-cover" />
          : <span className="absolute inset-0 grid place-items-center text-faint"><FilmSlateIcon size={32} /></span>}
        {seen >= 1 && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 py-0.5 pl-1.5 pr-2 text-[11px] font-medium text-white backdrop-blur-md">
            <CheckIcon size={11} weight="bold" className="text-accent" />已看完
          </span>
        )}
        {item.seasons ? (
          <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md tabular">{item.seasons} 季</span>
        ) : null}
        {seen > 0 && seen < 1 && (
          <span className="absolute inset-x-2 bottom-2 h-[3px] overflow-hidden rounded-full bg-black/40">
            <span className="block h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${seen})` }} />
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 px-0.5 text-[13px] font-medium leading-snug" title={item.path}>{item.title}</p>
      <p className="flex items-center gap-1.5 px-0.5 text-[12px] text-muted tabular">
        {item.year ? <span>{item.year}</span> : null}
        {item.rating ? <span className="inline-flex items-center gap-0.5"><StarIcon size={10} weight="fill" className="text-accent-text" />{item.rating.toFixed(1)}</span> : null}
      </p>
    </motion.button>
  );
});

const EPISODE = /S(\d{1,2})\s*E(\d{1,4})/i;

/**
 * 继续观看 across every folder: the videos started and not finished (on any
 * device, the progress is synced), each under its film's or series' art.
 */
function ContinueRow({ items, onPlay }: { items: LibraryItem[]; onPlay: (path: string) => void }) {
  useProgressTick();
  const rows = recentProgress(16).map(({ path, progress }) => {
    // The film itself, or the series whose folder holds the episode.
    let owner: LibraryItem | undefined;
    let depth = -1;
    for (const item of items) {
      for (const place of item.places ?? [item.path]) {
        if ((place === path || path.startsWith(place + "/")) && place.length > depth) { owner = item; depth = place.length; }
      }
    }
    const match = EPISODE.exec(basename(path));
    return { path, progress, owner, episode: match ? `S${match[1].padStart(2, "0")}E${match[2].padStart(2, "0")}` : "" };
  });
  if (!rows.length) return null;
  const clear = (paths: string[], title: string): void => {
    const undo = clearProgress(paths);
    useToasts.getState().push({ tone: "info", title, action: { label: "撤销", run: undo } }, 6000);
  };
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between px-2 sm:px-0">
        <h2 className="text-[17px] font-semibold tracking-tight">继续观看</h2>
        <button className="rounded-lg px-2.5 py-1 text-[13px] text-muted hover:bg-[var(--hover)] hover:text-ink" onClick={() => clear(rows.map(row => row.path), "已清空继续观看")}>清空</button>
      </div>
      <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:-mx-8 sm:px-8">
        {rows.map(({ path, progress, owner, episode }, index) => {
          const art = owner?.backdrop || owner?.poster;
          return (
            <motion.div key={path} role="button" tabIndex={0} className="tile group/cont relative w-[min(72vw,300px)] shrink-0 cursor-pointer snap-start text-left" onClick={() => onPlay(path)}
              onKeyDown={event => { if (event.key === "Enter") onPlay(path); }}
              initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring.soft, delay: index * 0.04 }}>
              <button aria-label="从继续观看里移除" title="移除"
                className="absolute right-2 top-2 z-[1] grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-md transition-opacity hover:bg-black/75 group-hover/cont:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                onClick={event => { event.stopPropagation(); clear([path], `已移除「${owner?.title ?? basename(path)}」`); }}>
                <XIcon size={13} weight="bold" />
              </button>
              <div className="relative aspect-video overflow-hidden rounded-[12px] bg-surface" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
                {art ? <img src={posterSrc(art, owner?.backdrop ? undefined : "w342")} alt="" loading="lazy" className="thumb size-full object-cover transition-transform duration-700 ease-[var(--ease-expo)] group-hover/cont:scale-105" />
                  : <span className="grid size-full place-items-center text-faint"><FilmSlateIcon size={28} /></span>}
                <span className="absolute inset-x-0 bottom-0 h-1 bg-black/45">
                  <span className="block h-full origin-left bg-accent" style={{ transform: `scaleX(${Math.min(1, progress.time / progress.duration)})` }} />
                </span>
              </div>
              <p className="mt-2 truncate text-[13px] font-medium">{owner?.title ?? basename(path)}{episode && <span className="ml-1.5 font-mono text-[12px] text-muted">{episode}</span>}</p>
              <p className="text-[12px] text-muted tabular">还剩 {formatClock(progress.duration - progress.time)}</p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

export default function Library() {
  const [, navigate] = useLocation();
  const blur = usePrefs(state => state.blur);
  const title = useSession(state => state.settings.site_title) || "OpenList";
  const query = useQuery({ queryKey: ["library"], queryFn: library, staleTime: 60_000 });
  const [search, setSearch] = useState("");
  // 找资源: on when the admin set up resource sites. A bookmarklet on a site
  // page comes back here with its magnets in the address's #resources=.
  const sites = useQuery({ queryKey: ["resources"], queryFn: resources.list, staleTime: 5 * 60_000, retry: false });
  const [finder, setFinder] = useState<{ query: string; items?: Magnet[] } | null>(null);
  useEffect(() => {
    const raw = /^#resources=(.+)$/.exec(location.hash)?.[1];
    if (!raw) return;
    history.replaceState(null, "", location.pathname + location.search);
    try { setFinder({ query: "", items: fromList(JSON.parse(decodeURIComponent(raw)) as { u: string; t?: string; x?: string }[]) }); }
    catch { /* not ours */ }
  }, []);
  const deferred = useDeferredValue(search.trim());
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [cat, setCat] = useState<Category | "all">("all");
  const all = useMemo(() => query.data?.items ?? [], [query.data]);
  const byPath = useMemo(() => Object.fromEntries(all.map(item => [item.path, item])), [all]);
  const counts = useMemo(() => categoryCounts(all.map(item => item.path), byPath), [all, byPath]);
  const chosen = counts.some(([key]) => key === cat) ? cat : "all";
  const items = useMemo(
    () => sortItems(all.filter(item => (chosen === "all" || categoryOf(item) === chosen) && matches(item, deferred)), sort),
    [all, chosen, deferred, sort],
  );

  useEffect(() => { document.title = `片库 - ${title}`; }, [title]);

  const open = (item: LibraryItem): void => {
    if (!item.file) { navigate(encodePath(item.path)); return; }
    navigate(encodePath(parent(item.path)));
    useUi.getState().openViewer(parent(item.path), basename(item.path), null);
  };

  return (
    <div className={`min-h-dvh ${blur ? "cover-blur" : ""}`}>
      <header className="sticky top-0 z-20 pt-[env(safe-area-inset-top)]">
        <div className="absolute inset-0 -bottom-6 bg-gradient-to-b from-bg via-bg/85 to-transparent" />
        <div className="relative mx-auto flex h-[60px] max-w-[1400px] items-center gap-2 px-3 sm:gap-3 sm:px-8">
          <button className="shrink-0 transition-transform hover:rotate-[-8deg] active:scale-90 max-sm:hidden" aria-label={title} onClick={() => navigate("/")}>
            <Mark className="size-8 text-[16px]" />
          </button>
          <button className="icon-btn sm:hidden" aria-label="返回文件" onClick={() => navigate("/")}><ArrowUUpLeftIcon size={18} /></button>
          <span className="flex-1" />
          {sites.data?.enabled && (
            <button className="btn btn-line h-9 shrink-0 px-3 text-[13px]" aria-label="找资源" onClick={() => setFinder({ query: search.trim() })}>
              <MagnetIcon size={15} /><span className="max-sm:hidden">找资源</span>
            </button>
          )}
          <label className="flex h-9 w-full max-w-72 items-center gap-2 rounded-[11px] bg-surface px-3 text-muted hairline focus-within:text-ink">
            <MagnifyingGlassIcon size={16} className="shrink-0" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜片名、原名" aria-label="搜索片库"
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint" />
            {search && <button aria-label="清空" onClick={() => setSearch("")} className="text-faint hover:text-ink"><XIcon size={14} /></button>}
          </label>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-3 pb-24 pt-6 sm:px-8 sm:pt-10" data-poster-blur={query.data?.blur ? "" : undefined}>
        <h1 className="px-2 text-[clamp(30px,5.4vw,56px)] font-semibold leading-[1.06] tracking-[-0.04em] sm:px-0">片库</h1>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-2 sm:px-0">
          <p className="text-[13px] text-muted tabular">
            {query.data ? (deferred || chosen !== "all" ? `${items.length} / ${all.length} 部` : `${all.length} 部`) : " "}
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            {counts.length > 1 && <CategoryFilter path="library" counts={counts} total={all.length} value={chosen} onChange={setCat} />}
            <div className="flex items-center gap-1 text-[13px]" role="group" aria-label="排序">
              {SORTS.map(([key, label]) => (
                <button key={key} aria-pressed={sort === key} onClick={() => setSort(key)}
                  className={`relative h-8 rounded-lg px-2.5 transition-colors ${sort === key ? "text-ink" : "text-muted hover:text-ink"}`}>
                  {sort === key && <motion.span layoutId="library-sort" className="absolute inset-0 rounded-lg bg-[var(--hover)]" transition={spring.snappy} />}
                  <span className="relative">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {query.data && !deferred && <ContinueRow items={all} onPlay={path => {
          navigate(encodePath(parent(path)));
          useUi.getState().openViewer(parent(path), basename(path), null);
        }} />}

        {query.isPending && (
          <div className="mt-8 grid grid-cols-3 gap-x-2.5 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-5 sm:gap-y-7">
            {Array.from({ length: 12 }, (_, i) => <div key={i} className="skeleton aspect-[2/3] rounded-[12px]" style={{ opacity: 1 - i * 0.06 }} />)}
          </div>
        )}
        {query.isError && <ErrorState className="mt-10" error={query.error} onRetry={() => query.refetch()} />}
        {query.data && !all.length && (
          <div className="grid place-items-center py-24 text-center">
            <FilmSlateIcon size={40} className="text-faint" />
            <p className="mt-3 text-[15px] font-medium">片库还是空的</p>
            <p className="mt-1 max-w-[36ch] text-[13px] text-muted">打开放着电影、剧集的文件夹，配上 TMDB 海报后，它们就会出现在这里。</p>
          </div>
        )}
        {query.data && all.length > 0 && !items.length && (
          <div className="py-20 text-center">
            <p className="text-[13.5px] text-muted">片库里没有「{deferred}」</p>
            {sites.data?.enabled && (
              <button className="btn btn-primary mt-4 h-10 px-4" onClick={() => setFinder({ query: deferred })}><MagnetIcon size={16} />去资源站找「{deferred}」</button>
            )}
          </div>
        )}
        {items.length > 0 && (
          <div className="mt-8 grid grid-cols-3 gap-x-2.5 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-5 sm:gap-y-7">
            {items.slice(0, 600).map((item, index) => <Card key={item.path} item={item} index={index} onOpen={open} />)}
          </div>
        )}
        {items.length > 600 && <p className="mt-8 text-center text-[12.5px] text-muted">只显示前 600 部，用搜索或分类缩小范围</p>}
      </main>
      {finder && <ResourceFinder initialQuery={finder.query} initialItems={finder.items} onClose={() => setFinder(null)} />}
    </div>
  );
}
