import {
  TextAaIcon,
  ArrowClockwiseIcon, ArrowsLeftRightIcon, CheckSquareIcon, ChecksIcon, CloudArrowDownIcon, DotsThreeIcon, CopyIcon, DownloadSimpleIcon, FolderPlusIcon,
  GearIcon, LinkIcon, MagnetIcon, ShareNetworkIcon, ListChecksIcon, MagnifyingGlassIcon, PencilSimpleIcon, TrashIcon, UploadSimpleIcon, XIcon, FolderSimpleIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useDir } from "../hooks/useDir";
import { useLibraryScope } from "../hooks/useLibraryScope";
import { useResourceRoot } from "../hooks/useResourceRoot";
import { useCanHover, useIsMobile } from "../hooks/useMedia";
import * as actions from "../lib/actions";
import { spring } from "../lib/motion";
import { can, isAdmin, isGuest, Perm } from "../lib/perm";
import { useSession } from "../stores/session";
import { useUi } from "../stores/ui";
import { useUploads } from "../stores/uploads";
import { pickFiles } from "./DirectoryView";
import { Menu } from "./Menu";
import { NumberRoll } from "./NumberRoll";
import { Ring } from "./Ring";

/** One dock button. On desktop it swells as the pointer nears, like the macOS dock (scale only). */
function DockButton({ label, onClick, children, mouseX, magnify, active, badge }: {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  mouseX: MotionValue<number>;
  magnify: boolean;
  active?: boolean;
  badge?: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const distance = useTransform(mouseX, x => {
    const rect = ref.current?.getBoundingClientRect();
    return rect && Number.isFinite(x) ? x - (rect.left + rect.width / 2) : 999;
  });
  const target = useTransform(distance, [-120, 0, 120], [1, magnify ? 1.38 : 1, 1], { clamp: true });
  const scale = useSpring(target, { stiffness: 420, damping: 26, mass: 0.5 });
  const y = useTransform(scale, [1, 1.38], [0, -7]);
  return (
    <motion.button
      ref={ref}
      style={{ scale, y, transformOrigin: "50% 100%" }}
      whileTap={{ scale: 0.86 }}
      className={`group/dock relative grid size-11 place-items-center rounded-[14px] transition-colors ${active ? "bg-accent text-accent-ink" : "text-ink hover:bg-[var(--hover)]"}`}
      onClick={onClick}
      aria-label={label}
    >
      {children}
      {badge}
      <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[12px] font-medium text-bg opacity-0 transition duration-200 group-hover/dock:translate-y-0 group-hover/dock:opacity-100 [@media(hover:none)]:hidden">
        {label}
      </span>
    </motion.button>
  );
}

function UploadsBadge() {
  const jobs = useUploads(state => state.jobs);
  const active = jobs.filter(job => job.state === "running" || job.state === "queued");
  if (!active.length) return null;
  const total = active.reduce((sum, job) => sum + job.size, 0) || 1;
  const sent = active.reduce((sum, job) => sum + job.sent, 0);
  return (
    <span className="pointer-events-none absolute inset-0 grid place-items-center">
      <Ring value={sent / total} size={40} stroke={2} track={false} />
    </span>
  );
}

export function Dock({ path }: { path: string }) {
  const [, navigate] = useLocation();
  const me = useSession(state => state.me);
  const list = useDir(path);
  const selected = useUi(state => state.selectionDir === path ? state.selected : null);
  const openDialog = useUi(state => state.openDialog);
  const setPalette = useUi(state => state.setPalette);
  const setUploads = useUi(state => state.setUploads);
  const uploadsOpen = useUi(state => state.uploads);
  const addUploads = useUploads(state => state.add);
  const hasJobs = useUploads(state => state.jobs.length > 0);
  const mobile = useIsMobile();
  const magnify = useCanHover();
  const mouseX = useMotionValue(Number.POSITIVE_INFINITY);
  const [uploadMenu, setUploadMenu] = useState<{ x: number; y: number } | null>(null);

  const items = list.data?.content ?? [];
  const writable = can(me, Perm.Write, list.data?.write);
  // 115 storages take share links straight into the folder.
  const on115 = writable && /115/.test(list.data?.provider ?? "");
  const count = selected?.size ?? 0;
  const chosen = items.filter(item => selected?.has(item.name));
  const library = useLibraryScope();
  const resourceRoot = useResourceRoot();

  const dockContent = (
    <motion.div key="dock" className="flex items-end gap-1"
      initial={{ opacity: 0, scale: 0.9, filter: "blur(6px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, scale: 0.9, filter: "blur(6px)" }} transition={spring.snappy}>
      {resourceRoot.at(path) && (
        <DockButton label="找资源" mouseX={mouseX} magnify={magnify} onClick={() => openDialog({ kind: "resources" })}>
          <MagnetIcon size={20} />
        </DockButton>
      )}
      {writable && (
        <DockButton label="上传" mouseX={mouseX} magnify={magnify}
          onClick={event => { const r = event.currentTarget.getBoundingClientRect(); setUploadMenu({ x: r.left, y: r.top - 8 }); }}>
          <UploadSimpleIcon size={20} />
        </DockButton>
      )}
      {writable && (
        <DockButton label="新建文件夹" mouseX={mouseX} magnify={magnify} onClick={() => openDialog({ kind: "mkdir", dir: path })}>
          <FolderPlusIcon size={20} />
        </DockButton>
      )}
      <DockButton label="刷新" mouseX={mouseX} magnify={magnify} onClick={event => {
        const icon = event.currentTarget.querySelector("svg");
        icon?.animate([{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], { duration: 700, easing: "cubic-bezier(0.16,1,0.3,1)" });
        void actions.reload(path, true, true);
      }}>
        <ArrowClockwiseIcon size={20} />
      </DockButton>
      {mobile && (
        <DockButton label="搜索" mouseX={mouseX} magnify={false} onClick={() => setPalette(true)}>
          <MagnifyingGlassIcon size={20} />
        </DockButton>
      )}
      {items.length > 0 && (
        <DockButton label="选择" mouseX={mouseX} magnify={magnify} onClick={() => useUi.getState().select(path, [items[0].name])}>
          <CheckSquareIcon size={20} />
        </DockButton>
      )}
      {(hasJobs || !mobile) && me && me.role !== 1 && (
        <DockButton label="传输" mouseX={mouseX} magnify={magnify} active={uploadsOpen} onClick={() => setUploads(!uploadsOpen)} badge={<UploadsBadge />}>
          <ListChecksIcon size={20} />
        </DockButton>
      )}
      {isAdmin(me) && (
        <>
          <span className="mx-1 mb-3 h-5 w-px bg-line-strong" />
          <DockButton label="管理" mouseX={mouseX} magnify={magnify} onClick={() => navigate("/@manage")}>
            <GearIcon size={20} />
          </DockButton>
        </>
      )}
    </motion.div>
  );

  const single = chosen.length === 1 ? chosen[0] : null;
  const selectionContent = (
    <motion.div key="selection" className="flex items-center gap-0.5 pl-1 sm:gap-1 sm:pl-2"
      initial={{ opacity: 0, scale: 0.9, filter: "blur(6px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, scale: 0.9, filter: "blur(6px)" }} transition={spring.snappy}>
      <button className="icon-btn" aria-label="取消选择" onClick={() => useUi.getState().clearSelection()}><XIcon size={18} /></button>
      <span className="pr-1 text-[13.5px] font-medium sm:min-w-[4.5rem] sm:pr-2">
        <span className="max-sm:hidden">已选 </span><NumberRoll value={count} className="font-semibold text-accent-text" />
      </span>
      <button className="btn btn-ghost h-10 px-3 text-[13px] max-sm:hidden" onClick={() => useUi.getState().select(path, count === items.length ? [] : items.map(item => item.name))}>
        {count === items.length ? "全不选" : "全选"}
      </button>
      <button className="icon-btn size-10 sm:hidden" aria-label="全选" onClick={() => useUi.getState().select(path, count === items.length ? [] : items.map(item => item.name))}>
        <ChecksIcon size={19} weight={count === items.length ? "bold" : "regular"} />
      </button>
      <span className="mx-1 h-5 w-px bg-line-strong max-sm:hidden" />
      {single && !single.is_dir && (
        <button className="icon-btn size-10" aria-label="下载" title="下载" onClick={() => actions.download(path, single)}><DownloadSimpleIcon size={19} /></button>
      )}
      <button className="icon-btn size-10" aria-label="复制链接" title="复制链接" disabled={!chosen.some(item => !item.is_dir)}
        onClick={() => void actions.copyLinks(path, chosen.filter(item => !item.is_dir))}><LinkIcon size={19} /></button>
      {can(me, Perm.Share) && (
        <button className="icon-btn size-10" aria-label="分享" title="分享" onClick={() => openDialog({ kind: "share", dir: path, names: [...(selected ?? [])] })}><ShareNetworkIcon size={19} /></button>
      )}
      {single && can(me, Perm.Rename) && (
        <button className="icon-btn size-10" aria-label="重命名" title="重命名" onClick={() => openDialog({ kind: "rename", dir: path, obj: single })}><PencilSimpleIcon size={19} /></button>
      )}
      {can(me, Perm.Rename) && !isGuest(me) && library.has(path) && actions.tmdbTargets(path, chosen).length > 0 && (
        <button className="icon-btn size-10" aria-label="按 TMDB 整理命名" title="按 TMDB 整理命名"
          onClick={() => openDialog({ kind: "tmdb-rename", targets: actions.tmdbTargets(path, chosen) })}><TextAaIcon size={19} /></button>
      )}
      {can(me, Perm.Move) && (
        <button className="icon-btn size-10 max-sm:hidden" aria-label="移动" title="移动到" onClick={() => openDialog({ kind: "transfer", mode: "move", dir: path, names: [...(selected ?? [])] })}><ArrowsLeftRightIcon size={19} /></button>
      )}
      {can(me, Perm.Copy) && (
        <button className="icon-btn size-10 max-sm:hidden" aria-label="复制" title="复制到" onClick={() => openDialog({ kind: "transfer", mode: "copy", dir: path, names: [...(selected ?? [])] })}><CopyIcon size={19} /></button>
      )}
      <button className="icon-btn size-10 sm:[@media(pointer:fine)]:hidden" aria-label="更多" onClick={event => {
        const r = event.currentTarget.getBoundingClientRect();
        const target = chosen[0];
        if (target) useUi.getState().openMenu({ x: r.left, y: r.top, dir: path, obj: target });
      }}><DotsThreeIcon size={20} weight="bold" /></button>
      {can(me, Perm.Remove) && (
        <button className="icon-btn size-10 text-danger hover:text-danger" aria-label="删除" title="删除" onClick={() => openDialog({ kind: "delete", dir: path, names: [...(selected ?? [])] })}><TrashIcon size={19} /></button>
      )}
    </motion.div>
  );

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <motion.div
          layout
          transition={spring.sheet}
          className="glass pointer-events-auto flex max-w-full items-end overflow-x-auto rounded-[20px] p-1.5 hairline [scrollbar-width:none]"
          style={{ boxShadow: "var(--shadow-float)", borderRadius: 20 }}
          onPointerMove={event => { if (event.pointerType === "mouse") mouseX.set(event.clientX); }}
          onPointerLeave={() => mouseX.set(Number.POSITIVE_INFINITY)}
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {count > 0 ? selectionContent : dockContent}
          </AnimatePresence>
        </motion.div>
      </div>
      <Menu
        open={!!uploadMenu}
        x={uploadMenu?.x ?? 0}
        y={uploadMenu?.y ?? 0}
        onClose={() => setUploadMenu(null)}
        entries={[
          { label: "上传文件", icon: <UploadSimpleIcon size={15} />, run: () => pickFiles(files => addUploads(path, files)) },
          { label: "上传文件夹", icon: <FolderSimpleIcon size={15} />, run: () => pickFiles(files => addUploads(path, files), true) },
          ...(can(me, Perm.Offline) ? ["divider" as const, { label: "离线下载", icon: <CloudArrowDownIcon size={15} />, run: () => openDialog({ kind: "offline", dir: path }) }] : []),
          ...(on115 ? [{ label: "转存 115 分享", icon: <LinkIcon size={15} />, run: () => openDialog({ kind: "share115", dir: path }) }] : []),
        ]}
      />
    </>
  );
}
