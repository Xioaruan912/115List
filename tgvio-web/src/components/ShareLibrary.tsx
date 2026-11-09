import { CaretRightIcon, CheckIcon, FilmSlateIcon, MagnifyingGlassIcon, PlayIcon, StarIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { memo, useDeferredValue, useEffect, useMemo, useSyncExternalStore, useState } from "react";
import { CATEGORY_LABEL, categoryCounts, categoryOf, posterSrc, shareLibrary, type Category, type LibraryItem } from "../api/posters";
import { seriesInShare, type Series } from "../api/series";
import { shareProgressKey } from "../api/share";
import { CategoryFilter } from "./CategoryFilter";
import { ErrorState } from "./ErrorState";
import { Strip } from "./SeriesPanel";
import { formatClock, recentProgress, subscribeProgress, watched } from "../lib/progress";
import { basename, join } from "../lib/path";
import { spring } from "../lib/motion";
import { cnNumeral } from "./SeriesPanel";

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
      <div className="relative aspect-[2/3] overflow-hidden rounded-[12px] bg-white/[0.05] transition-transform duration-300 ease-[var(--ease-expo)] group-hover/card:-translate-y-1"
        style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.07), 0 24px 48px -24px rgb(0 0 0 / 0.9)" }}>
        {item.poster
          ? <img src={posterSrc(item.poster, "w342")} alt="" loading="lazy" decoding="async" className="thumb absolute inset-0 size-full object-cover" />
          : <span className="absolute inset-0 grid place-items-center text-white/30"><FilmSlateIcon size={32} /></span>}
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
      <p className="mt-2 line-clamp-2 px-0.5 text-[13px] font-medium leading-snug text-white" title={item.path}>{item.title}</p>
      <p className="flex items-center gap-1.5 px-0.5 text-[12px] text-white/50 tabular">
        {item.year ? <span>{item.year}</span> : null}
        {item.rating ? <span className="inline-flex items-center gap-0.5"><StarIcon size={10} weight="fill" className="text-accent" />{item.rating.toFixed(1)}</span> : null}
      </p>
    </motion.button>
  );
});

/* --------------------------------------------------------------- sheet */

/**
 * A title's page inside the share: its poster, what it is, and for a series
 * every season's episodes. Playing one hands the file back to the share page.
 */
function Detail({ sid, code, item, onOpenDir, onPlay, onClose }: { sid: string; code: string; item: LibraryItem; onOpenDir: (path: string) => void; onPlay: (path: string) => void; onClose: () => void }) {
  useProgressTick();
  const query = useQuery({
    queryKey: ["share-series", sid, item.path, code],
    queryFn: () => seriesInShare(sid, code, item.path),
    enabled: !item.file && !!item.kind,
    retry: false,
    staleTime: 10 * 60_000,
  });
  const data: Series | null = query.data?.series ?? null;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const base = data?.base ?? item;
  const backdrop = base.backdrop || item.backdrop;
  const season = data?.season ?? 0;
  const episodes = data?.episodes ?? [];
  const playable = episodes.find(episode => episode.file && !watched(shareProgressKey(sid, join(item.path, episode.file!))));
  const all = data?.episodes.filter(e => e.file) ?? [];

  return (
    <motion.div className="fixed inset-0 z-50 overflow-y-auto bg-void/95 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="relative mx-auto min-h-dvh w-full max-w-[1100px] px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8"
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} transition={spring.soft}>
        <div className="relative overflow-hidden rounded-[24px]" style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.08)" }}>
          {backdrop && <img src={posterSrc(backdrop)} alt="" className="absolute inset-0 size-full object-cover opacity-40" />}
          <div className="absolute inset-0 bg-gradient-to-t from-void via-void/80 to-void/30" />
          <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:p-8">
            {item.poster && <img src={posterSrc(item.poster, "w342")} alt="" className="h-[168px] w-[112px] shrink-0 rounded-[10px] object-cover shadow-2xl" />}
            <div className="min-w-0 flex-1 text-white">
              <h2 className="text-[clamp(24px,4vw,40px)] font-semibold leading-tight tracking-tight">{base.title}</h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-white/60 tabular">
                {base.year ? <span>{base.year}</span> : null}
                {base.rating ? <span className="inline-flex items-center gap-0.5"><StarIcon size={11} weight="fill" className="text-accent" />{base.rating.toFixed(1)}</span> : null}
                {item.seasons ? <span>{item.seasons} 季</span> : null}
                {base.kind === "tv" ? <span>剧集</span> : null}
              </p>
              {base.overview && <p className="mt-3 line-clamp-4 max-w-[60ch] text-[13.5px] leading-relaxed text-white/70">{base.overview}</p>}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {!item.file && (
                  <button className="btn btn-primary h-10 px-4" onClick={() => { onClose(); onOpenDir(item.path); }}>
                    打开文件夹<CaretRightIcon size={15} />
                  </button>
                )}
                {item.file && (
                  <button className="btn btn-primary h-10 px-4" onClick={() => onPlay(item.path)}><PlayIcon size={15} weight="fill" />播放</button>
                )}
                {playable && data && (
                  <button className="btn btn-line h-10 px-4 text-white" onClick={() => onPlay(join(item.path, playable.file!))}>
                    <PlayIcon size={15} weight="fill" />继续看 {data.season ? `第${cnNumeral(data.season)}季 ` : ""}第 {playable.episode} 集
                  </button>
                )}
                {all.length > 0 && !playable && (
                  <button className="btn btn-line h-10 px-4 text-white" onClick={() => onPlay(join(item.path, all[0].file!))}>
                    <PlayIcon size={15} weight="fill" />从头看
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {query.isPending && !!item.kind && !item.file && (
          <p className="mt-6 text-[13px] text-white/45">正在读取剧集…</p>
        )}
        {episodes.length > 0 && (
          <section className="mt-8">
            <h3 className="mb-3 px-1 text-[15px] font-semibold text-white">
              {season ? `第 ${season} 季` : "剧集"}
              <span className="ml-2 text-[12.5px] font-normal text-white/45 tabular">{episodes.filter(e => e.file).length} / {episodes.length} 集</span>
            </h3>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {episodes.map(episode => {
                const file = episode.file;
                const key = file ? shareProgressKey(sid, join(item.path, file)) : "";
                const seen = key ? watched(key) : 0;
                return (
                  <button key={episode.episode} disabled={!file} onClick={() => file && onPlay(join(item.path, file))}
                    className="flex items-center gap-3 rounded-[12px] bg-white/[0.04] px-3 py-2 text-left transition-colors enabled:hover:bg-white/[0.08] disabled:opacity-40"
                    style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.06)" }}>
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-[12px] font-medium text-white tabular">
                      {seen >= 1 ? <CheckIcon size={14} weight="bold" className="text-accent" /> : episode.episode}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] text-white">{episode.name || `第 ${episode.episode} 集`}</span>
                      <span className="block truncate text-[12px] text-white/45 tabular">
                        {seen > 0 && seen < 1 ? `看到 ${formatClock((episode.runtime ?? 0) * 60 * seen)}` : episode.air || ""}
                      </span>
                    </span>
                    {file && <PlayIcon size={14} weight="fill" className="shrink-0 text-white/50" />}
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {season > 0 && !episodes.length && all.length === 0 && query.isSuccess && <p className="mt-6 text-[13px] text-white/45">这一季还没有文件。</p>}
      </motion.div>
      <button aria-label="关闭" onClick={onClose} className="fixed right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 grid size-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md hover:bg-white/20">
        <XIcon size={18} />
      </button>
    </motion.div>
  );
}

/* -------------------------------------------------------------- library */

export function ShareLibrary({ sid, code, onOpenDir, onPlay }: Props) {
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search);
  const [cat, setCat] = useState<Category | "all">("all");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [open, setOpen] = useState<LibraryItem | null>(null);
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
        {Array.from({ length: 12 }, (_, i) => <div key={i} className="aspect-[2/3] animate-pulse rounded-[12px] bg-white/[0.05]" style={{ animationDelay: `${i * 60}ms` }} />)}
      </div>
    );
  }
  if (query.isError) return <ErrorState className="mx-1" error={query.error} onRetry={() => { void query.refetch(); }} />;
  if (!all.length) {
    return (
      <div className="grid place-items-center py-20 text-center">
        <FilmSlateIcon size={38} className="text-white/25" />
        <p className="mt-3 text-[15px] font-medium text-white">这个分享里还没有配上海报的影视</p>
        <p className="mt-1 max-w-[34ch] text-[13px] text-white/50">切成「文件」看看全部内容，或者让分享者先在片库里认一下这些片子。</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="text-[13px] text-white/50 tabular">
          {deferred || chosen !== "all" ? `${items.length} / ${all.length} 部` : `${all.length} 部`}
        </p>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-3">
          {counts.length > 1 && <CategoryFilter path={`share-${sid}`} counts={counts} total={all.length} value={chosen} onChange={setCat} />}
          <div className="flex items-center gap-1 text-[13px]" role="group" aria-label="排序">
            {([["recent", "最近添加"], ["rating", "评分"], ["year", "年份"], ["title", "名称"]] as [LibrarySort, string][]).map(([key, label]) => (
              <button key={key} aria-pressed={sort === key} onClick={() => setSort(key)}
                className={`relative h-8 rounded-lg px-2.5 transition-colors ${sort === key ? "text-white" : "text-white/55 hover:text-white"}`}>
                {sort === key && <motion.span layoutId="share-library-sort" className="absolute inset-0 rounded-lg bg-white/10" transition={spring.snappy} />}
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>
          <label className="flex h-9 w-full max-w-[220px] items-center gap-2 rounded-[11px] bg-white/[0.06] px-3 text-white/50 hairline focus-within:text-white">
            <MagnifyingGlassIcon size={15} className="shrink-0" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜片名" aria-label="搜索片库"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/35" />
            {search && <button aria-label="清空" onClick={() => setSearch("")} className="text-white/40 hover:text-white"><XIcon size={13} /></button>}
          </label>
        </div>
      </div>

      {resumable.length > 0 && (
        <section className="mb-7">
          <h2 className="mb-3 px-1 text-[15px] font-semibold text-white">继续观看</h2>
          <Strip className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none]">
            {resumable.map(({ path, progress, owner }) => (
              <button key={path} onClick={() => onPlay(path)} className="group/row flex w-[min(78vw,300px)] shrink-0 snap-start items-center gap-3 rounded-[14px] bg-white/[0.05] p-2 text-left"
                style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.06)" }}>
                <span className="relative aspect-[2/3] w-[54px] shrink-0 overflow-hidden rounded-[9px] bg-white/10">
                  {owner?.poster
                    ? <img src={posterSrc(owner.poster, "w185")} alt="" loading="lazy" className="size-full object-cover" />
                    : <span className="grid size-full place-items-center text-white/30"><FilmSlateIcon size={18} /></span>}
                  <span className="absolute inset-x-1 bottom-1 h-[3px] overflow-hidden rounded-full bg-black/50">
                    <span className="block h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${progress.duration ? progress.time / progress.duration : 0})` }} />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-white">{owner?.title ?? basename(path)}</span>
                  <span className="block truncate text-[12px] text-white/45 tabular">看到 {formatClock(progress.time)}</span>
                </span>
              </button>
            ))}
          </Strip>
        </section>
      )}

      {items.length ? (
        <div className="grid grid-cols-3 gap-x-2.5 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-x-5 sm:gap-y-7">
          {items.slice(0, 600).map((item, index) => (
            <Card key={item.path} sid={sid} item={item} index={index} onOpen={() => setOpen(item)} />
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-[13.5px] text-white/50">片库里没有「{deferred || CATEGORY_LABEL[chosen as Category]}」</p>
      )}

      {open && (
        <Detail sid={sid} code={code} item={open} onOpenDir={onOpenDir} onClose={() => setOpen(null)}
          onPlay={path => { setOpen(null); onPlay(path); }} />
      )}
    </div>
  );
}
