import { ArrowClockwiseIcon, FolderPlusIcon, LockIcon, UploadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { animate, motion, useIsPresent, useMotionValue, useScroll, useTransform } from "motion/react";
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
import { Cinema } from "./Cinema";
import { FolderTile, GridTile, ListRow, type TileHandlers } from "./Tile";

const EMPTY = new Set<string>();
const PULL = 72;
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
  const phoneCols = usePrefs(state => state.phoneCols);
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

  const gap = mobile ? (phoneCols === 4 ? 2 : 4) : 10;
  const minTile = mobile ? 150 : 190;
  const density = (mobile ? phoneCols - 2 : 0) as 0 | 1 | 2;
  const cols = view !== "grid" ? 1 : mobile ? phoneCols : Math.max(2, Math.floor((width + gap) / (minTile + gap)));
  const tileWidth = width ? (width - gap * (cols - 1)) / cols : minTile;
  const pad = density ? 8 : 12;
  const tileHeight = view === "grid" ? Math.round((tileWidth - pad) * 0.75 + pad + [60, 40, 22][density]) : 52;

  // Grid view: folders first (covers made of what is inside), then files as thumbnails. List view: one row per item.
  const rows = useMemo(() => {
    const out: { kind: "folders" | "files"; items: Obj[]; size: number; first: number }[] = [];
    const push = (kind: "folders" | "files", list: Obj[], per: number, height: number, offset: number, tail: number, spacing = gap): void => {
      for (let i = 0; i < list.length; i += per) {
        const last = i + per >= list.length;
        out.push({ kind, items: list.slice(i, i + per), size: height + (last ? tail : spacing), first: offset + i });
      }
    };
    if (view === "cinema") return out;
    if (view === "list") { push("files", items, 1, 52, 0, 0, 0); return out; }
    const folderList = items.filter(item => item.is_dir);
    const fileList = items.filter(item => !item.is_dir);
    push("folders", folderList, cols, tileHeight, 0, fileList.length ? 28 : 0);
    push("files", fileList, cols, tileHeight, folderList.length, gap);
    return out;
  }, [items, view, cols, tileHeight, gap]);

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

  useLayoutEffect(() => { flip.play(); }, [items, cols]);

  // Phones: pinch the grid to change the column count (2 to 4), like a photo library.
  const pinch = useRef<{ distance: number } | null>(null);
  const onTouchStart = (event: React.TouchEvent): void => {
    if (event.touches.length === 2 && view === "grid" && mobile) {
      const [a, b] = [event.touches[0], event.touches[1]];
      pinch.current = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
    } else if (event.touches.length === 1 && (scrollRef.current?.scrollTop ?? 1) <= 0) {
      pullStart.current = event.touches[0].clientY;
    }
  };
  const onTouchMove = (event: React.TouchEvent): void => {
    if (pinch.current && event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]];
      const ratio = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.current.distance;
      const current = usePrefs.getState().phoneCols;
      const next = ratio > 1.35 && current > 2 ? current - 1 : ratio < 0.74 && current < 4 ? current + 1 : current;
      if (next !== current) {
        flip.capture();
        usePrefs.getState().setPhoneCols(next as 2 | 3 | 4);
        navigator.vibrate?.(6);
        pinch.current = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
      }
      return;
    }
    if (pullStart.current !== null && event.touches.length === 1) {
      const dy = event.touches[0].clientY - pullStart.current;
      if ((scrollRef.current?.scrollTop ?? 1) > 0 || dy < 0) { pull.set(0); return; }
      const value = Math.min(140, dy * 0.55);
      if (value >= PULL && pull.get() < PULL) navigator.vibrate?.(8);
      pull.set(value);
    }
  };
  const onTouchEnd = (): void => {
    pinch.current = null;
    if (pullStart.current === null) return;
    pullStart.current = null;
    if (pull.get() >= PULL) {
      setRefreshing(true);
      animate(pull, PULL, spring.snappy);
      void actions.reload(path).finally(() => { setRefreshing(false); animate(pull, 0, spring.soft); });
    } else animate(pull, 0, spring.soft);
  };

  const pull = useMotionValue(0);
  const pullStart = useRef<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pullOpacity = useTransform(pull, [0, PULL], [0, 1]);
  const pullRotate = useTransform(pull, [0, 140], [0, 300]);
  const pullScale = useTransform(pull, [0, PULL], [0.5, 1]);
  const pullColor = useTransform(pull, v => v >= PULL ? "var(--accent)" : "var(--muted)");
  const pullY = useTransform(pull, [0, 140], [0, 40]);

  // iOS fires its own page-zoom gesture events; the grid pinch replaces that here.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !mobile) return;
    const stop = (event: Event): void => event.preventDefault();
    element.addEventListener("gesturestart", stop);
    element.addEventListener("gesturechange", stop);
    return () => { element.removeEventListener("gesturestart", stop); element.removeEventListener("gesturechange", stop); };
  }, [mobile]);

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
      onLongPress(obj: Obj, x: number, y: number) {
        // Touch: a long press starts selecting (like a photo library); once selecting, it opens the menu.
        const current = ui().selectionDir === path ? ui().selected : EMPTY;
        if (current.size === 0) { anchor.current = indexOf(obj); ui().toggle(path, obj.name); }
        else ui().openMenu({ x, y, dir: path, obj });
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
    if ((event.target as Element).closest(".tile, [data-name], button, a, input, textarea, form, .prose-ink")) return;
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
    body = <Skeleton view={view === "list" ? "list" : "grid"} cols={cols} />;
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
  } else if (view === "cinema") {
    body = <Cinema key={path} dir={path} items={items} handlers={handlers} />;
  } else {
    body = (
      <div key={view} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(virtual => {
          const row = rows[virtual.index];
          const Item = view === "list" ? ListRow : row.kind === "folders" ? FolderTile : GridTile;
          const per = view === "list" ? 1 : cols;
          return (
            <div
              key={virtual.key}
              className={view === "grid" ? "absolute inset-x-0 top-0 grid" : "absolute inset-x-0 top-0"}
              style={{
                transform: `translateY(${virtual.start - listTop}px)`,
                height: view === "list" ? 52 : tileHeight,
                gridTemplateColumns: view === "grid" ? `repeat(${per}, minmax(0, 1fr))` : undefined,
                columnGap: gap,
              }}
            >
              {row.items.map((obj, offset) => (
                <Item
                  key={obj.name}
                  density={density}
                  dir={path}
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
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      style={{ pointerEvents: present ? undefined : "none", touchAction: mobile ? "pan-x pan-y" : undefined }}
      onScroll={event => scrollPositions.set(path, event.currentTarget.scrollTop)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {mobile && (
        <div className="pointer-events-none sticky top-0 z-10 h-0">
          <motion.div className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+64px)] -ml-4 grid size-8 place-items-center rounded-full bg-raised hairline"
            style={{ opacity: pullOpacity, scale: pullScale, y: pullY, boxShadow: "var(--shadow-lift)" }}>
            <motion.span className={refreshing ? "spin block" : "block"} style={{ rotate: refreshing ? undefined : pullRotate, color: pullColor }}>
              <ArrowClockwiseIcon size={16} weight="bold" />
            </motion.span>
          </motion.div>
        </div>
      )}
      <div className="mx-auto w-full max-w-[1400px] px-3 pt-[calc(env(safe-area-inset-top)+68px)] sm:px-8 sm:pt-[96px]">
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
