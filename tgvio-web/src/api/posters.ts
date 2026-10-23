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
  season?: number;
  /** What it is for browsing, from TMDB's genres; missing while the server is still asking. */
  cat?: Category;
}

export type Category = "movie" | "tv" | "anime" | "variety" | "documentary";

export const CATEGORY_LABEL: Record<Category, string> = { movie: "电影", tv: "电视剧", anime: "动漫", variety: "综艺", documentary: "纪录片" };
const CATEGORY_ORDER: Category[] = ["movie", "tv", "anime", "variety", "documentary"];

/** A poster's category; one from before categories counts by its kind until the server fills it in. */
export function categoryOf(poster: Poster | undefined): Category | undefined {
  if (!poster) return undefined;
  return poster.cat ?? (poster.kind === "tv" ? "tv" : "movie");
}

/** How many of a listing fall in each category, in display order. */
export function categoryCounts(names: string[], items: Record<string, Poster>): [Category, number][] {
  const counts = new Map<Category, number>();
  for (const name of names) {
    const cat = categoryOf(items[name]);
    if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return CATEGORY_ORDER.filter(cat => counts.has(cat)).map(cat => [cat, counts.get(cat)!]);
}

/** One film or series of the library page: where it lives, as the user sees it. */
export interface LibraryItem extends Poster {
  path: string;
  /** A video file rather than a folder. */
  file?: boolean;
  /** Season folders found for a series. */
  seasons?: number;
  /** When it was first matched (ms). */
  at: number;
  /** Every folder or file it was found as. */
  places?: string[];
}

export const library = () => get<{ items: LibraryItem[]; blur: boolean }>("/tgvio/library");

export interface SeasonInfo { season: number; name: string; poster?: string; year?: number; episodes: number; /** First air date. */ air?: string }

export interface PosterLookup { items: Record<string, Poster>; pending: number; enabled: boolean; blur: boolean }

export const posters = {
  lookup: (dir: string, names: string[]) => post<PosterLookup>("/tgvio/posters", { dir, names }),
  seasons: (id: number) => get<SeasonInfo[]>("/tgvio/posters/seasons", { id }),
  search: (query: string) => post<{ query: string; results: Poster[] }>("/tgvio/posters/search", { query }),
  set: (name: string, choice: { kind: string; id: number; season?: number } | null) =>
    post<{ item: Poster | null }>("/tgvio/posters/set", choice ? { name, ...choice } : { name, none: true }),
};

/** Image URLs come back as server paths; the poster size can be swapped for sharper art. */
export function posterSrc(path: string | undefined, size?: "w185" | "w342" | "w500" | "w780"): string {
  if (!path) return "";
  return `${apiBase}${size ? path.replace(/\/tgvio\/poster\/w\d+\//, `/tgvio/poster/${size}/`) : path}`;
}

export type PosterLanguage = "zh-CN" | "zh-TW" | "zh-HK" | "en-US" | "ja-JP" | "ko-KR";

export interface PosterSettings {
  config: { enabled: boolean; language: PosterLanguage; blur: boolean; paths: string[] };
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
