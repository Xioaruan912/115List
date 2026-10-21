import type { SortKey } from "../stores/prefs";
import type { Obj } from "./types";

const collator = new Intl.Collator(["zh-CN", "en"], { numeric: true, sensitivity: "base" });

/** Sorts a listing. "rating" and "year" need posters: here they sort by name, and {@link sortByPoster} reorders. */
export function sortObjs(items: Obj[], key: SortKey, desc: boolean): Obj[] {
  if (key === "rating" || key === "year") return sortObjs(items, "name", false);
  const sign = desc ? -1 : 1;
  return [...items].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    let diff = 0;
    if (key === "size") diff = a.size - b.size;
    else if (key === "modified") diff = Date.parse(a.modified) - Date.parse(b.modified);
    if (diff === 0) diff = collator.compare(a.name, b.name) * (key === "name" ? 1 : sign);
    return diff * sign;
  });
}

interface PosterFacts { rating?: number; year?: number }

/** Reorders a listing sorted by name by TMDB rating or year (rating breaks ties of a year); folders first, the unknown last. */
export function sortByPoster(items: Obj[], key: "rating" | "year", desc: boolean, posters: Record<string, PosterFacts>): Obj[] {
  const sign = desc ? -1 : 1;
  const value = (obj: Obj): number | undefined => {
    const poster = posters[obj.name];
    const v = key === "rating" ? poster?.rating : poster?.year;
    return v ? v : undefined;
  };
  return [...items].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    const va = value(a);
    const vb = value(b);
    if (va === undefined || vb === undefined) return va === vb ? 0 : va === undefined ? 1 : -1;
    let diff = (va - vb) * sign;
    if (diff === 0 && key === "year") diff = ((posters[b.name]?.rating ?? 0) - (posters[a.name]?.rating ?? 0));
    return diff;
  });
}
