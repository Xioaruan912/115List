import { get, post } from "../lib/api";
import type { FsGet, FsList, Obj, Page, SearchNode } from "../lib/types";

export function listDir(path: string, password = "", refresh = false, signal?: AbortSignal): Promise<FsList> {
  return post<FsList>("/fs/list", { path, password, page: 1, per_page: 0, refresh }, undefined, signal);
}

export function getObj(path: string, password = ""): Promise<FsGet> {
  return post<FsGet>("/fs/get", { path, password });
}

export function dirs(path: string, password = "", forceRoot = false): Promise<Pick<Obj, "name" | "modified">[] | null> {
  return post("/fs/dirs", { path, password, force_root: forceRoot });
}

export const mkdir = (path: string) => post<null>("/fs/mkdir", { path });
export const rename = (path: string, name: string, overwrite = false) => post<null>("/fs/rename", { path, name, overwrite });
export const remove = (dir: string, names: string[]) => post<null>("/fs/remove", { dir, names });

export interface TransferOptions { overwrite?: boolean; skip_existing?: boolean; merge?: boolean }

export function move(srcDir: string, dstDir: string, names: string[], options: TransferOptions = {}): Promise<unknown> {
  return post("/fs/move", { src_dir: srcDir, dst_dir: dstDir, names, ...options });
}

export function copy(srcDir: string, dstDir: string, names: string[], options: TransferOptions = {}): Promise<unknown> {
  return post("/fs/copy", { src_dir: srcDir, dst_dir: dstDir, names, ...options });
}

export function search(parent: string, keywords: string, scope = 0, perPage = 100, password = ""): Promise<Page<SearchNode>> {
  return post("/fs/search", { parent, keywords, scope, page: 1, per_page: perPage, password });
}

export function offlineDownload(path: string, urls: string[], tool: string, deletePolicy: string): Promise<unknown> {
  return post("/fs/add_offline_download", { path, urls, tool, delete_policy: deletePolicy });
}

export const offlineTools = () => get<string[]>("/public/offline_download_tools");

export interface ArchiveNode extends Obj { children: ArchiveNode[] | null }
export interface ArchiveMeta {
  comment: string;
  encrypted: boolean;
  content: ArchiveNode[] | null;
  raw_url: string;
  sign: string;
}

export function archiveMeta(path: string, password: string, archivePass: string): Promise<ArchiveMeta> {
  return post("/fs/archive/meta", { path, password, archive_pass: archivePass });
}

export function archiveList(path: string, password: string, archivePass: string, innerPath: string): Promise<Page<Obj>> {
  return post("/fs/archive/list", { path, password, archive_pass: archivePass, inner_path: innerPath, page: 1, per_page: 0 });
}

export interface DecompressOptions { archivePass: string; innerPath: string; intoNewDir: boolean; overwrite: boolean }

export function decompress(srcDir: string, dstDir: string, names: string[], options: DecompressOptions): Promise<unknown> {
  return post("/fs/archive/decompress", {
    src_dir: srcDir, dst_dir: dstDir, name: names, archive_pass: options.archivePass, inner_path: options.innerPath,
    cache_full: false, put_into_new_dir: options.intoNewDir, overwrite: options.overwrite,
  });
}
