import { get, post } from "../lib/api";
import { apiBase, basePath } from "../lib/config";
import { encodePath } from "../lib/path";
import type { FsGet, FsList, Page } from "../lib/types";

/** A share as /api/share returns it. `files` are full paths on the drive. */
export interface Share {
  id: string;
  files: string[];
  expires: string | null;
  pwd: string;
  accessed: number;
  max_accessed: number;
  disabled: boolean;
  remark: string;
  readme: string;
  header: string;
  creator: string;
}

export interface ShareInput {
  files: string[];
  expires: string | null;
  pwd: string;
  max_accessed: number;
  remark: string;
}

export const shares = {
  list: () => get<Page<Share>>("/share/list", { page: 1, per_page: 500 }),
  create: (input: ShareInput) => post<Share>("/share/create", { ...input, readme: "", header: "", disabled: false, accessed: 0 }),
  update: (share: Share) => post<Share>("/share/update", share),
  remove: (id: string) => post<null>("/share/delete", undefined, { id }),
  setEnabled: (id: string, enabled: boolean) => post<null>(enabled ? "/share/enable" : "/share/disable", undefined, { id }),
};

/** Public side: anyone with the link. Paths are relative to the share root. */
const sharePath = (id: string, path: string): string => `/@s/${id}${path === "/" ? "" : path}`;

export const visit = {
  list: (id: string, path: string, pwd: string, signal?: AbortSignal) =>
    post<FsList>("/fs/list", { path: sharePath(id, path), password: pwd, page: 1, per_page: 0, refresh: false }, undefined, signal),
  get: (id: string, path: string, pwd: string) => post<FsGet>("/fs/get", { path: sharePath(id, path), password: pwd }),
};

/**
 * A share's link. With a code the code rides in the address as ?pw=, so one
 * line is the whole share: no "提取码" to paste after it, and a phone can open
 * what a QR code holds. ?pwd= is still read, for links made before this.
 */
export function shareUrl(id: string, pwd = ""): string {
  const url = `${location.origin}${basePath}/@s/${encodeURIComponent(id)}`;
  return pwd ? `${url}?pw=${encodeURIComponent(pwd)}` : url;
}

/** Download link for a file inside a share. */
export function shareFileUrl(id: string, path: string, pwd: string): string {
  return `${apiBase}/sd/${encodeURIComponent(id)}${encodePath(path)}${pwd ? `?pwd=${encodeURIComponent(pwd)}` : ""}`;
}

/**
 * Where a video inside a share keeps its place: the same key the share's
 * player writes, so 继续观看 and the library's progress marks agree with it.
 * A share's progress stays in this browser: a visitor may have no account.
 */
export const shareProgressKey = (id: string, path: string): string => `share:${id}${path}`;

/** A short code without look-alike characters (no 0/O, 1/l/I). */
export function randomCode(length = 4): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(byte => alphabet[byte % alphabet.length]).join("");
}
