import { ArrowLeftIcon, ArrowUUpLeftIcon, CheckIcon, FilmSlateIcon, FolderOpenIcon, MagnetIcon, MagnifyingGlassIcon, StackIcon, StarIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { lazy, memo, Suspense, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { categoryCounts, categoryOf, library, libraryNews, posterSrc, type Category, type LibraryItem, type NewsItem } from "../api/posters";
import { CategoryFilter } from "../components/CategoryFilter";
import { ErrorState } from "../components/ErrorState";
import { Mark } from "../components/Mark";
import { Dialogs } from "../components/Dialogs";
import { cnNumeral, Strip } from "../components/SeriesPanel";
import { useLibraryScope } from "../hooks/useLibraryScope";
import { useResourceRoot } from "../hooks/useResourceRoot";
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

/** A series' folder of films, folded into one card (哈利·波特/, 指环王/). */
interface Shelf { dir: string; members: LibraryItem[] }

/** Where a film sits: the folder holding its folder (or its file). */
function ownerOf(item: LibraryItem): string {
  return parent(item.file ? parent(item.path) : item.path);
}

const ShelfCard = memo(function ShelfCard({ shelf, index, onOpen }: { shelf: Shelf; index: number; onOpen: (dir: string) => void }) {
  const cover = [...shelf.members].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999))[0];
  return (
    <motion.button type="button" className="tile group/card text-left" onClick={() => onOpen(shelf.dir)}
      initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: Math.min(index, 24) * 0.02 }}>
      <div className="relative aspect-[2/3]">
        {/* A stack of the series' films: two cards behind the first one fan out on hover. */}
        <span className="absolute inset-0 rounded-[12px] bg-surface transition-transform duration-300 ease-[var(--ease-expo)] [transform:translate(6px,-6px)_rotate(3deg)] group-hover/card:[transform:translate(10px,-10px)_rotate(5deg)]"
          style={{ boxShadow: "inset 0 0 0 1px var(--line)" }} />
        <span className="absolute inset-0 rounded-[12px] bg-surface transition-transform duration-300 ease-[var(--ease-expo)] [transform:translate(3px,-3px)_rotate(1.5deg)] group-hover/card:[transform:translate(5px,-5px)_rotate(2.5deg)]"
          style={{ boxShadow: "inset 0 0 0 1px var(--line)" }} />
        <div className="absolute inset-0 overflow-hidden rounded-[12px] bg-surface transition-transform duration-300 ease-[var(--ease-expo)] group-hover/card:-translate-y-1"
          style={{ boxShadow: "inset 0 0 0 1px var(--line), var(--shadow-lift)" }}>
          {cover?.poster
            ? <img src={posterSrc(cover.poster, "w342")} alt="" loading="lazy" decoding="async" className="thumb absolute inset-0 size-full object-cover" />
            : <span className="absolute inset-0 grid place-items-center text-faint"><StackIcon size={32} /></span>}
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md tabular">
            <StackIcon size={11} weight="bold" />{shelf.members.length} 部
          </span>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 px-0.5 text-[13px] font-medium leading-snug" title={shelf.dir}>{basename(shelf.dir)}</p>
      <p className="px-0.5 text-[12px] text-muted tabular">
        {[...new Set(shelf.members.map(member => member.year).filter(Boolean))].sort().filter((_, i, all) => i === 0 || i === all.length - 1).join(" - ")}
      </p>
    </motion.button>
  );
});

const NEWS_DISMISSED = "tgvio-web:news-dismissed";
const newsKey = (item: NewsItem): string => [item.kind, item.id, item.season ?? "", item.episode ?? "", item.date ?? "", item.missing?.length ?? ""].join(":");

function day(date?: string): string {
  if (!date) return "";
  const [, m, d] = date.split("-").map(Number);
  return `${m} 月 ${d} 日`;
}

function newsLine(item: NewsItem): { head: string; tail: string } {
  switch (item.kind) {
    case "season": return { head: `第${cnNumeral(item.season ?? 0)}季已播出`, tail: `${day(item.date)}开播` };
    case "episode": return { head: `第${cnNumeral(item.season ?? 0)}季第 ${item.episode} 集`, tail: `${day(item.date)}更新${item.name && !/^第\s*\d+\s*集$/.test(item.name) ? ` · ${item.name}` : ""}` };
    case "upcoming": return item.season
      ? { head: `第${cnNumeral(item.season)}季即将开播`, tail: day(item.date) }
      : { head: `《${item.name}》即将上映`, tail: day(item.date) };
    case "gap": {
      const list = item.missing ?? [];
      return { head: `还差 ${list.length} 季`, tail: list.slice(0, 4).join("、") + (list.length > 4 ? " 等" : "") };
    }
    default: {
      const list = item.missing ?? [];
      return { head: `系列里还差 ${list.length} 部`, tail: list.slice(0, 2).join("、") + (list.length > 2 ? " 等" : "") };
    }
  }
}

/**
 * 追剧与新片: new seasons and episodes of the series here, films of the
 * series here that are out or coming. Each can be put away (remembered on this device).
 */
function NewsRow({ onOpen }: { onOpen: (dir: string) => void }) {
  const resourceRoot = useResourceRoot();
  const news = useQuery({ queryKey: ["library-news"], queryFn: libraryNews, staleTime: 10 * 60_000, refetchInterval: query => query.state.data?.computing ? 20_000 : false });
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem(NEWS_DISMISSED) ?? "[]") as string[]));
  const items = (news.data?.items ?? []).filter(item => !dismissed.has(newsKey(item)));
  if (!items.length) return null;
  const dismiss = (item: NewsItem): void => {
    const next = new Set(dismissed).add(newsKey(item));
    setDismissed(next);
    localStorage.setItem(NEWS_DISMISSED, JSON.stringify([...next].slice(-400)));
  };
  // Where a download goes: the season's folder, a new season's folder in the series, or the series' folder.
  const find = (item: NewsItem): void => {
    const base = item.dir || resourceRoot.folder;
    if (item.kind === "episode" && item.into) useUi.getState().openDialog({ kind: "resources", query: item.query, base: parent(item.into), folder: basename(item.into) });
    else if (item.kind === "gap" && item.dir && item.seasons?.length) useUi.getState().openDialog({ kind: "resources", query: item.query, base: item.dir, folder: `${item.title} 第${cnNumeral(item.seasons[0])}季` });
    else if (item.season && item.dir) useUi.getState().openDialog({ kind: "resources", query: item.query, base: item.dir, folder: `${item.title} 第${cnNumeral(item.season)}季${item.date ? ` (${item.date.slice(0, 4)})` : ""}` });
    else useUi.getState().openDialog({ kind: "resources", query: item.kind === "missing" ? item.missing?.[0]?.replace(/ \(\d{4}\)$/, "") ?? item.query : item.query, base });
  };
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between px-2 sm:px-0">
        <h2 className="text-[17px] font-semibold tracking-tight">追剧与新片</h2>
        <span className="text-[12px] text-faint tabular">{items.length} 条</span>
      </div>
      <Strip className="-mx-3 flex snap-x scroll-px-3 gap-3 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:-mx-8 sm:scroll-px-8 sm:px-8">
        {items.slice(0, 30).map((item, index) => {
          const line = newsLine(item);
          return (
            <motion.div key={newsKey(item)} className="group/news relative flex w-[min(80vw,320px)] shrink-0 snap-start gap-3 rounded-[14px] bg-surface p-2.5 hairline"
              initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring.soft, delay: Math.min(index, 8) * 0.04 }}>
              <button type="button" className="relative aspect-[2/3] w-[68px] shrink-0 overflow-hidden rounded-[10px] bg-[var(--hover)]" aria-label={`打开「${item.title}」`}
                disabled={!item.dir} onClick={() => item.dir && onOpen(item.dir)}>
                {item.poster ? <img src={posterSrc(item.poster, "w185")} alt="" loading="lazy" className="thumb size-full object-cover" />
                  : <span className="grid size-full place-items-center text-faint"><FilmSlateIcon size={22} /></span>}
              </button>
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate pr-6 text-[13.5px] font-medium">{item.title}</p>
                <p className={`mt-0.5 text-[12.5px] ${item.kind === "season" || item.kind === "episode" ? "text-accent-text" : "text-muted"}`}>{line.head}</p>
                <p className="line-clamp-2 text-[12px] text-faint">{line.tail}</p>
                {resourceRoot.enabled && item.kind !== "upcoming" && (
                  <button className="btn btn-line mt-auto h-8 self-start px-2.5 text-[12.5px]" onClick={() => find(item)}><MagnetIcon size={14} />找资源</button>
                )}
              </div>
              <button aria-label="不再提示" title="不再提示" onClick={() => dismiss(item)}
                className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--hover)] hover:text-ink">
                <XIcon size={13} />
              </button>
            </motion.div>
          );
        })}
      </Strip>
    </section>
  );
}

const GROUP_KEY = "tgvio-web:library-group";

// What the library page was showing (filter, sort, search, an open series,
// where it was scrolled to), kept for this tab: back from a folder or a film,
// it shows the same again.
const VIEW_KEY = "tgvio-web:library-view";
interface LibraryView { search: string; sort: LibrarySort; cat: Category | "all"; shelfDir: string | null; scroll: number }
function savedView(): Partial<LibraryView> {
  try { return JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "{}") as Partial<LibraryView>; } catch { return {}; }
}

// A video opened from the library plays over it (the page stays as it was).
const Viewer = lazy(() => import("../components/Viewer").then(m => ({ default: m.Viewer })));

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
      <Strip className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:-mx-8 sm:px-8">
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
                {art ? <img src={posterSrc(art, owner?.backdrop ? "w780" : "w342")} alt="" loading="lazy" className="thumb size-full object-cover transition-transform duration-700 ease-[var(--ease-expo)] group-hover/cont:scale-105" />
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
      </Strip>
    </section>
  );
}

export default function Library() {
  const [, navigate] = useLocation();
  const blur = usePrefs(state => state.blur);
  const title = useSession(state => state.settings.site_title) || "OpenList";
  const query = useQuery({ queryKey: ["library"], queryFn: library, staleTime: 60_000 });
  const saved = useMemo(savedView, []);
  const [search, setSearch] = useState(saved.search ?? "");
  // Not in the library: look it up on the resource sites, from the folder downloads go to.
  const resourceRoot = useResourceRoot();
  const deferred = useDeferredValue(search.trim());
  const [sort, setSort] = useState<LibrarySort>(saved.sort ?? "recent");
  const [cat, setCat] = useState<Category | "all">(saved.cat ?? "all");
  // Series' folders of films fold into one card; opening one shows its films.
  const scope = useLibraryScope();
  const [grouped, setGrouped] = useState(() => localStorage.getItem(GROUP_KEY) !== "0");
  const [shelfDir, setShelfDir] = useState<string | null>(saved.shelfDir ?? null);
  // Kept as it changes; the scroll position as the page is left.
  const scrollAt = useRef(saved.scroll ?? 0);
  useEffect(() => {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({ search, sort, cat, shelfDir, scroll: scrollAt.current } satisfies LibraryView));
  }, [search, sort, cat, shelfDir]);
  useEffect(() => {
    const onScroll = (): void => { scrollAt.current = window.scrollY; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      const view = savedView();
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({ ...view, scroll: scrollAt.current }));
    };
  }, []);
  const viewerOpen = useUi(state => !!state.viewer);
  const [viewerWanted, setViewerWanted] = useState(viewerOpen);
  if (viewerOpen && !viewerWanted) setViewerWanted(true);
  const all = useMemo(() => query.data?.items ?? [], [query.data]);
  const byPath = useMemo(() => Object.fromEntries(all.map(item => [item.path, item])), [all]);
  const counts = useMemo(() => categoryCounts(all.map(item => item.path), byPath), [all, byPath]);
  const chosen = counts.some(([key]) => key === cat) ? cat : "all";
  const items = useMemo(
    () => sortItems(all.filter(item => (chosen === "all" || categoryOf(item) === chosen) && matches(item, deferred)), sort),
    [all, chosen, deferred, sort],
  );

  // One card per series' folder, where the first of its films would be. Not while searching.
  const view = useMemo((): (LibraryItem | Shelf)[] => {
    if (shelfDir) return items.filter(item => ownerOf(item) === shelfDir);
    if (!grouped || deferred) return items;
    const roots = new Set(scope.paths);
    const counts = new Map<string, number>();
    for (const item of items) counts.set(ownerOf(item), (counts.get(ownerOf(item)) ?? 0) + 1);
    const shelves = new Map<string, Shelf>();
    const out: (LibraryItem | Shelf)[] = [];
    for (const item of items) {
      const dir = ownerOf(item);
      if ((counts.get(dir) ?? 0) < 2 || roots.has(dir) || dir === "/") { out.push(item); continue; }
      const shelf = shelves.get(dir);
      if (shelf) { shelf.members.push(item); continue; }
      const made = { dir, members: [item] };
      shelves.set(dir, made);
      out.push(made);
    }
    return out;
  }, [items, grouped, deferred, shelfDir, scope.paths]);

  useEffect(() => { document.title = `片库 - ${title}`; }, [title]);

  // Back to where it was scrolled, once the cards are there.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !query.data) return;
    restored.current = true;
    if (scrollAt.current > 0) window.scrollTo(0, scrollAt.current);
  }, [query.data]);

  const open = (item: LibraryItem): void => {
    if (!item.file) { navigate(encodePath(item.path)); return; }
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
          {/* Out of the library, back to the files: plain words, the way 管理 does it. */}
          <button className="btn btn-ghost h-9 shrink-0 px-2.5 text-[13.5px] max-sm:px-2" aria-label="返回文件" onClick={() => navigate("/")}>
            <ArrowUUpLeftIcon size={17} /><span className="max-sm:hidden">返回文件</span>
          </button>
          <span className="flex-1" />
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
            <button aria-pressed={grouped} onClick={() => { localStorage.setItem(GROUP_KEY, grouped ? "0" : "1"); setGrouped(!grouped); setShelfDir(null); }}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors touch:h-10 ${grouped ? "bg-accent text-accent-ink" : "text-muted hairline hover:text-ink"}`}
              title="系列的电影合成一张卡片">
              <StackIcon size={14} />按系列
            </button>
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

        {query.data && !deferred && !shelfDir && <NewsRow onOpen={dir => navigate(encodePath(dir))} />}

        {query.data && !deferred && !shelfDir && <ContinueRow items={all} onPlay={path => {
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
            {resourceRoot.enabled && (
              <button className="btn btn-primary mt-4 h-10 px-4" onClick={() => {
                navigate(encodePath(resourceRoot.folder));
                useUi.getState().openDialog({ kind: "resources", query: deferred });
              }}><MagnetIcon size={16} />去资源站找「{deferred}」</button>
            )}
          </div>
        )}
        {shelfDir && (
          <div className="mt-8 flex flex-wrap items-center gap-2 px-2 sm:px-0">
            <button className="btn btn-ghost h-9 px-2.5 text-[13.5px]" onClick={() => setShelfDir(null)}><ArrowLeftIcon size={16} />全部</button>
            <h2 className="min-w-0 truncate text-[17px] font-semibold tracking-tight">{basename(shelfDir)}</h2>
            <span className="text-[13px] text-muted tabular">{view.length} 部</span>
            <span className="flex-1" />
            <button className="btn btn-line h-9 px-3 text-[13px]" onClick={() => navigate(encodePath(shelfDir))}><FolderOpenIcon size={15} />打开文件夹</button>
          </div>
        )}
        {view.length > 0 && (
          <div className={`${shelfDir ? "mt-5" : "mt-8"} grid grid-cols-3 gap-x-2.5 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-5 sm:gap-y-7`}>
            {view.slice(0, 600).map((entry, index) => "members" in entry
              ? <ShelfCard key={entry.dir} shelf={entry} index={index} onOpen={setShelfDir} />
              : <Card key={entry.path} item={entry} index={index} onOpen={open} />)}
          </div>
        )}
        {items.length > 600 && <p className="mt-8 text-center text-[12.5px] text-muted">只显示前 600 部，用搜索或分类缩小范围</p>}
      </main>
      {/* The library is its own page: without this, 找资源 opened a dialog nothing showed. */}
      <Dialogs />
      {viewerWanted && <Suspense fallback={null}><Viewer /></Suspense>}
    </div>
  );
}
