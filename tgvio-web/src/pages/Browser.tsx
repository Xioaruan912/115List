import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ContextMenu } from "../components/ContextMenu";
import { Dialogs } from "../components/Dialogs";
import { Dock } from "../components/Dock";
import { DropZone } from "../components/DropZone";
import { Palette } from "../components/Palette";
import { Stage } from "../components/Stage";
import { TopBar } from "../components/TopBar";
import { Transfers } from "../components/Transfers";
import { useDir } from "../hooks/useDir";
import { encodePath, parent } from "../lib/path";
import { can, isGuest, Perm } from "../lib/perm";
import { useToasts } from "../stores/toast";
import { useUploads } from "../stores/uploads";
import { usePrefs } from "../stores/prefs";
import { useSession } from "../stores/session";
import { useUi } from "../stores/ui";

// The viewer (and the video player in it) loads the first time something is
// opened, and stays so its closing animation can play.
const Viewer = lazy(() => import("../components/Viewer").then(m => ({ default: m.Viewer })));
import { fromList } from "../lib/magnets";

function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
}

/** Keyboard: / or Ctrl K search, Backspace up, Ctrl A select all, Delete, F2 rename, Esc clear. */
function useShortcuts(path: string) {
  const [, navigate] = useLocation();
  const list = useDir(path);
  const me = useSession(state => state.me);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const ui = useUi.getState();
      if (typing(event.target) || ui.viewer || ui.dialog || ui.palette) return;
      const mod = event.metaKey || event.ctrlKey;
      const items = list.data?.content ?? [];
      const selected = ui.selectionDir === path ? [...ui.selected] : [];
      if (event.key === "/" || (mod && event.key.toLowerCase() === "k")) { event.preventDefault(); ui.setPalette(true); }
      else if (event.key === "Backspace" && path !== "/") { event.preventDefault(); navigate(encodePath(parent(path))); }
      else if (mod && event.key.toLowerCase() === "a") { event.preventDefault(); ui.select(path, items.map(item => item.name)); }
      else if (event.key === "Escape" && selected.length) ui.clearSelection();
      else if ((event.key === "Delete" || (event.key === "Backspace" && mod)) && selected.length && can(me, Perm.Remove)) ui.openDialog({ kind: "delete", dir: path, names: selected });
      else if (event.key === "F2" && selected.length === 1 && can(me, Perm.Rename)) {
        const obj = items.find(item => item.name === selected[0]);
        if (obj) { event.preventDefault(); ui.openDialog({ kind: "rename", dir: path, obj }); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path, list.data, me, navigate]);
}

/** Uploads left unfinished on an earlier visit: say so once, with a way to them. */
function useUnfinishedUploads(): void {
  const me = useSession(state => state.me);
  useEffect(() => {
    if (!me || isGuest(me)) return;
    void useUploads.getState().loadResumable().then(() => {
      const list = useUploads.getState().resumable;
      if (!list.length) return;
      useToasts.getState().push({
        tone: "info",
        title: list.length === 1 ? `「${list[0].name}」还没传完` : `${list.length} 个上传还没传完`,
        detail: "已传的部分在服务器上，选同一个文件就能接着传",
        action: { label: "查看", run: () => useUi.getState().setUploads(true) },
      }, 9000);
    });
  }, [me]);
}

export function Browser({ path }: { path: string }) {
  const opened = useUi(state => !!state.viewer);
  const [viewerWanted, setViewerWanted] = useState(opened);
  if (opened && !viewerWanted) setViewerWanted(true);
  const blur = usePrefs(state => state.blur);
  const me = useSession(state => state.me);
  useUnfinishedUploads();
  const list = useDir(path);
  useShortcuts(path);

  // Leaving a folder drops its selection; the viewer and menus close too.
  useEffect(() => {
    const ui = useUi.getState();
    if (ui.selectionDir && ui.selectionDir !== path) ui.clearSelection();
    ui.closeMenu();
  }, [path]);

  // The 送回影视库 bookmarklet opens the library root with a site page's magnets in #resources= (never sent to a server).
  useEffect(() => {
    const raw = /^#resources=(.+)$/.exec(location.hash)?.[1];
    if (!raw) return;
    history.replaceState(null, "", location.pathname + location.search);
    try {
      const items = fromList(JSON.parse(decodeURIComponent(raw)) as { u: string; t?: string; x?: string }[]);
      if (items.length) useUi.getState().openDialog({ kind: "resources", items });
    } catch { /* not ours */ }
  }, []);

  useEffect(() => {
    const title = useSession.getState().settings.site_title || "OpenList";
    document.title = path === "/" ? title : `${path.split("/").pop()} - ${title}`;
  }, [path]);

  return (
    <div className={blur ? "cover-blur" : ""}
      onContextMenu={event => {
        if ((event.target as Element).closest(".tile, .poster-cell, input, textarea, a, [role=dialog]")) return;
        event.preventDefault();
        useUi.getState().openMenu({ x: event.clientX, y: event.clientY, dir: path, obj: null });
      }}>
      <Stage path={path} />
      <TopBar path={path} />
      <Dock path={path} />
      <ContextMenu />
      <Dialogs />
      {viewerWanted && <Suspense fallback={null}><Viewer /></Suspense>}
      <Palette path={path} />
      <Transfers />
      <DropZone dir={path} enabled={can(me, Perm.Write, list.data?.write)} />
    </div>
  );
}
