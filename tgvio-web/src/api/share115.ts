import { post } from "../lib/api";

export interface ShareItem { id: string; name: string; is_dir: boolean; size: number }
export interface SharePeek { code: string; password: string; title: string; count: number; items: ShareItem[] }

/** 转存 115 分享 into a folder on a 115 storage (`path`, as the user sees it). */
export const share115 = {
  peek: (link: string, path: string, dir = "") => post<SharePeek>("/tgvio/115/share/peek", { link, path, dir }),
  save: (link: string, path: string, ids: string[]) => post<{ saved: number }>("/tgvio/115/share/save", { link, path, ids }),
};
