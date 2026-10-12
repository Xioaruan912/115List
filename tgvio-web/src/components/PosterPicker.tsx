import { CheckIcon, MagnifyingGlassIcon, ProhibitIcon, StarIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { posters, posterSrc, type Poster } from "../api/posters";
import { spring } from "../lib/motion";
import { toast } from "../stores/toast";
import { ErrorState } from "./ErrorState";
import { Sheet } from "./Sheet";

/**
 * Pick the film or series a folder or video is: TMDB results as a poster grid
 * that deals itself in; the chosen one lifts and gets a check before the sheet
 * closes. Choices made here win over automatic matches.
 */
export function PosterPicker({ name, onClose }: { name: string; onClose: () => void }) {
  const client = useQueryClient();
  const [text, setText] = useState(name);
  const [query, setQuery] = useState(name);
  const [chosen, setChosen] = useState<string>("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 450);
    return () => clearTimeout(timer);
  }, [text]);
  const search = useQuery({ queryKey: ["poster-search", query], queryFn: () => posters.search(query), enabled: !!query, retry: false, staleTime: 5 * 60_000 });

  const pick = async (choice: Poster | null): Promise<void> => {
    setChosen(choice ? `${choice.kind}-${choice.id}` : "none");
    try {
      await posters.set(name, choice ? { kind: choice.kind, id: choice.id } : null);
      await client.invalidateQueries({ queryKey: ["posters"] });
      void client.invalidateQueries({ queryKey: ["poster-settings"] });
      toast.success(choice ? `封面换成了「${choice.title}」` : "不再显示海报");
      window.setTimeout(onClose, 380);
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
      <div className="mt-4 min-h-[300px]">
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
              const id = `${result.kind}-${result.id}`;
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
                            <motion.span className="grid size-10 place-items-center rounded-full bg-accent text-accent-ink" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={spring.bouncy}>
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
      </div>
    </Sheet>
  );
}
