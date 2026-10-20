import type { Poster } from "../api/posters";
import { isFilm, kindOf } from "./kind";
import type { Obj } from "./types";

/**
 * Whether something in a library folder is already organized the way 按 TMDB
 * 整理命名 would leave it (internal/tgvio/rename.go):
 *
 *   folder  片名 (年份), or 剧名 第二季 (年份) for a season, matched to TMDB
 *   film    片名 (年份).mkv
 *   episode 剧名 - S01E05 - 集名.mkv
 *
 * and not waiting for its downloads to be organized. What went through 按
 * TMDB 整理命名 cleanly, or was marked 已整理 by hand, counts as organized
 * whatever its name (a collection folder keeps its own). Subtitles, pictures and
 * other side files follow their videos and never count on their own.
 */

/** The same file-name cleaning as the server's SafeName. */
export function safeName(title: string): string {
  return title
    .replace(/:/g, "：").replace(/\?/g, "？").replace(/\*/g, " ").replace(/"/g, "'").replace(/</g, "《").replace(/>/g, "》").replace(/\|/g, " ")
    .replace(/[/\\:*?"<>|\x00-\x1f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "");
}

function squeeze(text: string): string {
  return safeName(text).replace(/\s+/g, "");
}

const EPISODE = /^.+ - S\d{2,}E\d{2,}( - .+)?\.[^.]+$/i;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function needsOrganizing(obj: Obj, poster: Poster | undefined, pending: Set<string>, done: Set<string> = new Set()): boolean {
  if (pending.has(obj.name)) return true;
  if (done.has(obj.name)) return false;
  if (obj.is_dir) {
    if (!poster) return true;
    // Spacing aside ("星球大战： 曼达洛人" and "星球大战：曼达洛人" are the same title).
    const title = escape(squeeze(poster.title));
    // The year is part of the name whenever TMDB knows it (按 TMDB 整理命名 adds it).
    const canonical = new RegExp(`^${title}(第.{1,3}季)?${poster.year ? "\\(\\d{4}\\)" : "(\\(\\d{4}\\))?"}$`);
    return !canonical.test(squeeze(obj.name));
  }
  if (kindOf(obj) !== "video" && !isFilm(obj)) return false;
  if (EPISODE.test(obj.name)) return false;
  if (!poster) return true;
  const stem = obj.name.replace(/\.[^.]+$/, "");
  return squeeze(stem) !== squeeze(poster.year ? `${poster.title} (${poster.year})` : poster.title);
}
