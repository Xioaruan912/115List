import * as fs from "../api/fs";
import { refreshCover } from "../hooks/useCover";
import { dirKey, fetchDir } from "../hooks/useDir";
import { toast } from "../stores/toast";
import { useUi } from "../stores/ui";
import * as flip from "./flip";
import { absolute, copyText, downloadUrl } from "./links";
import { join } from "./path";
import { queryClient } from "./query";
import type { FsList, Obj } from "./types";

/** Re-read a directory from the drive (not the server cache) and update every view of it. */
export async function reload(dir: string, hard = true, announce = false): Promise<void> {
  try {
    const data = await fetchDir(dir, hard);
    queryClient.setQueryData(dirKey(dir), data);
    refreshCover(dir, data);
    if (announce) toast.success("已重新读取", `${(data.content ?? []).length} 项，和网盘一致`);
  } catch (error) {
    if (announce) toast.error("没有读到最新内容", error);
    await queryClient.invalidateQueries({ queryKey: dirKey(dir) });
  }
}

/** Apply a local change at once so the grid animates without waiting for a reload. */
function patchDir(dir: string, change: (items: Obj[]) => Obj[]): void {
  queryClient.setQueryData<FsList>(dirKey(dir), data => data ? { ...data, content: change(data.content ?? []) } : data);
}

export async function mkdir(dir: string, name: string): Promise<boolean> {
  try {
    await fs.mkdir(join(dir, name));
    const now = new Date().toISOString();
    flip.capture();
    patchDir(dir, items => [...items, { name, is_dir: true, size: 0, modified: now, created: now, sign: "", thumb: "", type: 1, hashinfo: "" }]);
    toast.success("已新建文件夹", name);
    void reload(dir, false);
    return true;
  } catch (error) {
    toast.error("新建失败", error);
    return false;
  }
}

export async function rename(dir: string, obj: Obj, name: string): Promise<boolean> {
  try {
    await fs.rename(join(dir, obj.name), name);
    flip.capture();
    patchDir(dir, items => items.map(item => item.name === obj.name ? { ...item, name } : item));
    useUi.getState().clearSelection();
    toast.success("已重命名", name);
    void reload(dir, false);
    return true;
  } catch (error) {
    toast.error("重命名失败", error);
    return false;
  }
}

export async function remove(dir: string, names: string[]): Promise<boolean> {
  const gone = new Set(names);
  const before = queryClient.getQueryData<FsList>(dirKey(dir));
  await flip.leaveThenCapture(gone);
  patchDir(dir, items => items.filter(item => !gone.has(item.name)));
  useUi.getState().clearSelection();
  try {
    await fs.remove(dir, names);
    toast.success(names.length === 1 ? "已删除" : `已删除 ${names.length} 项`, names.length === 1 ? names[0] : undefined);
    void reload(dir, false);
    return true;
  } catch (error) {
    if (before) queryClient.setQueryData(dirKey(dir), before);
    toast.error("删除失败", error);
    return false;
  }
}

export async function transfer(mode: "move" | "copy", src: string, dst: string, names: string[], options: fs.TransferOptions = {}): Promise<boolean> {
  try {
    await (mode === "move" ? fs.move : fs.copy)(src, dst, names, options);
    if (mode === "move") {
      const gone = new Set(names);
      await flip.leaveThenCapture(gone);
      patchDir(src, items => items.filter(item => !gone.has(item.name)));
      useUi.getState().clearSelection();
    }
    toast.success(mode === "move" ? "已移动" : "已开始复制", `${names.length} 项到 ${dst}`);
    void reload(src, false);
    void queryClient.invalidateQueries({ queryKey: dirKey(dst) });
    return true;
  } catch (error) {
    toast.error(mode === "move" ? "移动失败" : "复制失败", error);
    return false;
  }
}

export function download(dir: string, obj: Obj): void {
  const link = document.createElement("a");
  link.href = downloadUrl(join(dir, obj.name), obj);
  link.download = obj.name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

export async function copyLinks(dir: string, objs: Obj[]): Promise<void> {
  try {
    await copyText(objs.map(obj => absolute(downloadUrl(join(dir, obj.name), obj))).join("\n"));
    toast.success(objs.length === 1 ? "已复制链接" : `已复制 ${objs.length} 条链接`);
  } catch (error) {
    toast.error("复制失败", error);
  }
}
