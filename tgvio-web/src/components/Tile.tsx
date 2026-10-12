import { CheckIcon, DotsThreeIcon, FolderOpenIcon, PlayIcon } from "@phosphor-icons/react";
import { memo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent } from "react";
import { formatBytes, formatDate } from "../lib/format";
import { kindOf } from "../lib/kind";
import type { Obj } from "../lib/types";
import { KindIcon } from "./KindIcon";

export interface TileHandlers {
  onActivate: (obj: Obj, event: MouseEvent<HTMLElement>, element: HTMLElement) => void;
  onToggle: (obj: Obj, event: MouseEvent<HTMLElement>) => void;
  onMenu: (obj: Obj, x: number, y: number) => void;
  onHoverFolder: (obj: Obj) => void;
  onDragStart: (obj: Obj, event: DragEvent<HTMLElement>) => void;
  onDropInto: (obj: Obj, event: DragEvent<HTMLElement>) => void;
  canDrag: boolean;
}

interface TileProps {
  obj: Obj;
  index: number;
  selected: boolean;
  selecting: boolean;
  entering: boolean;
  handlers: TileHandlers;
}

const LONG_PRESS = 420;

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
      if (event.pointerType === "mouse") return;
      const start = { x: event.clientX, y: event.clientY };
      s.start = start;
      event.currentTarget.classList.add("reveal");
      s.timer = window.setTimeout(() => {
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
      className={`grid size-[22px] place-items-center rounded-full transition-all duration-300 ease-[var(--ease-expo)] ${on ? "bg-accent text-accent-ink scale-100" : "bg-black/35 text-transparent ring-1 ring-white/70 backdrop-blur-sm"} ${visible || on ? "opacity-100" : "opacity-0 group-hover/tile:opacity-100"}`}
    >
      <CheckIcon size={13} weight="bold" className={`transition-transform duration-300 ${on ? "scale-100" : "scale-50"}`} />
    </span>
  );
}

export const GridTile = memo(function GridTile({ obj, index, selected, selecting, entering, handlers }: TileProps) {
  const kind = kindOf(obj);
  const [broken, setBroken] = useState(false);
  const [dropping, setDropping] = useState(false);
  const press = useLongPress((x, y) => handlers.onMenu(obj, x, y));
  const thumb = obj.thumb && !broken;
  const meta = obj.is_dir ? formatDate(obj.modified) : `${formatBytes(obj.size)}`;

  return (
    <div
      data-flip={obj.name}
      data-name={obj.name}
      className={`tile spot group/tile relative rounded-[var(--radius-tile)] p-1.5 outline-none transition-[background-color,box-shadow] duration-300 ${entering ? "enter" : "enter-soft"} ${selected ? "bg-accent-soft" : "hover:bg-[var(--hover)]"} ${dropping ? "ring-2 ring-accent" : ""}`}
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
        {thumb ? (
          <img className="thumb absolute inset-0 size-full object-cover" src={obj.thumb} alt="" loading="lazy" decoding="async"
            referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(true)} />
        ) : obj.is_dir ? (
          <div className="absolute inset-0 grid place-items-center text-muted">
            <span className="relative block size-14">
              <KindIcon kind="folder" weight="duotone" className="absolute inset-0 size-full transition-all duration-500 ease-[var(--ease-expo)] group-hover/tile:scale-75 group-hover/tile:opacity-0" />
              <FolderOpenIcon weight="duotone" className="absolute inset-0 size-full scale-110 text-accent-text opacity-0 transition-all duration-500 ease-[var(--ease-expo)] group-hover/tile:scale-100 group-hover/tile:opacity-100" />
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
          className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-md transition-opacity duration-200 group-hover/tile:opacity-100 focus:opacity-100"
          aria-label="更多"
          onClick={event => { event.stopPropagation(); const r = event.currentTarget.getBoundingClientRect(); handlers.onMenu(obj, r.right, r.bottom); }}
        >
          <DotsThreeIcon size={16} weight="bold" />
        </button>
      </div>
      <div className="px-1 pt-2 pb-0.5">
        <p className="line-clamp-2 break-all text-[13.5px] font-medium leading-snug" title={obj.name}>{obj.name}</p>
        <p className="mt-0.5 truncate text-[12px] text-muted tabular">{meta}</p>
      </div>
    </div>
  );
});

export const ListRow = memo(function ListRow({ obj, index, selected, selecting, entering, handlers }: TileProps) {
  const kind = kindOf(obj);
  const [dropping, setDropping] = useState(false);
  const press = useLongPress((x, y) => handlers.onMenu(obj, x, y));
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
          <span data-thumb className={`grid size-8 place-items-center rounded-lg transition-all duration-300 ${selected || selecting ? "scale-0 opacity-0" : "group-hover/tile:scale-0 group-hover/tile:opacity-0"} ${obj.is_dir ? "text-ink group-hover/tile:text-accent-text" : "text-muted"}`}>
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

/** Folders in grid view: a compact card. Thumbnail space is for files that have something to show. */
export const FolderCard = memo(function FolderCard({ obj, index, selected, selecting, entering, handlers }: TileProps) {
  const [dropping, setDropping] = useState(false);
  const press = useLongPress((x, y) => handlers.onMenu(obj, x, y));
  return (
    <div
      data-flip={obj.name}
      data-name={obj.name}
      className={`tile spot group/tile relative flex h-full items-center gap-3 rounded-[var(--radius-tile)] px-3 outline-none transition-[background-color,box-shadow,transform] duration-300 ${entering ? "enter" : "enter-soft"} ${selected ? "bg-accent-soft" : "bg-surface hover:bg-raised"} ${dropping ? "scale-[1.03] ring-2 ring-accent" : ""}`}
      style={{ "--i": index, boxShadow: selected ? "inset 0 0 0 1px var(--accent)" : "inset 0 0 0 1px var(--line)" } as CSSProperties}
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
      onPointerEnter={() => handlers.onHoverFolder(obj)}
      onPointerDown={press.onPointerDown}
      onPointerUp={press.onPointerUp}
      onPointerCancel={press.onPointerCancel}
      onClick={event => { if (!press.consumed()) handlers.onActivate(obj, event, event.currentTarget); }}
      onContextMenu={event => { event.preventDefault(); handlers.onMenu(obj, event.clientX, event.clientY); }}
      onKeyDown={event => { if (event.key === "Enter") handlers.onActivate(obj, event as unknown as MouseEvent<HTMLElement>, event.currentTarget); }}
    >
      <button type="button" data-thumb className="relative grid size-9 shrink-0 place-items-center" aria-label={selected ? "取消选择" : "选择"}
        onClick={event => { event.stopPropagation(); handlers.onToggle(obj, event); }}>
        <span className={`absolute inset-0 grid place-items-center text-muted transition-all duration-300 ease-[var(--ease-expo)] ${selected || selecting ? "scale-50 opacity-0" : "group-hover/tile:text-accent-text"}`}>
          <KindIcon kind="folder" size={26} weight="duotone" className="transition-all duration-500 ease-[var(--ease-expo)] group-hover/tile:scale-0 group-hover/tile:opacity-0" />
          <FolderOpenIcon size={26} weight="duotone" className="absolute scale-50 opacity-0 transition-all duration-500 ease-[var(--ease-expo)] group-hover/tile:scale-100 group-hover/tile:opacity-100" />
        </span>
        <span className={`absolute inset-0 grid place-items-center transition-all duration-300 ${selected || selecting ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}><Check on={selected} visible /></span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium leading-snug" title={obj.name}>{obj.name}</p>
        <p className="truncate text-[12px] text-muted tabular">{formatDate(obj.modified)}</p>
      </div>
      <button type="button" className="grid size-7 shrink-0 place-items-center rounded-full text-muted opacity-0 transition-opacity hover:bg-[var(--hover)] hover:text-ink group-hover/tile:opacity-100 focus:opacity-100"
        aria-label="更多" onClick={event => { event.stopPropagation(); const r = event.currentTarget.getBoundingClientRect(); handlers.onMenu(obj, r.right, r.bottom); }}>
        <DotsThreeIcon size={16} weight="bold" />
      </button>
    </div>
  );
});
