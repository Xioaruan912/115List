import {
  ArrowRightIcon, CloudArrowDownIcon, DesktopIcon, EyeIcon, EyeSlashIcon, FolderPlusIcon, GaugeIcon, GearIcon, HardDrivesIcon,
  ListBulletsIcon, ListChecksIcon, MagnifyingGlassIcon, MoonIcon, SignOutIcon, SquaresFourIcon, SunIcon, UploadSimpleIcon, UsersIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { search, siteSearch } from "../api/fs";
import { passwordFor, useDir } from "../hooks/useDir";
import { kindOf } from "../lib/kind";
import { spring } from "../lib/motion";
import { encodePath, join } from "../lib/path";
import { can, isAdmin, isGuest, Perm } from "../lib/perm";
import { posterSrc } from "../api/posters";
import { usePrefs } from "../stores/prefs";
import { useSession } from "../stores/session";
import { useUi } from "../stores/ui";
import { useUploads } from "../stores/uploads";
import { pickFiles } from "./DirectoryView";
import { KindIcon } from "./KindIcon";
import { switchTheme } from "./theme";

interface Entry {
  id: string;
  section: string;
  label: string;
  detail?: string;
  icon: ReactNode;
  run: () => void;
}

function useDebounced<T>(value: T, ms: number): T {
  const [state, setState] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setState(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return state;
}

/** Fuzzy-ish match per whitespace token: every token's characters appear in order. Contiguous, early hits score higher. */
function tokenScore(t: string, q: string): number {
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct;
  let position = -1;
  let gaps = 0;
  for (const char of q) {
    const next = t.indexOf(char, position + 1);
    if (next < 0) return -1;
    gaps += next - position - 1;
    position = next;
  }
  return 500 - gaps;
}

export function score(text: string, query: string): number {
  const t = text.toLowerCase();
  let total = 0;
  for (const token of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const s = tokenScore(t, token);
    if (s < 0) return -1;
    total += s;
  }
  return total;
}

function PaletteBody({ path }: { path: string }) {
  const [, navigate] = useLocation();
  const setPalette = useUi(state => state.setPalette);
  const me = useSession(state => state.me);
  const settings = useSession(state => state.settings);
  const list = useDir(path);
  const view = usePrefs(state => state.view);
  const blur = usePrefs(state => state.blur);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(query.trim(), 320);
  const indexed = !!settings.search_index && settings.search_index !== "none";

  const remote = useQuery({
    queryKey: ["search", path, debounced],
    queryFn: () => search(path, debounced, 0, 40, passwordFor(path)),
    enabled: indexed && debounced.length >= 2,
    staleTime: 30_000,
    retry: false,
  });
  // Without OpenList's index (115 would have to be crawled): names of folders
  // already opened, and TMDB titles, from the server.
  const site = useQuery({
    queryKey: ["site-search", debounced],
    queryFn: () => siteSearch(debounced),
    enabled: !indexed && !isGuest(me) && debounced.length >= 1,
    staleTime: 30_000,
    retry: false,
  });

  const close = (): void => setPalette(false);

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim();
    const out: Entry[] = [];
    const items = list.data?.content ?? [];
    const local = q
      ? items.map(item => ({ item, s: score(item.name, q) })).filter(hit => hit.s >= 0).sort((a, b) => b.s - a.s).slice(0, 8).map(hit => hit.item)
      : [];
    for (const item of local) {
      out.push({
        id: `local:${item.name}`,
        section: "当前文件夹",
        label: item.name,
        icon: <KindIcon kind={kindOf(item)} size={16} weight={item.is_dir ? "duotone" : "regular"} />,
        run: () => {
          close();
          if (item.is_dir) navigate(encodePath(join(path, item.name)));
          else useUi.getState().openViewer(path, item.name, null);
        },
      });
    }
    for (const hit of site.data?.items ?? []) {
      const full = join(hit.parent, hit.name);
      out.push({
        id: `site:${full}`,
        section: "全站搜索",
        label: hit.poster ? `${hit.poster.title}${hit.poster.year ? ` (${hit.poster.year})` : ""}` : hit.name,
        detail: hit.poster ? full : hit.parent,
        icon: hit.poster?.poster
          ? <img src={posterSrc(hit.poster.poster, "w185")} alt="" className="h-[22px] w-[15px] rounded-[3px] object-cover" />
          : <KindIcon kind={kindOf({ name: hit.name, is_dir: hit.is_dir, type: 0 })} size={16} weight={hit.is_dir ? "duotone" : "regular"} />,
        run: () => {
          close();
          if (hit.is_dir) navigate(encodePath(full));
          else { navigate(encodePath(hit.parent)); setTimeout(() => useUi.getState().openViewer(hit.parent, hit.name, null), 450); }
        },
      });
    }
    for (const node of remote.data?.content ?? []) {
      const full = join(node.parent, node.name);
      out.push({
        id: `remote:${full}`,
        section: "全局搜索",
        label: node.name,
        detail: node.parent,
        icon: <KindIcon kind={kindOf(node)} size={16} weight={node.is_dir ? "duotone" : "regular"} />,
        run: () => {
          close();
          if (node.is_dir) navigate(encodePath(full));
          else { navigate(encodePath(node.parent)); setTimeout(() => useUi.getState().openViewer(node.parent, node.name, null), 450); }
        },
      });
    }
    const writable = can(me, Perm.Write, list.data?.write);
    const commands: Omit<Entry, "section">[] = [
      ...(writable ? [
        { id: "mkdir", label: "新建文件夹", icon: <FolderPlusIcon size={16} />, run: () => useUi.getState().openDialog({ kind: "mkdir", dir: path }) },
        { id: "upload", label: "上传文件", icon: <UploadSimpleIcon size={16} />, run: () => { close(); pickFiles(files => useUploads.getState().add(path, files)); } },
      ] : []),
      ...(can(me, Perm.Offline) ? [{ id: "offline", label: "离线下载", icon: <CloudArrowDownIcon size={16} />, run: () => useUi.getState().openDialog({ kind: "offline", dir: path }) }] : []),
      { id: "view", label: view === "grid" ? "切换到列表视图" : "切换到网格视图", icon: view === "grid" ? <ListBulletsIcon size={16} /> : <SquaresFourIcon size={16} />, run: () => { usePrefs.getState().setView(view === "grid" ? "list" : "grid"); close(); } },
      { id: "blur", label: blur ? "显示封面" : "模糊封面", icon: blur ? <EyeIcon size={16} /> : <EyeSlashIcon size={16} />, run: () => { usePrefs.getState().setBlur(!blur); close(); } },
      { id: "dark", label: "深色主题", icon: <MoonIcon size={16} />, run: () => { close(); switchTheme("dark"); } },
      { id: "light", label: "浅色主题", icon: <SunIcon size={16} />, run: () => { close(); switchTheme("light"); } },
      { id: "system", label: "跟随系统主题", icon: <DesktopIcon size={16} />, run: () => { close(); switchTheme("system"); } },
      { id: "transfers", label: "传输与任务", icon: <ListChecksIcon size={16} />, run: () => { close(); useUi.getState().setUploads(true); } },
      ...(isAdmin(me) ? [
        { id: "m-overview", label: "管理：概览", icon: <GaugeIcon size={16} />, run: () => { close(); navigate("/@manage"); } },
        { id: "m-storages", label: "管理：存储", icon: <HardDrivesIcon size={16} />, run: () => { close(); navigate("/@manage/storages"); } },
        { id: "m-users", label: "管理：用户", icon: <UsersIcon size={16} />, run: () => { close(); navigate("/@manage/users"); } },
        { id: "m-settings", label: "管理：设置", icon: <GearIcon size={16} />, run: () => { close(); navigate("/@manage/settings"); } },
      ] : []),
      { id: "logout", label: "退出登录", icon: <SignOutIcon size={16} />, run: () => { close(); void useSession.getState().signOut(); } },
    ];
    const matched = q ? commands.map(command => ({ command, s: score(command.label, q) })).filter(hit => hit.s >= 0).sort((a, b) => b.s - a.s).map(hit => hit.command) : commands;
    if (q.startsWith("/") && !q.includes(" ")) {
      out.unshift({ id: "goto", section: "跳转", label: `打开 ${q}`, icon: <ArrowRightIcon size={16} />, run: () => { close(); navigate(encodePath(q)); } });
    }
    out.push(...matched.map(command => ({ ...command, section: "命令" })));
    return out;
  }, [query, list.data, remote.data, site.data, me, path, view, blur, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (event: React.KeyboardEvent): void => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(entries.length - 1, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); entries[active]?.run(); }
    else if (event.key === "Escape") { event.preventDefault(); close(); }
  };

  let lastSection = "";
  return (
    <div className="fixed inset-0 z-50 flex justify-center px-3 pt-[max(12px,env(safe-area-inset-top))] sm:pt-[12vh]">
      <motion.div className="absolute inset-0 bg-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
      <motion.div
        layoutId="palette"
        transition={spring.sheet}
        className="relative flex h-fit max-h-[min(560px,80dvh)] w-full max-w-[620px] flex-col overflow-hidden bg-raised hairline"
        style={{ borderRadius: 18, boxShadow: "var(--shadow-float)" }}
        onKeyDown={onKey}
      >
        <motion.div className="flex items-center gap-3 border-b border-line px-4" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.08 } }}>
          <MagnifyingGlassIcon size={18} className="shrink-0 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索文件、片名，或输入命令"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
            aria-label="搜索"
          />
          {(remote.isFetching || site.isFetching) && <span className="spin size-4 rounded-full border-2 border-line-strong border-t-accent" />}
          <kbd className="rounded-md px-1.5 py-0.5 font-mono text-[11px] text-faint hairline">Esc</kbd>
        </motion.div>
        <div ref={listRef} className="min-h-0 overflow-y-auto p-2" role="listbox">
          {entries.length === 0 && <p className="px-3 py-8 text-center text-muted">没有匹配的结果</p>}
          {entries.map((entry, index) => {
            const heading = entry.section !== lastSection ? entry.section : null;
            lastSection = entry.section;
            return (
              <div key={entry.id}>
                {heading && <p className="px-3 pb-1 pt-3 text-[12px] font-medium text-faint first:pt-1">{heading}</p>}
                <button
                  data-index={index}
                  role="option"
                  aria-selected={index === active}
                  className="relative flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left"
                  onPointerMove={() => setActive(index)}
                  onClick={entry.run}
                >
                  {index === active && <motion.span layoutId="palette-hl" className="absolute inset-0 rounded-xl bg-[var(--hover)]" transition={spring.snappy} />}
                  {index === active && <motion.span layoutId="palette-bar" className="absolute left-0 top-2.5 h-6 w-[3px] rounded-full bg-accent" transition={spring.snappy} />}
                  <span className="relative shrink-0 text-muted">{entry.icon}</span>
                  <span className="relative min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.detail && <span className="relative max-w-[45%] truncate text-[12px] text-faint">{entry.detail}</span>}
                </button>
              </div>
            );
          })}
          {site.data && query.trim() && (
            <p className="px-3 pb-1 pt-3 text-[11.5px] text-faint tabular">全站搜索覆盖打开过的 {site.data.folders} 个文件夹和 TMDB 片名；没打开过的文件夹，进去一次就能搜到</p>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export function Palette({ path }: { path: string }) {
  const open = useUi(state => state.palette);
  return createPortal(<AnimatePresence>{open && <PaletteBody key="palette" path={path} />}</AnimatePresence>, document.body);
}
