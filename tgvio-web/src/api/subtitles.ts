import { get, post } from "../lib/api";

export interface SubtitleResult { id: number; name: string; video?: string; lang?: string; type?: string; score?: number; uploaded?: string }
export interface SubtitleFile { name: string; size?: string }

/** Subtitles from 射手网 (assrt.net) for a video (`path`, as the user sees it). */
export const onlineSubtitles = {
  status: () => get<{ enabled: boolean }>("/tgvio/subtitles/status"),
  search: (path: string, password: string, q = "") => post<{ items: SubtitleResult[] }>("/tgvio/subtitles/search", { path, password, q }),
  files: (id: number) => post<{ items: SubtitleFile[] | null }>("/tgvio/subtitles/files", { id }),
  save: (path: string, password: string, id: number, file: string, lang = "") =>
    post<{ name: string }>("/tgvio/subtitles/save", { path, password, id, file, lang }),
};

export const subtitleAdmin = {
  get: () => get<{ token_set: boolean; token_hint: string }>("/admin/tgvio/subtitles"),
  set: (token: string) => post<{ token_set: boolean; token_hint: string }>("/admin/tgvio/subtitles", { token }),
  test: () => post<{ quota: number }>("/admin/tgvio/subtitles/test"),
};
