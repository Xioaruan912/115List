import { ArrowClockwiseIcon, FolderPlusIcon, LockIcon, UploadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { motion, useIsPresent, useScroll, useTransform } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type MouseEvent, type PointerEvent } from "react";
import { useLocation } from "wouter";
import { dirKey, needsPassword, prefetchDir, rememberPassword, useDir } from "../hooks/useDir";
import { useIsMobile } from "../hooks/useMedia";
import { useWidth } from "../hooks/useSize";
import * as actions from "../lib/actions";
import * as flip from "../lib/flip";
import { formatBytes } from "../lib/format";
import { spring } from "../lib/motion";
import { basename, encodePath, join } from "../lib/path";
import { can, Perm } from "../lib/perm";
import { sortObjs } from "../lib/sort";
import type { Obj } from "../lib/types";
import { usePrefs, type SortKey } from "../stores/prefs";
import { useSession } from "../stores/session";
import { rectOf, useUi } from "../stores/ui";
import { Readme } from "./Readme";
import { SplitText } from "./SplitText";
import { FolderCard, GridTile, ListRow, type TileHandlers } from "./Tile";

const EMPTY = new Set<string>();
const scrollPositions = new Map<string, number>();

/** Where the last folder was opened from, so the next view can zoom out of that point. */
export const navOrigin = { x: 0.5, y: 0.3 };

export function pickFiles(onFiles: (files: { file: File; name: string }[]) => void, directory = false): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  if (directory) input.webkitdirectory = true;
  input.onchange = () => {
    const files = [...(input.files ?? [])].map(file => ({ file, name: file.webkitRelativePath || file.name }));
    if (files.length) onFiles(files);
  };
  input.click();
}

function SortControl({ path }: { path: string }) {
  const sortKey = usePrefs(state => state.sortKey);
  const sortDesc = usePrefs(state => state.sortDesc);
  const setSort = usePrefs(state => state.setSort);
  const options: [SortKey, string][] = [["name", "名称"], ["modified", "时间"], ["size", "大小"]];
  return (
    <div className="flex items-center gap-1 text-[13px]" role="group" aria-label="排序">
      {options.map(([key, label]) => {
        const active = key === sortKey;
        return (
          <button
            key={key}
            className={`relative h-8 rounded-lg px-2.5 transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}
            onClick={() => { flip.capture(); setSort(key); }}
            aria-pressed={active}
          >
            {active && <motion.span layoutId={`sort-${path}`} className="absolute inset-0 rounded-lg bg-[var(--hover)]" transition={spring.snappy} />}
            <span className="relative inline-flex items-center gap-1">
              {label}
              {active && (
                <motion.span animate={{ rotate: sortDesc ? 180 : 0 }} transition={spring.bouncy} className="inline-block text-[10px]">▲</motion.span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PasswordGate({ path, onUnlock }: { path: string; onUnlock: () => void }) {
  const [value, setValue] = useState("");
  const [shake, setShake] = useState(0);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!value) { setShake(n => n + 1); return; }
    rememberPassword(path, value);
    onUnlock();
  };
  return (
    <motion.form
      onSubmit={submit}
      key={shake}
      animate={shake ? { x: [0, -10, 9, -6, 4, 0] } : undefined}
      transition={{ duration: 0.45 }}
      className="mx-auto mt-10 flex w-full max-w-sm flex-col items-start gap-4 px-5"
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-surface text-accent-text hairline"><LockIcon size={22} weight="duotone" /></span>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">这个文件夹需要密码</h2>
        <p className="mt-1 text-muted">密码只保存在本次浏览会话里。</p>
      </div>
      <label className="w-full">
        <span className="label">密码</span>
        <input className="field" type="password" autoFocus value={value} onChange={event => setValue(event.target.value)} />
      </label>
      <button className="btn btn-primary" type="submit">打开</button>
    </motion.form>
  );
}

function Skeleton({ view, cols }: { view: "grid" | "list"; cols: number }) {
  const count = view === "grid" ? Math.max(cols, 2) * 2 : 10;
  return (
    <div className={view === "grid" ? "grid gap-2.5" : "flex flex-col gap-1"} style={view === "grid" ? { gridTemplateColumns: `repeat(${Math.max(cols, 2)}, minmax(0, 1fr))` } : undefined}>
      {Array.from({ length: count }, (_, index) => view === "grid" ? (
        <div key={index} className="enter p-1.5" style={{ "--i": index } as React.CSSProperties}>
          <div className="skeleton aspect-[4/3] rounded-[10px]" />
          <div className="skeleton mt-2.5 h-3.5 w-3/4 rounded" />
          <div className="skeleton mt-1.5 h-3 w-1/3 rounded" />
        </div>
      ) : (
        <div key={index} className="enter flex h-[52px] items-center gap-3 px-3" style={{ "--i": index } as React.CSSProperties}>
          <div className="skeleton size-8 rounded-lg" /><div className="skeleton h-3.5 rounded" style={{ width: `${30 + ((index * 37) % 45)}%` }} />
        </div>
      ))}
    </div>
  );
}

export function DirectoryView({ path }: { path: string }) {
  const present = useIsPresent();
  const query = useDir(path);
  const client = useQueryClient();
  const [, navigate] = useLocation();
  const view = usePrefs(state => state.view);
  const sortKey = usePrefs(state => state.sortKey);
  const sortDesc = usePrefs(state => state.sortDesc);
  const me = useSession(state => state.me);
  const siteTitle = useSession(state => state.settings.site_title);
  const selected = useUi(state => state.selectionDir === path ? state.selected : EMPTY);
  const mobile = useIsMobile();

  const items = useMemo(() => sortObjs(query.data?.content ?? [], sortKey, sortDesc), [query.data, sortKey, sortDesc]);
  const writable = can(me, Perm.Write, query.data?.write);

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const width = useWidth(listRef);
  const [listTop, setListTop] = useState(0);
  const [entering, setEntering] = useState(true);
  const anchor = useRef(-1);

  useEffect(() => {
    setEntering(true);
    const timer = setTimeout(() => setEntering(false), 1400);
    return () => clearTimeout(timer);
  }, [view]);

  const gap = mobile ? 6 : 10;
  const minTile = mobile ? 150 : 190;
  const minFolder = mobile ? 160 : 230;
  const cols = view === "grid" ? Math.max(2, Math.floor((width + gap) / (minTile + gap))) : 1;
  const folderCols = view === "grid" ? Math.max(2, Math.floor((width + gap) / (minFolder + gap))) : 1;
  const tileWidth = width ? (width - gap * (cols - 1)) / cols : minTile;
  const tileHeight = view === "grid" ? Math.round((tileWidth - 12) * 0.75 + 12 + 60) : 52;
  const folderHeight = view === "grid" ? 60 : 52;

  // Grid view: folders first as compact cards, then files as thumbnails. List view: one row per item.
  const rows = useMemo(() => {
    const out: { kind: "folders" | "files"; items: Obj[]; size: number; first: number }[] = [];
    const push = (kind: "folders" | "files", list: Obj[], per: number, height: number, offset: number, tail: number, spacing = gap): void => {
      for (let i = 0; i < list.length; i += per) {
        const last = i + per >= list.length;
        out.push({ kind, items: list.slice(i, i + per), size: height + (last ? tail : spacing), first: offset + i });
      }
    };
    if (view === "list") { push("files", items, 1, 52, 0, 0, 0); return out; }
    const folderList = items.filter(item => item.is_dir);
    const fileList = items.filter(item => !item.is_dir);
    push("folders", folderList, folderCols, folderHeight, 0, fileList.length ? 28 : 0);
    push("files", fileList, cols, tileHeight, folderList.length, gap);
    return out;
  }, [items, view, cols, folderCols, tileHeight, folderHeight, gap]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => rows[index]?.size ?? tileHeight,
    overscan: 4,
    scrollMargin: listTop,
    useFlushSync: false,
  });
  useEffect(() => { virtualizer.measure(); }, [rows, virtualizer]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = (): void => setListTop(list.offsetTop);
    update();
    const observer = new ResizeObserver(update);
    if (list.parentElement) observer.observe(list.parentElement);
    return () => observer.disconnect();
  }, []);

  // Come back to where this folder was scrolled to.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !query.data || !scrollRef.current) return;
    restored.current = true;
    const saved = scrollPositions.get(path);
    if (saved) scrollRef.current.scrollTop = saved;
  }, [query.data, path]);

  useLayoutEffect(() => { flip.play(); }, [items]);

  const { scrollY } = useScroll({ container: scrollRef });
  const titleScale = useTransform(scrollY, [0, 140], [1, 0.9]);
  const titleOpacity = useTransform(scrollY, [0, 140], [1, 0.25]);
  const titleY = useTransform(scrollY, [0, 140], [0, 24]);

  const selecting = selected.size > 0;

  const handlers: TileHandlers = useMemo(() => {
    const ui = useUi.getState;
    const indexOf = (obj: Obj): number => items.findIndex(item => item.name === obj.name);
    return {
      canDrag: !mobile && can(me, Perm.Move),
      onActivate(obj: Obj, event: MouseEvent<HTMLElement>, element: HTMLElement) {
        const index = indexOf(obj);
        const current = ui().selectionDir === path ? ui().selected : EMPTY;
        if (event.shiftKey && anchor.current >= 0) {
          const [from, to] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
          ui().select(path, [...current, ...items.slice(from, to + 1).map(item => item.name)]);
          return;
        }
        if (event.metaKey || event.ctrlKey || current.size > 0) {
          anchor.current = index;
          ui().toggle(path, obj.name);
          return;
        }
        if (obj.is_dir) {
          const rect = element.getBoundingClientRect();
          navOrigin.x = (rect.left + rect.width / 2) / window.innerWidth;
          navOrigin.y = (rect.top + rect.height / 2) / window.innerHeight;
          navigate(encodePath(join(path, obj.name)));
        } else {
          ui().openViewer(path, obj.name, rectOf(element.querySelector("[data-thumb]") ?? element));
        }
      },
      onToggle(obj: Obj, event: MouseEvent<HTMLElement>) {
        const index = indexOf(obj);
        if (event.shiftKey && anchor.current >= 0) {
          const current = ui().selectionDir === path ? ui().selected : EMPTY;
          const [from, to] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
          ui().select(path, [...current, ...items.slice(from, to + 1).map(item => item.name)]);
          return;
        }
        anchor.current = index;
        ui().toggle(path, obj.name);
      },
      onMenu(obj: Obj, x: number, y: number) {
        ui().openMenu({ x, y, dir: path, obj });
      },
      onHoverFolder(obj: Obj) {
        if (mobile) return;
        const target = join(path, obj.name);
        const timer = setTimeout(() => prefetchDir(client, target), 220);
        const cancel = (): void => clearTimeout(timer);
        document.addEventListener("pointermove", function check(event) {
          const over = (event.target as Element | null)?.closest?.("[data-name]");
          if (over?.getAttribute("data-name") !== obj.name) { cancel(); document.removeEventListener("pointermove", check); }
        });
      },
      onDragStart(obj: Obj, event: DragEvent<HTMLElement>) {
        const current = ui().selectionDir === path ? ui().selected : EMPTY;
        const names = current.has(obj.name) ? [...current] : [obj.name];
        event.dataTransfer.setData("application/x-tgvio", JSON.stringify({ dir: path, names }));
        event.dataTransfer.effectAllowed = "move";
        const ghost = document.createElement("div");
        ghost.textContent = names.length === 1 ? names[0] : `${names.length} 项`;
        ghost.style.cssText = "position:fixed;top:-100px;left:0;padding:6px 12px;border-radius:999px;font:500 13px var(--font-sans);background:var(--accent);color:var(--accent-ink);max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        document.body.append(ghost);
        event.dataTransfer.setDragImage(ghost, 16, 16);
        setTimeout(() => ghost.remove(), 0);
      },
      onDropInto(folder: Obj, event: DragEvent<HTMLElement>) {
        event.preventDefault();
        const raw = event.dataTransfer.getData("application/x-tgvio");
        if (!raw) return;
        const data = JSON.parse(raw) as { dir: string; names: string[] };
        const names = data.names.filter(name => !(data.dir === path && name === folder.name));
        if (names.length) void actions.transfer("move", data.dir, join(path, folder.name), names);
      },
    };
  }, [items, path, mobile, me, client, navigate]);

  // Rubber-band selection on empty space (mouse only).
  const marquee = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; base: Set<string>; moved: boolean; frame: number } | null>(null);
  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if ((event.target as Element).closest(".tile, button, a, input, textarea, form, .prose-ink")) return;
    const current = useUi.getState().selectionDir === path ? useUi.getState().selected : EMPTY;
    drag.current = { x: event.clientX, y: event.clientY, base: event.shiftKey || event.metaKey || event.ctrlKey ? new Set(current) : new Set(), moved: false, frame: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [path]);
  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const box = marquee.current;
    if (!state || !box) return;
    const x = Math.min(state.x, event.clientX);
    const y = Math.min(state.y, event.clientY);
    const w = Math.abs(event.clientX - state.x);
    const h = Math.abs(event.clientY - state.y);
    if (!state.moved && w + h < 6) return;
    state.moved = true;
    box.style.display = "block";
    box.style.transform = `translate(${x}px, ${y}px)`;
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;
    cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(() => {
      const hit = new Set(state.base);
      for (const element of scrollRef.current?.querySelectorAll<HTMLElement>("[data-flip]") ?? []) {
        const r = element.getBoundingClientRect();
        if (r.right > x && r.left < x + w && r.bottom > y && r.top < y + h) hit.add(element.dataset.flip!);
      }
      useUi.getState().select(path, hit);
    });
  }, [path]);
  const onPointerUp = useCallback(() => {
    const state = drag.current;
    drag.current = null;
    if (marquee.current) marquee.current.style.display = "none";
    if (state && !state.moved) useUi.getState().clearSelection();
  }, []);

  const folders = items.filter(item => item.is_dir).length;
  const files = items.length - folders;
  const bytes = items.reduce((sum, item) => sum + (item.is_dir ? 0 : item.size), 0);
  const title = path === "/" ? siteTitle || "OpenList" : basename(path);

  const upload = (): void => pickFiles(files => void import("../stores/uploads").then(({ useUploads }) => useUploads.getState().add(path, files)));

  let body: React.ReactNode;
  if (query.isPending) {
    body = <Skeleton view={view} cols={cols} />;
  } else if (query.isError && needsPassword(query.error)) {
    body = <PasswordGate path={path} onUnlock={() => void client.resetQueries({ queryKey: dirKey(path) })} />;
  } else if (query.isError) {
    body = (
      <div className="mt-8 flex max-w-md flex-col items-start gap-3 enter">
        <WarningCircleIcon size={28} className="text-danger" weight="duotone" />
        <p className="font-medium">读取失败</p>
        <p className="break-words text-muted">{query.error.message}</p>
        <button className="btn btn-line" onClick={() => void query.refetch()}><ArrowClockwiseIcon size={16} />重试</button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="mt-6 flex flex-col items-start gap-4 enter">
        <p className="text-muted">这个文件夹是空的。{writable ? "把文件拖进窗口，或者：" : ""}</p>
        {writable && (
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={upload}><UploadSimpleIcon size={16} />上传文件</button>
            <button className="btn btn-line" onClick={() => useUi.getState().openDialog({ kind: "mkdir", dir: path })}><FolderPlusIcon size={16} />新建文件夹</button>
          </div>
        )}
      </div>
    );
  } else {
    body = (
      <div key={view} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(virtual => {
          const row = rows[virtual.index];
          const Item = view === "list" ? ListRow : row.kind === "folders" ? FolderCard : GridTile;
          const per = view === "list" ? 1 : row.kind === "folders" ? folderCols : cols;
          return (
            <div
              key={virtual.key}
              className={view === "grid" ? "absolute inset-x-0 top-0 grid" : "absolute inset-x-0 top-0"}
              style={{
                transform: `translateY(${virtual.start - listTop}px)`,
                height: view === "list" ? 52 : row.kind === "folders" ? folderHeight : tileHeight,
                gridTemplateColumns: view === "grid" ? `repeat(${per}, minmax(0, 1fr))` : undefined,
                columnGap: gap,
              }}
            >
              {row.items.map((obj, offset) => (
                <Item
                  key={obj.name}
                  obj={obj}
                  index={virtual.index * Math.min(per, 4) + offset}
                  selected={selected.has(obj.name)}
                  selecting={selecting}
                  entering={entering}
                  handlers={handlers}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      data-view={present ? "active" : "leaving"}
      className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain"
      style={{ pointerEvents: present ? undefined : "none" }}
      onScroll={event => scrollPositions.set(path, event.currentTarget.scrollTop)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="mx-auto w-full max-w-[1400px] px-3 pt-[calc(env(safe-area-inset-top)+76px)] sm:px-8 sm:pt-[96px]">
        <motion.header style={{ scale: titleScale, opacity: titleOpacity, y: titleY, transformOrigin: "0% 100%" }} className="px-2 pb-5 sm:px-0">
          <h1 className="text-[clamp(30px,5.4vw,56px)] font-semibold leading-[1.06] tracking-[-0.04em] break-words">
            <SplitText key={title} text={title} />
          </h1>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <p className="text-[13px] text-muted tabular enter" style={{ "--i": 6 } as React.CSSProperties}>
              {query.data ? (
                <>
                  {folders > 0 && <span className="mr-4">{folders} 个文件夹</span>}
                  {files > 0 && <span className="mr-4">{files} 个文件</span>}
                  {bytes > 0 && <span>{formatBytes(bytes)}</span>}
                </>
              ) : " "}
            </p>
            {items.length > 1 && <SortControl path={path} />}
          </div>
        </motion.header>
        <div ref={listRef}>{body}</div>
      </div>
      {query.data && <Readme dir={path} readme={query.data.readme} items={items} />}
      <div className="h-36" aria-hidden />
      <div ref={marquee} className="pointer-events-none fixed left-0 top-0 z-40 hidden rounded-md border border-accent bg-accent-soft" />
    </div>
  );
}
