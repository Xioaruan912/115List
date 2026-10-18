import {
  ArrowSquareOutIcon, ArrowsLeftRightIcon, CheckSquareIcon, CopyIcon, DownloadSimpleIcon, FolderPlusIcon, InfoIcon,
  FilmSlateIcon, LinkIcon, TextAaIcon, PencilSimpleIcon, ShareNetworkIcon, TrashIcon, UploadSimpleIcon, ArrowClockwiseIcon,
} from "@phosphor-icons/react";
import { useLocation } from "wouter";
import { useLibraryScope } from "../hooks/useLibraryScope";
import { useDir } from "../hooks/useDir";
import * as actions from "../lib/actions";
import { encodePath, join } from "../lib/path";
import { isFilm } from "../lib/kind";
import { can, isGuest, Perm } from "../lib/perm";
import { useSession } from "../stores/session";
import { useUi } from "../stores/ui";
import { useUploads } from "../stores/uploads";
import { pickFiles } from "./DirectoryView";
import { Menu, type MenuEntry } from "./Menu";

export function ContextMenu() {
  const menu = useUi(state => state.menu);
  const closeMenu = useUi(state => state.closeMenu);
  const selected = useUi(state => state.selected);
  const selectionDir = useUi(state => state.selectionDir);
  const me = useSession(state => state.me);
  const list = useDir(menu?.dir ?? "/");
  const [, navigate] = useLocation();
  const ui = useUi.getState;
  const library = useLibraryScope();

  let entries: MenuEntry[] = [];
  if (menu) {
    const dir = menu.dir;
    const obj = menu.obj;
    const items = list.data?.content ?? [];
    const batch = obj && selectionDir === dir && selected.has(obj.name) && selected.size > 1;
    if (!obj) {
      const writable = can(me, Perm.Write, list.data?.write);
      entries = [
        ...(writable ? [
          { label: "新建文件夹", icon: <FolderPlusIcon size={15} />, run: () => ui().openDialog({ kind: "mkdir", dir }) },
          { label: "上传文件", icon: <UploadSimpleIcon size={15} />, run: () => pickFiles(files => useUploads.getState().add(dir, files)) },
          "divider" as const,
        ] : []),
        { label: "刷新", icon: <ArrowClockwiseIcon size={15} />, run: () => void actions.reload(dir, true, true) },
        ...(dir !== "/" && can(me, Perm.Rename) && !isGuest(me) && library.has(dir) ? [{ label: "按 TMDB 整理命名", icon: <TextAaIcon size={15} />, run: () => ui().openDialog({ kind: "tmdb-rename", targets: [{ path: dir }] }) }] : []),
        { label: "全选", icon: <CheckSquareIcon size={15} />, hint: "Ctrl A", run: () => ui().select(dir, items.map(item => item.name)) },
      ];
    } else if (batch) {
      const names = [...selected];
      const chosen = items.filter(item => selected.has(item.name));
      entries = [
        { heading: `${names.length} 项` },
        { label: "复制链接", icon: <LinkIcon size={15} />, disabled: !chosen.some(item => !item.is_dir), run: () => void actions.copyLinks(dir, chosen.filter(item => !item.is_dir)) },
        ...(can(me, Perm.Share) ? [{ label: "分享", icon: <ShareNetworkIcon size={15} />, run: () => ui().openDialog({ kind: "share", dir, names }) }] : []),
        ...(can(me, Perm.Rename) && !isGuest(me) && library.has(dir) && actions.tmdbTargets(dir, chosen).length ? [{ label: "按 TMDB 整理命名", icon: <TextAaIcon size={15} />, run: () => ui().openDialog({ kind: "tmdb-rename", targets: actions.tmdbTargets(dir, chosen) }) }] : []),
        { label: "移动到…", icon: <ArrowsLeftRightIcon size={15} />, disabled: !can(me, Perm.Move), run: () => ui().openDialog({ kind: "transfer", mode: "move", dir, names }) },
        { label: "复制到…", icon: <CopyIcon size={15} />, disabled: !can(me, Perm.Copy), run: () => ui().openDialog({ kind: "transfer", mode: "copy", dir, names }) },
        "divider",
        { label: "删除", icon: <TrashIcon size={15} />, danger: true, disabled: !can(me, Perm.Remove), hint: "Del", run: () => ui().openDialog({ kind: "delete", dir, names }) },
      ];
    } else {
      const path = join(dir, obj.name);
      entries = [
        { heading: obj.name },
        obj.is_dir
          ? { label: "打开", icon: <ArrowSquareOutIcon size={15} />, run: () => navigate(encodePath(path)) }
          : { label: "预览", icon: <ArrowSquareOutIcon size={15} />, run: () => ui().openViewer(dir, obj.name, null) },
        ...(obj.is_dir && !isGuest(me) ? [{ label: "强制刷新", icon: <ArrowClockwiseIcon size={15} />, hint: "重读网盘", run: () => void actions.reload(path, true, true) }] : []),
        ...(!obj.is_dir ? [
          { label: "下载", icon: <DownloadSimpleIcon size={15} />, run: () => actions.download(dir, obj) },
          { label: "复制链接", icon: <LinkIcon size={15} />, run: () => void actions.copyLinks(dir, [obj]) },
        ] : []),
        ...(can(me, Perm.Share) ? [{ label: "分享", icon: <ShareNetworkIcon size={15} />, run: () => ui().openDialog({ kind: "share", dir, names: [obj.name] }) }] : []),
        ...((obj.is_dir || isFilm(obj)) && !isGuest(me) && library.has(join(dir, obj.name)) ? [{ label: "更换封面", icon: <FilmSlateIcon size={15} />, run: () => ui().openDialog({ kind: "poster", name: obj.name }) }] : []),
        ...(obj.is_dir && can(me, Perm.Rename) && !isGuest(me) && library.has(join(dir, obj.name)) ? [{ label: "按 TMDB 整理命名", icon: <TextAaIcon size={15} />, run: () => ui().openDialog({ kind: "tmdb-rename", targets: [{ path }] }) }] : []),
        { label: "选择", icon: <CheckSquareIcon size={15} />, run: () => ui().toggle(dir, obj.name) },
        "divider",
        { label: "重命名", icon: <PencilSimpleIcon size={15} />, hint: "F2", disabled: !can(me, Perm.Rename), run: () => ui().openDialog({ kind: "rename", dir, obj }) },
        { label: "移动到…", icon: <ArrowsLeftRightIcon size={15} />, disabled: !can(me, Perm.Move), run: () => ui().openDialog({ kind: "transfer", mode: "move", dir, names: [obj.name] }) },
        { label: "复制到…", icon: <CopyIcon size={15} />, disabled: !can(me, Perm.Copy), run: () => ui().openDialog({ kind: "transfer", mode: "copy", dir, names: [obj.name] }) },
        { label: "属性", icon: <InfoIcon size={15} />, run: () => ui().openDialog({ kind: "info", dir, obj }) },
        "divider",
        { label: "删除", icon: <TrashIcon size={15} />, danger: true, hint: "Del", disabled: !can(me, Perm.Remove), run: () => ui().openDialog({ kind: "delete", dir, names: [obj.name] }) },
      ];
    }
  }

  return <Menu open={!!menu} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={closeMenu} entries={entries} />;
}
