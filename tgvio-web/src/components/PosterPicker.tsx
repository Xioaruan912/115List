import { CaretLeftIcon, CheckIcon, MagnifyingGlassIcon, ProhibitIcon, StarIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { posters, posterSrc, type Poster } from "../api/posters";
import { spring } from "../lib/motion";
import { toast } from "../stores/toast";
import { useUi, type Dialog } from "../stores/ui";
import { ErrorState } from "./ErrorState";
import { Sheet } from "./Sheet";

/**
 * Pick the film or series a folder or video is: TMDB results as a poster grid
 * that deals itself in; the chosen one lifts and gets a check before the sheet
 * closes. Choices made here win over automatic matches.
 */
const SEASON_IN_NAME = /第\s*([0-9一二三四五六七八九十]{1,3})\s*[季部]|season[ ._-]?(\d{1,2})|(?:^|[\s._-])s(\d{1,2})(?:e\d+)?(?:$|[\s._-])/i;
const CN: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function seasonInName(name: string): number {
  const m = SEASON_IN_NAME.exec(name);
  if (!m) return 0;
  const raw = m[1] ?? m[2] ?? m[3] ?? "";
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw.length === 1) return CN[raw] ?? 0;
  if (raw.startsWith("十")) return 10 + (CN[raw[1]] ?? 0);
  return (CN[raw[0]] ?? 0) * 10 + (CN[raw[2]] ?? 0);
}

/** Which season of a series: the whole show, or one season's own poster. */
function SeasonStep({ name, series, chosen, onBack, onPick }: { name: string; series: Poster; chosen: string; onBack: () => void; onPick: (season: number) => void }) {
  const query = useQuery({ queryKey: ["poster-seasons", series.id], queryFn: () => posters.seasons(series.id), staleTime: 10 * 60_000, retry: false });
  const suggested = seasonInName(name);
  const tiles: { season: number; title: string; sub: string; poster?: string }[] = [
    { season: 0, title: "整部剧", sub: series.year ? `${series.year} 起` : "", poster: series.poster },
    ...(query.data ?? []).filter(item => item.season > 0).map(item => ({ season: item.season, title: item.name || `第 ${item.season} 季`, sub: `${item.year ?? ""}${item.episodes ? ` ${item.episodes} 集` : ""}`.trim(), poster: item.poster })),
  ];
  return (
    <div className="mt-4 min-h-[300px]">
      <div className="mb-3 flex items-center gap-2">
        <button className="btn btn-ghost h-8 px-2.5 text-[13px]" onClick={onBack}><CaretLeftIcon size={14} />换一部</button>
        <p className="min-w-0 truncate text-[14px] font-medium">{series.title}<span className="ml-2 text-[12.5px] font-normal text-muted">选哪一季的海报</span></p>
      </div>
      {query.isPending && <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton aspect-[2/3] rounded-[10px]" />)}</div>}
      {query.isError && <ErrorState compact error={query.error} onRetry={() => query.refetch()} />}
      {query.data && (
        <motion.ul className="grid grid-cols-3 gap-3 sm:grid-cols-5" initial="hidden" animate="shown" variants={{ shown: { transition: { staggerChildren: 0.04 } } }}>
          {tiles.map(tile => {
            const id = `tv-${series.id}-${tile.season}`;
            const active = chosen === id;
            const hint = suggested > 0 && tile.season === suggested;
            return (
              <motion.li key={tile.season} variants={{ hidden: { opacity: 0, y: 20, scale: 0.92 }, shown: { opacity: 1, y: 0, scale: 1, transition: spring.soft } }}>
                <motion.button type="button" className="group block w-full text-left" disabled={!!chosen} onClick={() => onPick(tile.season)}
                  whileHover={{ y: -4 }} whileTap={{ scale: 0.96 }} animate={chosen && !active ? { opacity: 0.35 } : active ? { y: -8, scale: 1.05 } : { opacity: 1 }} transition={spring.snappy}>
                  <div className="relative aspect-[2/3] overflow-hidden rounded-[10px] bg-surface"
                    style={{ boxShadow: active || hint ? "0 0 0 2px var(--accent), 0 20px 40px -18px rgb(0 0 0 / 0.6)" : "inset 0 0 0 1px var(--line)" }}>
                    {tile.poster ? <img src={posterSrc(tile.poster, "w185")} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      : <span className="grid size-full place-items-center text-[13px] text-muted">{tile.title}</span>}
                    {hint && !chosen && <span className="absolute left-1 top-1 rounded-full bg-accent px-1.5 py-0.5 text-[10.5px] font-semibold text-accent-ink">名字里的季</span>}
                    <AnimatePresence>
                      {active && (
                        <motion.span className="absolute inset-0 grid place-items-center bg-black/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                          <motion.span className="grid size-10 place-items-center rounded-full bg-accent text-accent-ink" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={spring.pop}>
                            <CheckIcon size={20} weight="bold" />
                          </motion.span>
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[12.5px] font-medium leading-snug">{tile.title}</p>
                  <p className="text-[11.5px] text-muted tabular">{tile.sub}</p>
                </motion.button>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </div>
  );
}

export function PosterPicker({ name, dir, then, onClose }: { name: string; dir?: string; then?: Dialog; onClose: () => void }) {
  const client = useQueryClient();
  const [text, setText] = useState(name);
  const [query, setQuery] = useState(name);
  const [chosen, setChosen] = useState<string>("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 450);
    return () => clearTimeout(timer);
  }, [text]);
  const search = useQuery({ queryKey: ["poster-search", query], queryFn: () => posters.search(query), enabled: !!query, retry: false, staleTime: 5 * 60_000 });

  const [series, setSeries] = useState<Poster | null>(null);
  const pick = async (choice: Poster | null, season?: number): Promise<void> => {
    // A series first asks which season: a 第二季 folder wants that season's poster.
    if (choice?.kind === "tv" && season === undefined && !series) { setSeries(choice); return; }
    setChosen(choice ? `${choice.kind}-${choice.id}-${season ?? 0}` : "none");
    try {
      await posters.set(name, choice ? { kind: choice.kind, id: choice.id, season: season || undefined } : null, dir);
      await client.invalidateQueries({ queryKey: ["posters"] });
      void client.invalidateQueries({ queryKey: ["poster-settings"] });
      toast.success(choice ? `封面换成了「${choice.title}${season ? ` 第 ${season} 季` : ""}」` : "不再显示海报");
      window.setTimeout(() => then ? useUi.getState().openDialog(then) : onClose(), 380);
    } catch (error) {
      setChosen("");
      toast.error("没有换成", error);
    }
  };

  return (
    <Sheet open onClose={onClose} width={760} title="更换封面"
      footer={<><button className="btn btn-ghost mr-auto text-muted" onClick={() => void pick(null)}><ProhibitIcon size={16} />不用海报</button><button className="btn btn-ghost" onClick={onClose}>取消</button></>}>
      <label className="relative block">
        <MagnifyingGlassIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="field pl-9" value={text} autoFocus onChange={event => setText(event.target.value)} aria-label="片名" placeholder="片名，可以带年份" />
      </label>
      <p className="mt-2 truncate text-[12.5px] text-faint">{search.data?.query && search.data.query !== text.trim() ? `按「${search.data.query}」搜索` : "资料来自 TMDB"}</p>
      <AnimatePresence mode="wait" initial={false}>
      {series ? (
        <motion.div key="seasons" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} transition={spring.soft}>
          <SeasonStep name={name} series={series} chosen={chosen} onBack={() => setSeries(null)} onPick={season => void pick(series, season)} />
        </motion.div>
      ) : (
      <motion.div key="results" className="mt-4 min-h-[300px]" initial={{ opacity: 0, x: -40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={spring.soft}>
        {search.isFetching && !search.data && (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => <div key={i} className="skeleton aspect-[2/3] rounded-[10px]" />)}
          </div>
        )}
        {search.isError && <ErrorState compact error={search.error} onRetry={() => search.refetch()} />}
        {search.data && search.data.results.length === 0 && <p className="py-12 text-center text-muted">没找到，换个片名或加上年份试试。</p>}
        {search.data && search.data.results.length > 0 && (
          <motion.ul key={search.data.query} className="grid grid-cols-3 gap-3 sm:grid-cols-5" initial="hidden" animate="shown"
            variants={{ shown: { transition: { staggerChildren: 0.035 } } }}>
            {search.data.results.map(result => {
              const id = `${result.kind}-${result.id}-0`;
              const active = chosen === id;
              return (
                <motion.li key={id} variants={{ hidden: { opacity: 0, y: 24, rotateX: 30 }, shown: { opacity: 1, y: 0, rotateX: 0, transition: spring.soft } }} style={{ transformPerspective: 700 }}>
                  <motion.button type="button" className="group block w-full text-left" onClick={() => void pick(result)} disabled={!!chosen}
                    whileHover={{ y: -4 }} whileTap={{ scale: 0.96 }} animate={chosen && !active ? { opacity: 0.35, scale: 0.96 } : active ? { y: -8, scale: 1.05 } : { opacity: 1 }} transition={spring.snappy}>
                    <div className="relative aspect-[2/3] overflow-hidden rounded-[10px] bg-surface" style={{ boxShadow: active ? "0 0 0 2px var(--accent), 0 20px 40px -18px rgb(0 0 0 / 0.6)" : "inset 0 0 0 1px var(--line)" }}>
                      <img src={posterSrc(result.poster, "w185")} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      {result.rating ? (
                        <span className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10.5px] text-white backdrop-blur-md tabular">
                          <StarIcon size={9} weight="fill" className="text-accent" />{result.rating.toFixed(1)}
                        </span>
                      ) : null}
                      <AnimatePresence>
                        {active && (
                          <motion.span className="absolute inset-0 grid place-items-center bg-black/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            <motion.span className="grid size-10 place-items-center rounded-full bg-accent text-accent-ink" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={spring.pop}>
                              <CheckIcon size={20} weight="bold" />
                            </motion.span>
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[12.5px] font-medium leading-snug">{result.title}</p>
                    <p className="text-[11.5px] text-muted tabular">{result.year ?? ""}{result.kind === "tv" ? " 剧集" : " 电影"}</p>
                  </motion.button>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </motion.div>
      )}
      </AnimatePresence>
    </Sheet>
  );
}
