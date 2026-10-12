import { get, post } from "../lib/api";
import { apiBase } from "../lib/config";

/** A film or series from TMDB, matched to a folder or video name on the server. */
export interface Poster {
  kind: "movie" | "tv";
  id: number;
  title: string;
  original?: string;
  year?: number;
  poster?: string;
  backdrop?: string;
  overview?: string;
  rating?: number;
  manual?: boolean;
}

export interface PosterLookup { items: Record<string, Poster>; pending: number; enabled: boolean; blur: boolean }

export const posters = {
  lookup: (names: string[]) => post<PosterLookup>("/tgvio/posters", { names }),
  search: (query: string) => post<{ query: string; results: Poster[] }>("/tgvio/posters/search", { query }),
  set: (name: string, choice: { kind: string; id: number } | null) =>
    post<{ item: Poster | null }>("/tgvio/posters/set", choice ? { name, ...choice } : { name, none: true }),
};

/** Image URLs come back as server paths; the poster size can be swapped for sharper art. */
export function posterSrc(path: string | undefined, size?: "w185" | "w342" | "w500" | "w780"): string {
  if (!path) return "";
  return `${apiBase}${size ? path.replace(/\/tgvio\/poster\/w\d+\//, `/tgvio/poster/${size}/`) : path}`;
}

export type PosterLanguage = "zh-CN" | "zh-TW" | "zh-HK" | "en-US" | "ja-JP" | "ko-KR";

export interface PosterSettings {
  config: { enabled: boolean; language: PosterLanguage; blur: boolean };
  token_set: boolean;
  /** The last characters of the token; the token itself never comes back. */
  token_hint: string;
  stats: { matched: number; none: number; manual: number; pending: number; images: number; image_bytes: number; unmatched: string[] | null };
}

export const posterAdmin = {
  get: () => get<PosterSettings>("/admin/tgvio/posters"),
  save: (change: { config?: PosterSettings["config"]; token?: string }) => post<PosterSettings>("/admin/tgvio/posters", change),
  test: () => post<{ ok: boolean }>("/admin/tgvio/posters/test"),
  reset: (scope: "none" | "auto" | "images") => post<{ cleared: number; settings: PosterSettings }>("/admin/tgvio/posters/reset", { scope }),
};
