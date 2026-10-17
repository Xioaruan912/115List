import { FolderSimpleIcon, InfoIcon, PlayIcon, ShuffleIcon, StarIcon } from "@phosphor-icons/react";
import { posterSrc, type Poster as Art } from "../api/posters";
import { AnimatePresence, motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import { useCover } from "../hooks/useCover";
import { formatBytes, formatDate } from "../lib/format";
import { kindOf } from "../lib/kind";
import { spring } from "../lib/motion";
import { extname, join } from "../lib/path";
import { formatClock, getProgress, inProgress, subscribeProgress, watched } from "../lib/progress";
import type { Obj } from "../lib/types";
import { useUi } from "../stores/ui";
import { KindIcon } from "./KindIcon";
import { NamedPoster } from "./PosterWall";
import type { TileHandlers } from "./Tile";

/**
 * Cinema mode: the folder as a media library. A billboard up top recommends
 * something at random (a new pick on every visit, then every few seconds), or
 * whatever the pointer rests on, a row picks up unfinished videos, and the rest is a wall
 * of posters that tilt toward the pointer. Pictures come from thumbnails, folder
 * covers, or a generated poster carrying the real title.
 */

const PAGE = 240;
const ROTATE = 12_000;

function titleOf(obj: Obj): string {
  if (obj.is_dir) return obj.name;
  const ext = extname(obj.name);
  return ext ? obj.name.slice(0, -(ext.length + 1)) : obj.name;
}

function useProgressVersion(): number {
  return useSyncExternalStore(subscribeProgress, () => progressVersion);
}
let progressVersion = 0;
subscribeProgress(() => { progressVersion++; });

/** The best picture for an item: its own thumbnail, else its folder cover. */
function usePicture(dir: string, obj: Obj, ref: React.RefObject<Element | null>, enabled = true): string {
  const cover = useCover(join(dir, obj.name), ref, enabled && obj.is_dir && !obj.thumb);
  return obj.thumb || cover?.thumbs[0] || "";
}

/* -------------------------------------------------------------- poster */

const Poster = memo(function Poster({ dir, obj, art, index, handlers, onFocus }: {
  dir: string;
  obj: Obj;
  art?: Art;
  index: number;
  handlers: TileHandlers;
  onFocus: (obj: Obj) => void;
}) {
  const reduced = useReducedMotion();
  const frame = useRef<HTMLDivElement>(null);
  const own = usePicture(dir, obj, frame, !art);
  const picture = art?.poster ? posterSrc(art.poster, "w500") : own;
  const [broken, setBroken] = useState(false);
  useProgressVersion();
  const seen = watched(join(dir, obj.name));
  const kind = kindOf(obj);

  // Tilt toward the pointer with a glare that follows it, all on motion values.
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateY = useSpring(useTransform(px, [0, 1], [-11, 11]), { stiffness: 220, damping: 22 });
  const rotateX = useSpring(useTransform(py, [0, 1], [9, -9]), { stiffness: 220, damping: 22 });
  const glareX = useTransform(px, value => `${value * 100}%`);
  const glareY = useTransform(py, value => `${value * 100}%`);
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX} ${glareY}, rgb(255 255 255 / 0.32), transparent 55%)`;
  const lift = useSpring(0, { stiffness: 300, damping: 24 });
  const scale = useTransform(lift, [0, 1], [1, 1.045]);
  const shadow = useTransform(lift, [0, 1], ["0 14px 30px -18px rgb(0 0 0 / 0.55)", "0 34px 60px -22px rgb(0 0 0 / 0.75)"]);

  const hoverTimer = useRef(0);
  const onMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType !== "mouse" || reduced) return;
    const rect = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - rect.left) / rect.width);
    py.set((event.clientY - rect.top) / rect.height);
  };
  const onEnter = (event: React.PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    lift.set(1);
    clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => onFocus(obj), 320);
  };
  const onLeave = (): void => { lift.set(0); px.set(0.5); py.set(0.5); clearTimeout(hoverTimer.current); };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  return (
    <motion.div
      data-name={obj.name}
      data-flip={obj.name}
      className="poster-cell group/poster relative cursor-pointer select-none"
      initial={reduced ? false : { opacity: 0, y: 48, rotateX: 28 }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
      viewport={{ once: true, margin: "0px 0px -40px 0px" }}
      transition={{ ...spring.soft, delay: Math.min(index % 12, 11) * 0.035 }}
      style={{ transformPerspective: 900 }}
      onClick={(event: MouseEvent<HTMLDivElement>) => handlers.onActivate(obj, event, event.currentTarget)}
      onContextMenu={event => { event.preventDefault(); handlers.onMenu(obj, event.clientX, event.clientY); }}
      onKeyDown={event => { if (event.key === "Enter") handlers.onActivate(obj, event as unknown as MouseEvent<HTMLElement>, event.currentTarget); }}
      tabIndex={0}
      role="button"
      aria-label={obj.name}
    >
      <motion.div
        ref={frame}
        data-thumb
        className="relative aspect-[2/3] overflow-hidden rounded-[12px] bg-surface"
        style={{ rotateX, rotateY, scale, boxShadow: shadow, transformPerspective: 700 }}
        onPointerMove={onMove}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      >
        {picture && !broken ? (
          <img src={picture} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(true)}
            className="absolute inset-0 size-full object-cover" />
        ) : (
          <NamedPoster title={titleOf(obj)} caption={obj.is_dir ? "合集" : `${extname(obj.name).toUpperCase() || "文件"}  ${formatBytes(obj.size)}`} />
        )}
        <div className="pointer-events-none absolute inset-0 rounded-[12px]" style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.08)" }} />
        <motion.div className="pointer-events-none absolute inset-0 opacity-0 mix-blend-overlay transition-opacity duration-300 group-hover/poster:opacity-100" style={{ background: glare }} />
        <span className="absolute left-2 top-2 grid size-7 place-items-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-md transition duration-300 group-hover/poster:opacity-100 [@media(hover:none)]:opacity-100">
          {obj.is_dir ? <FolderSimpleIcon size={13} weight="fill" /> : kind === "video" ? <PlayIcon size={12} weight="fill" /> : <KindIcon kind={kind} size={13} weight="bold" />}
        </span>
        {seen > 0 && (
          <span className="absolute inset-x-2 bottom-2 h-[3px] overflow-hidden rounded-full bg-black/40">
            <motion.span className="block h-full origin-left rounded-full bg-accent" initial={{ scaleX: 0 }} animate={{ scaleX: seen }} transition={{ ...spring.soft, delay: 0.3 }} />
          </span>
        )}
      </motion.div>
      <p className="mt-2 line-clamp-2 break-all px-0.5 text-[13px] font-medium leading-snug" title={obj.name}>{art?.title ?? titleOf(obj)}</p>
      {art?.year && <p className="px-0.5 text-[12px] text-muted tabular">{art.year}{art.kind === "tv" ? " 剧集" : " 电影"}</p>}
    </motion.div>
  );
});

/* -------------------------------------------------------------- billboard */

function Billboard({ dir, obj, art, handlers, onShuffle, onHold }: {
  dir: string; obj: Obj; art?: Art; handlers: TileHandlers;
  /** Another random pick; absent when there is nothing else to pick. */
  onShuffle?: () => void;
  /** The pointer is over the billboard: the rotation waits. */
  onHold: (hold: boolean) => void;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const own = usePicture(dir, obj, ref, !art);
  const picture = art?.backdrop ? posterSrc(art.backdrop) : art?.poster ? posterSrc(art.poster, "w780") : own;
  const path = join(dir, obj.name);
  useProgressVersion();
  const progress = getProgress(path);
  const kind = kindOf(obj);
  const action = obj.is_dir ? "打开" : kind === "video" ? (progress ? "继续播放" : "播放") : "查看";
  const facts = art
    ? [art.year ? String(art.year) : "", art.kind === "tv" ? "剧集" : "电影", obj.is_dir ? "" : formatBytes(obj.size)].filter(Boolean)
    : [obj.is_dir ? "文件夹" : extname(obj.name).toUpperCase(), obj.is_dir ? "" : formatBytes(obj.size), formatDate(obj.modified)].filter(Boolean);
  return (
    <div ref={ref} onPointerEnter={() => onHold(true)} onPointerLeave={() => onHold(false)} className="relative mb-8 h-[min(46vh,400px)] min-h-[280px] sm:h-[min(56vh,520px)] overflow-hidden rounded-[var(--radius-sheet)] bg-stage text-white" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
      <AnimatePresence initial={false}>
        <motion.div key={obj.name} className="absolute inset-0" initial={{ opacity: 0, scale: 1.06 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}>
          <div className={`absolute inset-0 ${reduced ? "" : "ken-burns"}`}>
            {picture ? (
              <>
                <img src={picture} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full scale-110 object-cover opacity-60 blur-2xl" />
                <img src={picture} alt="" referrerPolicy="no-referrer" className="absolute inset-y-0 right-0 h-full w-full object-cover sm:w-[68%]" style={{ maskImage: "linear-gradient(90deg, transparent, black 38%)" }} />
              </>
            ) : <NamedPoster title={titleOf(obj)} caption="" />}
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-t from-stage via-stage/45 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-stage/90 via-stage/35 to-transparent max-sm:hidden" />
      <div className="absolute inset-x-0 bottom-0 p-5 sm:max-w-[62%] sm:p-9">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={obj.name} initial={{ opacity: 0, y: 18, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
            <h2 className="line-clamp-2 break-all text-[clamp(28px,4.6vw,58px)] font-semibold leading-[1.02] tracking-[-0.045em] [text-shadow:0_6px_30px_rgb(0_0_0/0.5)]">{art?.title ?? titleOf(obj)}</h2>
            {art?.original && <p className="mt-1 text-[14px] text-white/55">{art.original}</p>}
            <p className="mt-3 text-[13px] text-white/70 tabular">
              {facts.join("，")}
              {art?.rating ? <span className="ml-3 inline-flex items-center gap-1 text-white/85"><StarIcon size={12} weight="fill" className="text-accent" />{art.rating.toFixed(1)}</span> : null}
              {progress && <span className="ml-3 text-accent">看到 {formatClock(progress.time)}</span>}
            </p>
            {art?.overview && <p className="mt-3 line-clamp-2 max-w-[52ch] text-[13.5px] leading-relaxed text-white/70 max-sm:hidden">{art.overview}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              <button className="btn btn-primary h-11 px-5 text-[14px]" onClick={event => {
                const poster = document.querySelector<HTMLElement>(`[data-view="active"] .poster-cell[data-name="${CSS.escape(obj.name)}"]`);
                handlers.onActivate(obj, event, poster ?? event.currentTarget);
              }}>
                {obj.is_dir ? <FolderSimpleIcon size={17} weight="fill" /> : <PlayIcon size={16} weight="fill" />}{action}
              </button>
              <button className="btn h-11 bg-white/12 px-4 text-white backdrop-blur-md hover:bg-white/20" onClick={() => useUi.getState().openDialog({ kind: "info", dir, obj })}>
                <InfoIcon size={17} />详细信息
              </button>
              {onShuffle && (
                <motion.button className="btn h-11 bg-white/12 px-4 text-white backdrop-blur-md hover:bg-white/20" whileTap={{ scale: 0.95 }} transition={spring.snappy}
                  onClick={onShuffle} aria-label="换一部">
                  <ShuffleIcon size={17} />换一部
                </motion.button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- continue row */

function ContinueRow({ dir, items, handlers }: { dir: string; items: Obj[]; handlers: TileHandlers }) {
  useProgressVersion();
  const byName = useMemo(() => new Map(items.map(item => [item.name, item])), [items]);
  const rows = inProgress(dir).map(entry => ({ obj: byName.get(entry.name), progress: entry.progress })).filter(entry => entry.obj) as { obj: Obj; progress: { time: number; duration: number } }[];
  if (!rows.length) return null;
  return (
    <section className="mb-9">
      <h3 className="mb-3 text-[17px] font-semibold tracking-tight">继续观看</h3>
      <div className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
        {rows.map(({ obj, progress }, index) => (
          <motion.button key={obj.name} data-name={obj.name} className="group/cont relative w-[min(72vw,300px)] shrink-0 snap-start text-left"
            initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring.soft, delay: index * 0.06 }}
            onClick={event => handlers.onActivate(obj, event, event.currentTarget)}>
            <div data-thumb className="relative aspect-video overflow-hidden rounded-[12px] bg-surface" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
              {obj.thumb ? <img src={obj.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover transition-transform duration-700 ease-[var(--ease-expo)] group-hover/cont:scale-105" />
                : <NamedPoster title={titleOf(obj)} caption="" />}
              <span className="absolute inset-0 grid place-items-center bg-black/25 opacity-0 transition-opacity duration-300 group-hover/cont:opacity-100 [@media(hover:none)]:bg-black/10 [@media(hover:none)]:opacity-100">
                <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-ink"><PlayIcon size={18} weight="fill" className="translate-x-px" /></span>
              </span>
              <span className="absolute inset-x-0 bottom-0 h-1 bg-black/45">
                <span className="block h-full origin-left bg-accent" style={{ transform: `scaleX(${Math.min(1, progress.time / progress.duration)})` } as CSSProperties} />
              </span>
            </div>
            <p className="mt-2 truncate text-[13px] font-medium">{titleOf(obj)}</p>
            <p className="text-[12px] text-muted tabular">还剩 {formatClock(progress.duration - progress.time)}</p>
          </motion.button>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- view */

export function Cinema({ dir, items, handlers, posters = {} }: { dir: string; items: Obj[]; handlers: TileHandlers; posters?: Record<string, Art> }) {
  const [shown, setShown] = useState(PAGE);
  const [focused, setFocused] = useState<Obj | null>(null);
  // Random recommendations: things with TMDB art (a backdrop if any have one),
  // else videos, else anything. A new pick on every visit and every ROTATE ms.
  const pool = useMemo(() => {
    const backdrops = items.filter(item => posters[item.name]?.backdrop);
    if (backdrops.length) return backdrops;
    const art = items.filter(item => posters[item.name]?.poster);
    if (art.length) return art;
    const videos = items.filter(item => kindOf(item) === "video");
    return videos.length ? videos : items;
  }, [items, posters]);
  const [seed, setSeed] = useState(() => Math.random());
  const [held, setHeld] = useState(false);
  const reduced = useReducedMotion();
  const shuffle = (): void => {
    setFocused(null);
    // Never the same one twice in a row.
    setSeed(prev => {
      if (pool.length < 2) return prev;
      const current = Math.floor(prev * pool.length);
      const next = (current + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length;
      return (next + Math.random() * 0.999) / pool.length;
    });
  };
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  useEffect(() => {
    if (held || focused || reduced || pool.length < 2) return;
    const timer = window.setInterval(() => { if (!document.hidden) shuffleRef.current(); }, ROTATE);
    return () => clearInterval(timer);
  }, [held, focused, reduced, pool.length]);
  const featured = useMemo(() => {
    if (focused && items.some(item => item.name === focused.name)) return focused;
    return pool[Math.min(pool.length - 1, Math.floor(seed * pool.length))];
  }, [focused, items, pool, seed]);

  return (
    <div>
      {featured && <Billboard dir={dir} obj={featured} art={posters[featured.name]} handlers={handlers}
        onShuffle={pool.length > 1 ? shuffle : undefined} onHold={setHeld} />}
      <ContinueRow dir={dir} items={items} handlers={handlers} />
      <section>
        <h3 className="mb-3 text-[17px] font-semibold tracking-tight">全部 <span className="ml-1 text-[13px] font-normal text-muted tabular">{items.length}</span></h3>
        <div className="grid grid-cols-3 gap-x-2.5 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-5 sm:gap-y-7">
          {items.slice(0, shown).map((obj, index) => (
            <Poster key={obj.name} dir={dir} obj={obj} art={posters[obj.name]} index={index} handlers={handlers} onFocus={setFocused} />
          ))}
        </div>
        {items.length > shown && (
          <div className="mt-8 flex justify-center">
            <button className="btn btn-line" onClick={() => setShown(value => value + PAGE)}>再显示 {Math.min(PAGE, items.length - shown)} 个</button>
          </div>
        )}
      </section>
    </div>
  );
}
