import { CaretRightIcon, CheckIcon, PlayIcon, StarIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useMemo, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { posterSrc } from "../api/posters";
import { series, type SeriesEpisode } from "../api/series";
import { passwordFor } from "../hooks/useDir";
import { useLibraryScope } from "../hooks/useLibraryScope";
import { spring } from "../lib/motion";
import { encodePath, join } from "../lib/path";
import { getProgress, subscribeProgress, watched } from "../lib/progress";
import type { Obj } from "../lib/types";
import { useUi } from "../stores/ui";

/**
 * A folder of a TV series, shown as the series: backdrop, synopsis, a button to
 * go on where the person left off, the seasons, and the season's episodes with
 * stills, names and what was watched. Episodes not in the folder are dimmed.
 * The file grid below stays as it is.
 */

const SEASONISH = /(第\s*[\d一二三四五六七八九十]+\s*季|season\s*\d+|\bS\d{1,2}\b)/i;
const EPISODISH = /(S\d{1,2}\s*E\d{1,4}|第\s*\d+\s*[集话話]|\bE[Pp]?\d{1,3}\b|\[\d{1,3}\]| - \d{1,3}[ .[(])/i;

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

export function SeriesPanel({ path, items }: { path: string; items: Obj[] }) {
  const [, navigate] = useLocation();
  const library = useLibraryScope();
  const looksLike = useMemo(
    () => items.some(item => item.is_dir ? SEASONISH.test(item.name) : EPISODISH.test(item.name)),
    [items],
  );
  const query = useQuery({
    queryKey: ["series", path, items.length],
    queryFn: () => series(path, passwordFor(path)),
    enabled: looksLike && library.has(path),
    staleTime: 5 * 60_000,
    retry: false,
  });
  useSyncExternalStore(subscribeProgress, () => tick);
  const data = query.data?.series;
  if (!data) return null;
  const { base, subject } = data;
  const backdrop = base.backdrop || subject.backdrop;
  const up = nextUp(path, data.episodes);
  const play = (episode: SeriesEpisode): void => { if (episode.file) useUi.getState().openViewer(path, episode.file, null); };
  const have = data.episodes.filter(e => e.file).length;

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
              {base.rating ? <span className="inline-flex items-center gap-1"><StarIcon size={12} weight="fill" className="text-accent" />{base.rating.toFixed(1)}</span> : null}
            </p>
            {(subject.overview || base.overview) && <p className="mt-3 line-clamp-3 text-[13.5px] leading-relaxed text-white/75">{subject.overview || base.overview}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {up && (
                <button className="btn btn-primary h-10 px-4" onClick={() => play(up.episode)}>
                  <PlayIcon size={15} weight="fill" />{up.resume ? "继续看" : "开始看"} 第 {up.episode.episode} 集
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
              <button key={s.season} disabled={!s.folder} onClick={() => s.folder && navigate(encodePath(join(path, s.folder)))}
                className={`group/season w-[104px] shrink-0 text-left ${s.folder ? "" : "opacity-45"}`}>
                <div className="aspect-[2/3] overflow-hidden rounded-[10px] bg-white/10 transition-transform duration-300 ease-[var(--ease-expo)] group-enabled/season:group-hover/season:-translate-y-1">
                  {s.poster && <img src={posterSrc(s.poster, "w185")} alt="" loading="lazy" className="size-full object-cover" />}
                </div>
                <p className="mt-1.5 truncate text-[12.5px] font-medium">{s.season ? `第 ${s.season} 季` : "特别篇"}</p>
                <p className="text-[11.5px] text-white/55 tabular">{s.folder ? `${s.episodes} 集` : "未下载"}</p>
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
                    {!e.file && <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10.5px]">未下载</span>}
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
