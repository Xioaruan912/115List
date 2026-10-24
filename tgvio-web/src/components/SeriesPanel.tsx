import { CaretRightIcon, CheckIcon, MagnetIcon, PlayIcon, StarIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useMemo, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { posterSrc } from "../api/posters";
import { series, type Films, type SeriesEpisode } from "../api/series";
import { useResourceRoot } from "../hooks/useResourceRoot";
import { isFilm } from "../lib/kind";
import { passwordFor } from "../hooks/useDir";
import { useLibraryScope } from "../hooks/useLibraryScope";
import { spring } from "../lib/motion";
import { basename, encodePath, join, parent } from "../lib/path";
import { getProgress, subscribeProgress, watched } from "../lib/progress";
import type { Obj } from "../lib/types";
import { useUi } from "../stores/ui";

/**
 * A folder of a TV series, shown as the series: backdrop, synopsis, a button to
 * go on where the person left off, the seasons, and the season's episodes with
 * stills, names and what was watched. Episodes not in the folder are dimmed.
 * The file grid below stays as it is.
 */

const CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
/** 1..99 as season folders are named: 二, 十二, 二十 (the server's cnNumeral). */
export function cnNumeral(n: number): string {
  if (n <= 0 || n >= 100) return String(n);
  if (n < 10) return CN[n];
  if (n === 10) return "十";
  if (n < 20) return "十" + CN[n % 10];
  return CN[Math.floor(n / 10)] + "十" + (n % 10 ? CN[n % 10] : "");
}

/** Out already: an air or release date today or before. */
function aired(date?: string): boolean {
  return !!date && date <= new Date().toISOString().slice(0, 10);
}

function openFinder(query: string, base: string, folder?: string): void {
  useUi.getState().openDialog({ kind: "resources", query, base, folder });
}

let tick = 0;
subscribeProgress(() => { tick++; });

function clock(minutes?: number): string {
  if (!minutes) return "";
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60 ? `${minutes % 60} 分` : ""}` : `${minutes} 分钟`;
}

/** The episode to offer: the one in progress, else the one after the last finished, else the first. */
function nextUp(path: string, episodes: SeriesEpisode[]): { episode: SeriesEpisode; resume: boolean } | null {
  const withFiles = episodes.filter(e => e.file);
  if (!withFiles.length) return null;
  let last: { index: number; at: number; done: boolean } | null = null;
  withFiles.forEach((e, index) => {
    const full = join(path, e.file!);
    const progress = getProgress(full);
    const seen = watched(full);
    if (!seen) return;
    const at = progress?.at ?? 0;
    if (!last || at >= last.at) last = { index, at, done: seen >= 1 };
  });
  if (!last) return { episode: withFiles[0], resume: false };
  const { index, done } = last as { index: number; done: boolean };
  if (!done) return { episode: withFiles[index], resume: true };
  return withFiles[index + 1] ? { episode: withFiles[index + 1], resume: false } : null;
}

/**
 * What a folder is as a title: a TV series (anime, 综艺 too), a film, a film
 * series, or a shelf of titles. Shared by the panel and the cinema view (one
 * request: the same query). A folder of neither folders nor videos is nothing.
 */
export function useTitlePanel(path: string, items: Obj[]) {
  const library = useLibraryScope();
  const media = useMemo(() => items.some(item => item.is_dir || isFilm(item)), [items]);
  return useQuery({
    queryKey: ["series", path, items.length],
    queryFn: () => series(path, passwordFor(path)),
    enabled: media && library.has(path),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Whether the folder shows a title panel. */
export function hasTitlePanel(data: Awaited<ReturnType<typeof series>> | undefined): boolean {
  return !!(data?.series || data?.films);
}

export function SeriesPanel({ path, items }: { path: string; items: Obj[] }) {
  const [, navigate] = useLocation();
  const finder = useResourceRoot();
  const query = useTitlePanel(path, items);
  useSyncExternalStore(subscribeProgress, () => tick);
  const data = query.data?.series;
  if (!data && query.data?.films) return <FilmsPanel path={path} films={query.data.films} items={items} canFind={finder.enabled} />;
  if (!data) return null;
  const { base, subject } = data;
  const backdrop = base.backdrop || subject.backdrop;
  const up = nextUp(path, data.episodes);
  const play = (episode: SeriesEpisode): void => { if (episode.file) useUi.getState().openViewer(path, episode.file, null); };
  const have = data.episodes.filter(e => e.file).length;
  // Missing: out already, not here. Not out yet is not missing.
  const missingEpisodes = data.season ? data.episodes.filter(e => !e.file && aired(e.air)) : [];
  const missingSeasons = !data.season ? data.seasons.filter(s => s.season > 0 && !s.folder && aired(s.air)) : [];
  const seasonFolder = (season: number, year?: number) => `${base.title} 第${cnNumeral(season)}季${year ? ` (${year})` : ""}`;

  return (
    <motion.section className="relative mb-8 overflow-hidden rounded-[var(--radius-sheet)] bg-stage text-white" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft} aria-label={`${base.title} 剧集信息`}>
      {backdrop && (
        <img src={posterSrc(backdrop)} alt="" className="absolute inset-0 size-full object-cover opacity-45 sm:left-auto sm:w-[70%]" style={{ maskImage: "linear-gradient(90deg, transparent, black 45%)" }} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-stage via-stage/70 to-stage/20" />
      <div className="relative p-5 sm:p-8">
        <div className="flex gap-5">
          {subject.poster && <img src={posterSrc(subject.poster, "w342")} alt="" className="hidden h-[168px] w-[112px] shrink-0 rounded-[10px] object-cover shadow-2xl sm:block" />}
          <div className="min-w-0 sm:max-w-[60ch]">
            <h2 className="text-[clamp(24px,3.4vw,38px)] font-semibold leading-tight tracking-[-0.03em]">{base.title}</h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[13px] text-white/70 tabular">
              {base.year ? <span>{base.year}</span> : null}
              {data.season ? <span>第 {data.season} 季{data.episodes.length ? ` · 有 ${have}/${data.episodes.length} 集` : ""}</span> : <span>{data.seasons.filter(s => s.season > 0).length} 季</span>}
              {missingEpisodes.length > 0 && <span className="rounded-full bg-white/12 px-2 py-0.5 text-[12px] text-white">缺 {missingEpisodes.length} 集</span>}
              {missingSeasons.length > 0 && <span className="rounded-full bg-white/12 px-2 py-0.5 text-[12px] text-white">缺 {missingSeasons.length} 季</span>}
              {base.rating ? <span className="inline-flex items-center gap-1"><StarIcon size={12} weight="fill" className="text-accent" />{base.rating.toFixed(1)}</span> : null}
            </p>
            {(subject.overview || base.overview) && <p className="mt-3 line-clamp-3 text-[13.5px] leading-relaxed text-white/75">{subject.overview || base.overview}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {up && (
                <button className="btn btn-primary h-10 px-4" onClick={() => play(up.episode)}>
                  <PlayIcon size={15} weight="fill" />{up.resume ? "继续看" : "开始看"} 第 {up.episode.episode} 集
                </button>
              )}
              {finder.enabled && missingEpisodes.length > 0 && (
                <button className="btn h-10 bg-white/12 px-4 text-white backdrop-blur-md hover:bg-white/20" title={`缺：${missingEpisodes.map(e => `第 ${e.episode} 集`).join("、")}`}
                  onClick={() => openFinder(base.title, parent(path), basename(path))}>
                  <MagnetIcon size={15} />找缺的 {missingEpisodes.length} 集
                </button>
              )}
              {finder.enabled && missingSeasons.length === 1 && (
                <button className="btn h-10 bg-white/12 px-4 text-white backdrop-blur-md hover:bg-white/20"
                  onClick={() => openFinder(base.title, path, seasonFolder(missingSeasons[0].season, missingSeasons[0].year))}>
                  <MagnetIcon size={15} />找第 {missingSeasons[0].season} 季
                </button>
              )}
              {data.root && (
                <button className="btn h-10 bg-white/12 px-4 text-white backdrop-blur-md hover:bg-white/20" onClick={() => navigate(encodePath(data.root))}>
                  全部季<CaretRightIcon size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {!data.season && data.seasons.length > 0 && (
          <div className="mt-6 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none]">
            {data.seasons.map(s => (
              <button key={s.season} disabled={!s.folder && !(finder.enabled && aired(s.air) && s.season > 0)}
                title={!s.folder && finder.enabled && aired(s.air) ? `找第 ${s.season} 季的资源` : undefined}
                onClick={() => {
                  if (s.folder) navigate(encodePath(join(path, s.folder)));
                  else if (finder.enabled && aired(s.air) && s.season > 0) openFinder(base.title, path, seasonFolder(s.season, s.year));
                }}
                className={`group/season w-[104px] shrink-0 text-left ${s.folder ? "" : "opacity-45 enabled:hover:opacity-80"}`}>
                <div className="aspect-[2/3] overflow-hidden rounded-[10px] bg-white/10 transition-transform duration-300 ease-[var(--ease-expo)] group-enabled/season:group-hover/season:-translate-y-1">
                  {s.poster && <img src={posterSrc(s.poster, "w185")} alt="" loading="lazy" className="size-full object-cover" />}
                </div>
                <p className="mt-1.5 truncate text-[12.5px] font-medium">{s.season ? `第 ${s.season} 季` : "特别篇"}</p>
                <p className="text-[11.5px] text-white/55 tabular">{s.folder ? `${s.episodes} 集` : aired(s.air) ? "未下载" : s.air ? `${s.air} 播出` : "还没播出"}</p>
              </button>
            ))}
          </div>
        )}

        {data.episodes.length > 0 && (
          <div className="-mx-5 mt-6 flex snap-x gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-8 sm:px-8">
            {data.episodes.map(e => {
              const seen = e.file ? watched(join(path, e.file)) : 0;
              return (
                <button key={e.episode} disabled={!e.file} onClick={() => play(e)} title={e.file ?? "这一集不在文件夹里"}
                  className={`group/ep w-[min(70vw,248px)] shrink-0 snap-start text-left ${e.file ? "" : "opacity-40"}`}>
                  <div className="relative aspect-video overflow-hidden rounded-[10px] bg-white/10">
                    {e.still && <img src={e.still} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 ease-[var(--ease-expo)] group-enabled/ep:group-hover/ep:scale-105" />}
                    {e.file && (
                      <span className="absolute inset-0 grid place-items-center bg-black/25 opacity-0 transition-opacity group-hover/ep:opacity-100 [@media(hover:none)]:hidden">
                        <span className="grid size-10 place-items-center rounded-full bg-accent text-accent-ink"><PlayIcon size={15} weight="fill" className="translate-x-px" /></span>
                      </span>
                    )}
                    {seen >= 1 && (
                      <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-black/60 py-0.5 pl-1.5 pr-2 text-[10.5px] font-medium backdrop-blur-md">
                        <CheckIcon size={10} weight="bold" className="text-accent" />看完
                      </span>
                    )}
                    {seen > 0 && seen < 1 && (
                      <span className="absolute inset-x-0 bottom-0 h-1 bg-black/45"><span className="block h-full origin-left bg-accent" style={{ transform: `scaleX(${seen})` }} /></span>
                    )}
                    {!e.file && <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10.5px]">{aired(e.air) ? "未下载" : e.air ? `${e.air} 播出` : "还没播出"}</span>}
                  </div>
                  <p className="mt-2 truncate text-[13px] font-medium"><span className="text-white/55 tabular">{e.episode}. </span>{e.name || `第 ${e.episode} 集`}</p>
                  <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-white/55">{e.overview || [e.air, clock(e.runtime)].filter(Boolean).join(" · ")}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </motion.section>
  );
}

/** The video to play for a film's folder: its largest, the first part for a film in parts. */
function filmVideo(items: Obj[]): Obj | undefined {
  const videos = items.filter(item => !item.is_dir && isFilm(item));
  const parts = videos.filter(item => /(?:cd|disc|part)\s*0?1\b/i.test(item.name));
  return (parts.length ? parts : videos).reduce<Obj | undefined>((best, item) => !best || item.size > best.size ? item : best, undefined);
}

/**
 * A folder of films, in the series panel's form: one film (its poster,
 * overview, a button to play), one film of a series or a series' folder (the
 * series below: which films are here, which are missing, which are not out
 * yet), or a shelf of titles (周星驰电影合集: every title here).
 */
function FilmsPanel({ path, films, items, canFind }: { path: string; films: Films; items: Obj[]; canFind: boolean }) {
  const [, navigate] = useLocation();
  const own = films.film;
  const shelf = films.kind === "shelf";
  // The folder is one film: its series' other films go beside it.
  const home = own ? parent(path) : path;
  const parts = films.kind === "film" ? [] : films.parts;
  const have = parts.filter(part => part.place).length;
  const missing = shelf ? [] : parts.filter(part => !part.place && part.released);
  const backdrop = own?.backdrop || films.backdrop || parts.find(part => part.place)?.backdrop;
  const plain = films.name.replace(/[（(]系列[）)]$|系列$|\s*Collection$/i, "").trim();
  const video = own ? filmVideo(items) : undefined;
  const seen = video ? watched(join(path, video.name)) : 0;
  const open = (place: string): void => {
    if (place === ".") return;
    if (/\.[a-z0-9]{2,4}$/i.test(place)) useUi.getState().openViewer(path, place, null);
    else navigate(encodePath(join(path, place)));
  };
  const title = own?.title ?? films.name;
  const poster = own?.poster || films.poster || (shelf ? parts.find(part => part.poster)?.poster : undefined);
  const overview = own?.overview || (shelf ? "" : films.overview);
  return (
    <motion.section className="relative mb-8 overflow-hidden rounded-[var(--radius-sheet)] bg-stage text-white" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft} aria-label={`${title} ${own ? "影片" : shelf ? "片单" : "系列"}信息`}>
      {backdrop && (
        <img src={posterSrc(backdrop)} alt="" className="absolute inset-0 size-full object-cover opacity-45 sm:left-auto sm:w-[70%]" style={{ maskImage: "linear-gradient(90deg, transparent, black 45%)" }} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-stage via-stage/70 to-stage/20" />
      <div className="relative p-5 sm:p-8">
        <div className="flex gap-5">
          {poster && <img src={posterSrc(poster, "w342")} alt="" className="hidden h-[168px] w-[112px] shrink-0 rounded-[10px] object-cover shadow-2xl sm:block" />}
          <div className="min-w-0 sm:max-w-[60ch]">
            <h2 className="text-[clamp(24px,3.4vw,38px)] font-semibold leading-tight tracking-[-0.03em] break-words">{title}</h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-white/70 tabular">
              {own?.year ? <span>{own.year}</span> : null}
              {own?.rating ? <span className="inline-flex items-center gap-1"><StarIcon size={12} weight="fill" className="text-accent" />{own.rating.toFixed(1)}</span> : null}
              {shelf && <span>{parts.length} 部</span>}
              {!shelf && parts.length > 0 && <span>{own ? `${plain} · ` : ""}{parts.length} 部 · 有 {have} 部</span>}
              {missing.length > 0 && <span className="rounded-full bg-white/12 px-2 py-0.5 text-[12px] text-white">缺 {missing.length} 部</span>}
              {seen >= 1 && <span className="inline-flex items-center gap-1"><CheckIcon size={12} weight="bold" className="text-accent" />看完了</span>}
            </p>
            {overview && <p className="mt-3 line-clamp-3 text-[13.5px] leading-relaxed text-white/75">{overview}</p>}
            {(video || canFind && missing.length > 0) && (
              <div className="mt-4 flex flex-wrap gap-2">
                {video && (
                  <button className="btn btn-primary h-10 px-4" onClick={() => useUi.getState().openViewer(path, video.name, null)}>
                    <PlayIcon size={15} weight="fill" />{seen > 0 && seen < 1 ? "继续看" : seen >= 1 ? "再看一遍" : "播放"}
                  </button>
                )}
                {canFind && missing.length > 0 && (
                  <button className={video ? "btn h-10 bg-white/12 px-4 text-white backdrop-blur-md hover:bg-white/20" : "btn btn-primary h-10 px-4"}
                    onClick={() => openFinder(missing.length === 1 ? missing[0].title : plain, home)}>
                    <MagnetIcon size={15} />{missing.length === 1 ? `找「${missing[0].title}」` : `找缺的 ${missing.length} 部`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {parts.length > 0 && (
          <div className="-mx-5 mt-6 flex snap-x gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-8 sm:px-8">
            {parts.map(part => {
              const here = !!part.place;
              const findable = !here && part.released && canFind;
              const place = own && part.place === "." ? "." : part.place;
              return (
                <button key={`${part.kind}-${part.id}-${part.place ?? ""}`} disabled={!here && !findable}
                  onClick={() => { if (place) { if (own && place !== ".") navigate(encodePath(join(home, place))); else open(place); } else if (findable) openFinder(part.title, home); }}
                  title={here ? place === "." ? "就是这个文件夹" : part.place : findable ? `找「${part.title}」的资源` : part.release ? `${part.release} 上映` : "还没上映"}
                  className={`group/part w-[120px] shrink-0 snap-start text-left ${here ? "" : "opacity-50 enabled:hover:opacity-85"}`}>
                  <div className="relative aspect-[2/3] overflow-hidden rounded-[10px] bg-white/10 transition-transform duration-300 ease-[var(--ease-expo)] group-enabled/part:group-hover/part:-translate-y-1">
                    {part.poster && <img src={posterSrc(part.poster, "w342")} alt="" loading="lazy" className="size-full object-cover" />}
                    {place === "." && <span className="absolute left-1.5 top-1.5 rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-medium text-accent-ink">当前</span>}
                    {part.kind === "tv" && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[10.5px] backdrop-blur-md">剧集</span>}
                    {!here && (
                      <span className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[10.5px] backdrop-blur-md">
                        {findable ? <><MagnetIcon size={11} />找资源</> : part.released ? "未下载" : part.release ? `${part.release} 上映` : "还没上映"}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[12.5px] font-medium leading-snug">{part.title}</p>
                  <p className="text-[11.5px] text-white/55 tabular">
                    {part.year || ""}{part.rating ? <span className="ml-1.5 inline-flex items-center gap-0.5"><StarIcon size={10} weight="fill" className="text-accent" />{part.rating.toFixed(1)}</span> : null}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </motion.section>
  );
}
