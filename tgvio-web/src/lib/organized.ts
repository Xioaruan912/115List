import { isFilm, kindOf } from "./kind";
import type { Obj } from "./types";

/**
 * Whether something in a library folder still needs organizing, for 整理模式.
 * The name it should have comes from the server (/api/tgvio/organize/check),
 * worked out by the same rules 按 TMDB 整理命名 uses, so the two never
 * disagree ("校外 第一季 (2026)" is fine even though TMDB titles the season
 * "校外 第 1 季"):
 *
 *   folder  片名 (年份), or 剧名 第二季 (年份) for a season
 *   film    片名 (年份).mkv
 *   episode 剧名 - S01E05 - 集名.mkv
 *
 * Unknown to TMDB, or waiting for downloads to be organized: needs it. What
 * went through 按 TMDB 整理命名 cleanly, or was marked 已整理 by hand, counts
 * as organized whatever its name (a collection folder keeps its own).
 * Subtitles, pictures and other side files follow their videos.
 */

const EPISODE = /^.+ - S\d{2,}E\d{2,}( - .+)?\.[^.]+$/i;

/** Whether the item is one whose name 整理模式 judges (folders and videos). */
export function judged(obj: Obj): boolean {
  return obj.is_dir || kindOf(obj) === "video" || isFilm(obj);
}

export function needsOrganizing(obj: Obj, want: string | undefined, pending: Set<string>, done: Set<string> = new Set()): boolean {
  if (pending.has(obj.name)) return true;
  if (done.has(obj.name) || !judged(obj)) return false;
  if (want === undefined) return false; // not checked yet
  if (!obj.is_dir && EPISODE.test(obj.name)) return false;
  if (want === "~") return !EPISODE.test(obj.name);
  return want === "" || want !== obj.name;
}
