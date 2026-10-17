import { CheckIcon, DotsThreeIcon, FolderOpenIcon, FolderSimpleIcon, PlayIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent } from "react";
import { useCover } from "../hooks/useCover";
import { posterSrc, type Poster } from "../api/posters";
import { StarIcon } from "@phosphor-icons/react";
import { formatBytes, formatDate } from "../lib/format";
import { kindOf, type Kind } from "../lib/kind";
import { spring } from "../lib/motion";
import { join } from "../lib/path";
import type { Obj } from "../lib/types";
import { KindIcon } from "./KindIcon";

export interface TileHandlers {
  onActivate: (obj: Obj, event: MouseEvent<HTMLElement>, element: HTMLElement) => void;
  onToggle: (obj: Obj, event: MouseEvent<HTMLElement>) => void;
  onMenu: (obj: Obj, x: number, y: number) => void;
  onLongPress: (obj: Obj, x: number, y: number) => void;
  onHoverFolder: (obj: Obj) => void;
  onDragStart: (obj: Obj, event: DragEvent<HTMLElement>) => void;
  onDropInto: (obj: Obj, event: DragEvent<HTMLElement>) => void;
  canDrag: boolean;
}

interface TileProps {
  density?: 0 | 1 | 2; // phones: 0 two columns, 1 three, 2 four
  dir?: string;
  /** TMDB art for a folder or video named after a film or series. */
  poster?: Poster;
  obj: Obj;
  index: number;
  selected: boolean;
  selecting: boolean;
  entering: boolean;
  handlers: TileHandlers;
}

const LONG_PRESS = 420;

// Fingers currently down anywhere. A long press only counts for a single finger
// that is still down: a pinch, or a tile sliding away under a lifted finger, must not select.
let fingers = 0;
if (typeof window !== "undefined") {
  const track = (event: TouchEvent): void => { fingers = event.touches.length; };
  window.addEventListener("touchstart", track, { passive: true, capture: true });
  window.addEventListener("touchend", track, { passive: true, capture: true });
  window.addEventListener("touchcancel", track, { passive: true, capture: true });
}

/** Pointer-follow spotlight without React state: write the position straight into CSS vars. */
function spotlight(event: PointerEvent<HTMLElement>): void {
  if (event.pointerType !== "mouse") return;
  const element = event.currentTarget;
  const rect = element.getBoundingClientRect();
  element.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  element.style.setProperty("--my", `${event.clientY - rect.top}px`);
}

function useLongPress(onLong: (x: number, y: number) => void) {
  const state = useRef({ timer: 0, fired: false, start: null as { x: number; y: number } | null });
  const s = state.current;
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      s.fired = false;
      if (event.pointerType === "mouse" || !event.isPrimary) { clearTimeout(s.timer); s.start = null; return; }
      const start = { x: event.clientX, y: event.clientY };
      s.start = start;
      event.currentTarget.classList.add("reveal");
      s.timer = window.setTimeout(() => {
        if (fingers !== 1 || !s.start) return;
        s.fired = true;
        navigator.vibrate?.(8);
        onLong(start.x, start.y);
      }, LONG_PRESS);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (s.start && Math.hypot(event.clientX - s.start.x, event.clientY - s.start.y) > 8) { clearTimeout(s.timer); s.start = null; }
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      clearTimeout(s.timer);
      s.start = null;
      const element = event.currentTarget;
      window.setTimeout(() => element.classList.remove("reveal"), 900);
    },
    onPointerCancel() { clearTimeout(s.timer); s.start = null; },
    consumed: () => s.fired,
  };
}

function Check({ on, visible }: { on: boolean; visible: boolean }) {
  return (
    <span
      className={`grid size-[22px] place-items-center rounded-full transition duration-300 ease-[var(--ease-expo)] ${on ? "bg-accent text-accent-ink scale-100" : "bg-black/35 text-transparent ring-1 ring-white/70 backdrop-blur-sm"} ${visible || on ? "opacity-100" : "opacity-0 group-hover/tile:opacity-100"}`}
    >
      <CheckIcon size={13} weight="bold" className={`transition-transform duration-300 ${on ? "scale-100" : "scale-50"}`} />
    </span>
  );
}

export const GridTile = memo(function GridTile({ obj, index, selected, selecting, entering, handlers, density = 0, poster }: TileProps) {
  const kind = kindOf(obj);
  const [broken, setBroken] = useState(false);
  const [dropping, setDropping] = useState(false);
  const press = useLongPress((x, y) => handlers.onLongPress(obj, x, y));
  const thumb = obj.thumb && !broken;
  const meta = obj.is_dir ? formatDate(obj.modified) : `${formatBytes(obj.size)}`;

  return (
    <div
      data-flip={obj.name}
      data-name={obj.name}
      className={`tile spot group/tile relative rounded-[var(--radius-tile)] ${density ? "p-1" : "p-1.5"} outline-none transition-[background-color,box-shadow] duration-300 ${entering ? "enter" : "enter-soft"} ${selected ? "bg-accent-soft" : "hover:bg-[var(--hover)]"} ${dropping ? "ring-2 ring-accent" : ""}`}
      style={{ "--i": index } as CSSProperties}
      tabIndex={0}
      role="button"
      aria-selected={selected}
      aria-label={obj.name}
      draggable={handlers.canDrag}
      onDragStart={event => handlers.onDragStart(obj, event)}
      onDragOver={obj.is_dir ? event => { if (event.dataTransfer.types.includes("application/x-tgvio")) { event.preventDefault(); setDropping(true); } } : undefined}
      onDragLeave={obj.is_dir ? () => setDropping(false) : undefined}
      onDrop={obj.is_dir ? event => { setDropping(false); handlers.onDropInto(obj, event); } : undefined}
      onPointerMove={event => { spotlight(event); press.onPointerMove(event); }}
      onPointerEnter={obj.is_dir ? () => handlers.onHoverFolder(obj) : undefined}
      onPointerDown={press.onPointerDown}
      onPointerUp={press.onPointerUp}
      onPointerCancel={press.onPointerCancel}
      onClick={event => { if (!press.consumed()) handlers.onActivate(obj, event, event.currentTarget); }}
      onContextMenu={event => { event.preventDefault(); handlers.onMenu(obj, event.clientX, event.clientY); }}
      onKeyDown={event => { if (event.key === "Enter") handlers.onActivate(obj, event as unknown as MouseEvent<HTMLElement>, event.currentTarget); }}
    >
      <div
        data-thumb
        className={`relative aspect-[4/3] overflow-hidden rounded-[10px] bg-surface transition-transform duration-500 ease-[var(--ease-expo)] ${selected ? "scale-[0.94]" : "group-hover/tile:-translate-y-0.5"}`}
        style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}
      >
        {poster ? <PosterCover poster={poster} small={density > 0} /> : thumb ? (
          <img className="thumb absolute inset-0 size-full object-cover" src={obj.thumb} alt="" loading="lazy" decoding="async"
            referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(true)} />
        ) : obj.is_dir ? (
          <div className="absolute inset-0 grid place-items-center text-muted">
            <span className="relative block size-14">
              <KindIcon kind="folder" weight="duotone" className="absolute inset-0 size-full transition duration-500 ease-[var(--ease-expo)] group-hover/tile:scale-75 group-hover/tile:opacity-0" />
              <FolderOpenIcon weight="duotone" className="absolute inset-0 size-full scale-110 text-accent-text opacity-0 transition duration-500 ease-[var(--ease-expo)] group-hover/tile:scale-100 group-hover/tile:opacity-100" />
            </span>
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-faint">
            <KindIcon kind={kind} weight="light" size={44} className="transition-transform duration-500 ease-[var(--ease-expo)] group-hover/tile:scale-110 group-hover/tile:-rotate-6" />
          </div>
        )}
        {kind === "video" && (
          <span className="absolute bottom-2 left-2 grid size-7 place-items-center rounded-full bg-black/50 text-white backdrop-blur-md transition-transform duration-300 group-hover/tile:scale-110">
            <PlayIcon size={12} weight="fill" />
          </span>
        )}
        <button
          type="button"
          className="absolute left-2 top-2"
          aria-label={selected ? "取消选择" : "选择"}
          onClick={event => { event.stopPropagation(); handlers.onToggle(obj, event); }}
        >
          <Check on={selected} visible={selecting} />
        </button>
        <button
          type="button"
          className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-md transition-opacity duration-200 group-hover/tile:opacity-100 focus:opacity-100 [@media(hover:none)]:hidden"
          aria-label="更多"
          onClick={event => { event.stopPropagation(); const r = event.currentTarget.getBoundingClientRect(); handlers.onMenu(obj, r.right, r.bottom); }}
        >
          <DotsThreeIcon size={16} weight="bold" />
        </button>
      </div>
      {density === 0 ? (
        <div className="px-1 pt-2 pb-0.5">
          <p className="line-clamp-2 break-all text-[13.5px] font-medium leading-snug" title={obj.name}>{obj.name}</p>
          <p className="mt-0.5 truncate text-[12px] text-muted tabular">{meta}</p>
        </div>
      ) : (
        <div className="px-0.5 pt-1.5">
          <p className={`truncate font-medium leading-snug ${density === 2 ? "text-[11px]" : "text-[12px]"}`} title={obj.name}>{obj.name}</p>
          {density === 1 && <p className="truncate text-[11px] text-muted tabular">{meta}</p>}
        </div>
      )}
    </div>
  );
});

export const ListRow = memo(function ListRow({ obj, index, selected, selecting, entering, handlers }: TileProps) {
  const kind = kindOf(obj);
  const [dropping, setDropping] = useState(false);
  const press = useLongPress((x, y) => handlers.onLongPress(obj, x, y));
  return (
    <div
      data-flip={obj.name}
      data-name={obj.name}
      className={`tile spot group/tile relative grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[var(--radius-control)] px-3 outline-none transition-colors duration-200 sm:grid-cols-[minmax(0,1fr)_96px_132px] ${entering ? "enter" : "enter-soft"} ${selected ? "bg-accent-soft" : "hover:bg-[var(--hover)]"} ${dropping ? "ring-2 ring-accent" : ""}`}
      style={{ "--i": index } as CSSProperties}
      tabIndex={0}
      role="button"
      aria-selected={selected}
      aria-label={obj.name}
      draggable={handlers.canDrag}
      onDragStart={event => handlers.onDragStart(obj, event)}
      onDragOver={obj.is_dir ? event => { if (event.dataTransfer.types.includes("application/x-tgvio")) { event.preventDefault(); setDropping(true); } } : undefined}
      onDragLeave={obj.is_dir ? () => setDropping(false) : undefined}
      onDrop={obj.is_dir ? event => { setDropping(false); handlers.onDropInto(obj, event); } : undefined}
      onPointerMove={event => { spotlight(event); press.onPointerMove(event); }}
      onPointerEnter={obj.is_dir ? () => handlers.onHoverFolder(obj) : undefined}
      onPointerDown={press.onPointerDown}
      onPointerUp={press.onPointerUp}
      onPointerCancel={press.onPointerCancel}
      onClick={event => { if (!press.consumed()) handlers.onActivate(obj, event, event.currentTarget); }}
      onContextMenu={event => { event.preventDefault(); handlers.onMenu(obj, event.clientX, event.clientY); }}
      onKeyDown={event => { if (event.key === "Enter") handlers.onActivate(obj, event as unknown as MouseEvent<HTMLElement>, event.currentTarget); }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" className="relative grid size-8 shrink-0 place-items-center" aria-label={selected ? "取消选择" : "选择"}
          onClick={event => { event.stopPropagation(); handlers.onToggle(obj, event); }}>
          <span data-thumb className={`grid size-8 place-items-center rounded-lg transition duration-300 ${selected || selecting ? "scale-0 opacity-0" : "group-hover/tile:scale-0 group-hover/tile:opacity-0"} ${obj.is_dir ? "text-ink group-hover/tile:text-accent-text" : "text-muted"}`}>
            <KindIcon kind={kind} size={20} weight={obj.is_dir ? "duotone" : "regular"} />
          </span>
          <span className="absolute inset-0 grid place-items-center"><Check on={selected} visible={selecting} /></span>
        </button>
        <span className="truncate font-medium" title={obj.name}>{obj.name}</span>
      </div>
      <span className="text-right text-[12.5px] text-muted tabular">{obj.is_dir ? "" : formatBytes(obj.size)}</span>
      <span className="hidden text-right text-[12.5px] text-muted tabular sm:block">{formatDate(obj.modified)}</span>
    </div>
  );
});

/**
 * A tile showing a film's or series' art: the backdrop fills it and drifts, the
 * poster leans at the left and straightens up when the pointer arrives.
 */
export function PosterCover({ poster, small = false }: { poster: Poster; small?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const backdrop = posterSrc(poster.backdrop, undefined) || posterSrc(poster.poster, "w342");
  return (
    <div className="poster-cover absolute inset-0 overflow-hidden bg-stage">
      <img src={backdrop} alt="" loading="lazy" decoding="async" draggable={false}
        className={`poster-backdrop absolute inset-0 size-full object-cover ${poster.backdrop ? "opacity-80" : "scale-125 opacity-60 blur-xl"}`} />
      <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/25 to-transparent" />
      <img src={posterSrc(poster.poster, "w342")} alt="" loading="lazy" decoding="async" draggable={false} onLoad={() => setLoaded(true)}
        className={`poster-card absolute bottom-[8%] left-[6%] h-[84%] w-auto rounded-[7px] ${loaded ? "opacity-100" : "opacity-0"}`} />
      {!small && (poster.year || poster.rating) ? (
        <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md tabular">
          {poster.year}{poster.rating ? <><StarIcon size={10} weight="fill" className="ml-0.5 text-accent" />{poster.rating.toFixed(1)}</> : null}
        </span>
      ) : null}
    </div>
  );
}

/** Folder cover: a mosaic of what is inside, cells trading places while hovered. */
function Mosaic({ thumbs, live }: { thumbs: string[]; live: boolean }) {
  const [shift, setShift] = useState(0);
  const n = thumbs.length;
  useEffect(() => {
    if (!live || n < 2) return;
    const timer = window.setInterval(() => setShift(value => value + 1), 1300);
    return () => clearInterval(timer);
  }, [live, n]);
  const layout = n === 1 ? "grid-cols-1" : n === 2 ? "grid-cols-2" : n === 3 ? "grid-cols-[2fr_1fr] grid-rows-2" : "grid-cols-2 grid-rows-2";
  return (
    <div className={`absolute inset-0 grid gap-[2px] ${layout}`}>
      {thumbs.map((_, cell) => {
        const url = thumbs[(cell + shift) % n];
        return (
          <div key={cell} className={`cover-cell relative overflow-hidden bg-raised ${n === 3 && cell === 0 ? "row-span-2" : ""}`} style={{ "--c": cell } as CSSProperties}>
            <AnimatePresence initial={false}>
              <motion.img key={url} src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false}
                className="cover-img absolute inset-0 size-full object-cover"
                onError={event => { event.currentTarget.style.visibility = "hidden"; }}
                style={{ transformOrigin: ["0% 0%", "100% 0%", "0% 100%", "100% 100%"][cell] }}
                initial={{ opacity: 0, scale: 1.18 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} />
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/** A folder with nothing to show: the kinds of things inside peek out of it. */
function FolderGlyph({ kinds, small }: { kinds: Kind[]; small: boolean }) {
  const size = small ? 40 : 56;
  return (
    <div className="absolute inset-0 grid place-items-center text-muted">
      <span className="relative block" style={{ width: size, height: size }}>
        {kinds.filter(kind => kind !== "folder").slice(0, 3).map((kind, index, list) => {
          const spread = (index - (list.length - 1) / 2);
          return (
            <span key={kind} className="peek absolute left-1/2 top-[-6%] grid size-[44%] place-items-center rounded-[6px] bg-raised text-faint"
              style={{ "--r": `${spread * 14}deg`, "--x": `${spread * 36}%`, "--d": `${index * 40}ms`, boxShadow: "0 0 0 1px var(--line), var(--shadow-lift)" } as CSSProperties}>
              <KindIcon kind={kind} size={small ? 11 : 14} weight="bold" />
            </span>
          );
        })}
        <KindIcon kind="folder" weight="duotone" className="absolute inset-0 size-full transition duration-500 ease-[var(--ease-expo)] group-hover/tile:scale-75 group-hover/tile:opacity-0" />
        <FolderOpenIcon weight="duotone" className="absolute inset-0 size-full scale-110 text-accent-text opacity-0 transition duration-500 ease-[var(--ease-expo)] group-hover/tile:scale-100 group-hover/tile:opacity-100" />
      </span>
    </div>
  );
}

/** Folders in grid view: same footprint as a file, with a cover made of what is inside. */
export const FolderTile = memo(function FolderTile({ obj, dir = "/", index, selected, selecting, entering, handlers, density = 0, poster }: TileProps) {
  const box = useRef<HTMLDivElement>(null);
  const cover = useCover(join(dir, obj.name), box, !poster);
  const [hover, setHover] = useState(false);
  const [dropping, setDropping] = useState(false);
  const press = useLongPress((x, y) => handlers.onLongPress(obj, x, y));
  const thumbs = cover?.thumbs ?? [];
  const meta = cover ? `${cover.count} 项` : formatDate(obj.modified);
  return (
    <div
      data-flip={obj.name}
      data-name={obj.name}
      className={`tile spot group/tile relative rounded-[var(--radius-tile)] ${density ? "p-1" : "p-1.5"} outline-none transition-[background-color,box-shadow] duration-300 ${entering ? "enter" : "enter-soft"} ${selected ? "bg-accent-soft" : "hover:bg-[var(--hover)]"} ${dropping ? "ring-2 ring-accent" : ""}`}
      style={{ "--i": index } as CSSProperties}
      tabIndex={0}
      role="button"
      aria-selected={selected}
      aria-label={obj.name}
      draggable={handlers.canDrag}
      onDragStart={event => handlers.onDragStart(obj, event)}
      onDragOver={event => { if (event.dataTransfer.types.includes("application/x-tgvio")) { event.preventDefault(); setDropping(true); } }}
      onDragLeave={() => setDropping(false)}
      onDrop={event => { setDropping(false); handlers.onDropInto(obj, event); }}
      onPointerMove={event => { spotlight(event); press.onPointerMove(event); }}
      onPointerEnter={event => { handlers.onHoverFolder(obj); if (event.pointerType === "mouse") setHover(true); }}
      onPointerLeave={() => setHover(false)}
      onPointerDown={press.onPointerDown}
      onPointerUp={press.onPointerUp}
      onPointerCancel={press.onPointerCancel}
      onClick={event => { if (!press.consumed()) handlers.onActivate(obj, event, event.currentTarget); }}
      onContextMenu={event => { event.preventDefault(); handlers.onMenu(obj, event.clientX, event.clientY); }}
      onKeyDown={event => { if (event.key === "Enter") handlers.onActivate(obj, event as unknown as MouseEvent<HTMLElement>, event.currentTarget); }}
    >
      <div ref={box} data-thumb className={`folder-stack relative aspect-[4/3] transition-transform duration-500 ease-[var(--ease-expo)] ${density ? "folder-stack-sm" : ""} ${selected ? "scale-[0.94]" : "group-hover/tile:-translate-y-0.5"}`}>
        <span className="folder-sheet folder-sheet-back" aria-hidden />
        <span className="folder-sheet folder-sheet-mid" aria-hidden />
        <div className="absolute inset-0 overflow-hidden rounded-[10px] bg-surface" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
          {poster ? <PosterCover poster={poster} small={density > 0} />
            : thumbs.length ? <Mosaic thumbs={thumbs} live={hover} /> : <FolderGlyph kinds={cover?.kinds ?? []} small={density > 0} />}
          {!poster && thumbs.length > 0 && <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />}
          {cover && !poster && density < 2 && (
            <motion.span className={`absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular backdrop-blur-md ${thumbs.length ? "bg-black/45 text-white" : "bg-[var(--hover)] text-muted"}`}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.snappy}>
              <FolderSimpleIcon size={11} weight="fill" />{cover.count}
            </motion.span>
          )}
          <button type="button" className="absolute left-2 top-2" aria-label={selected ? "取消选择" : "选择"}
            onClick={event => { event.stopPropagation(); handlers.onToggle(obj, event); }}>
            <Check on={selected} visible={selecting} />
          </button>
          <button type="button"
            className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-md transition-opacity duration-200 group-hover/tile:opacity-100 focus:opacity-100 [@media(hover:none)]:hidden"
            aria-label="更多" onClick={event => { event.stopPropagation(); const r = event.currentTarget.getBoundingClientRect(); handlers.onMenu(obj, r.right, r.bottom); }}>
            <DotsThreeIcon size={16} weight="bold" />
          </button>
        </div>
      </div>
      {density === 0 ? (
        <div className="px-1 pt-2 pb-0.5">
          <p className="line-clamp-2 break-all text-[13.5px] font-medium leading-snug" title={obj.name}>{obj.name}</p>
          <p className="mt-0.5 truncate text-[12px] text-muted tabular">{meta}</p>
        </div>
      ) : (
        <div className="px-0.5 pt-1.5">
          <p className={`truncate font-medium leading-snug ${density === 2 ? "text-[11px]" : "text-[12px]"}`} title={obj.name}>{obj.name}</p>
          {density === 1 && <p className="truncate text-[11px] text-muted tabular">{meta}</p>}
        </div>
      )}
    </div>
  );
});
