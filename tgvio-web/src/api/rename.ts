import { get, post } from "../lib/api";
import type { Poster } from "./posters";

/** One proposed rename; no `new` means there is nothing to propose (see `reason`). */
export interface RenameItem {
  old: string;
  new?: string;
  kind: "video" | "subtitle" | "extra" | "folder" | "junk" | "unwrap" | "spill" | "up";
  /** A row that is no rename: delete an ad or leftover, open a folder wrapped around the film, or spill a box of series into the folder above. */
  action?: "delete" | "unwrap" | "spill" | "up";
  /** A film of a folder of several goes into a folder of its own of this name. */
  into?: string;
  season?: number;
  episode?: number;
  /** Size of a version of an episode. */
  size?: number;
  reason?: "same" | "no-episode" | "several" | "conflict" | "unknown" | "pick-season" | "inner" | "version" | "spill";
}

export interface RenamePlan {
  subject: Poster | null;
  /** The season episodes were named under (series only). */
  season?: number;
  items: RenameItem[];
  /** "no-match": TMDB has nothing for this folder (choose its poster first). */
  reason?: "no-match";
  /** "season": a series of several seasons and nothing says which this is; pick one to get names. */
  need?: "season";
  /** Named after the folder above (it found nothing of its own, or is part of that series). */
  inherited?: boolean;
  /** One film's folder (not a series or a shelf): what is below it is that film. */
  film?: boolean;
  /** TMDB knows no film by the folder's name, but it holds films: planned film by film. */
  shelf?: boolean;
  /** Named for a series: its earliest film here, the folder's cover once renamed. */
  series_first?: number;
}

/** What the folder above a subfolder was planned as. */
export interface RenameInherit { kind: string; id: number; season?: number; film?: boolean }

export interface RenameResult { old: string; new: string; error?: string }

/** Whether a row proposes something: a new name, a deletion or an unwrap. */
export const doable = (item: RenameItem): boolean => !!item.new || !!item.action;

export const tmdbRename = {
  /** `only`: just these files of the folder, each named by its own match. */
  plan: (path: string, password: string, only?: string[], season?: number, inherit?: RenameInherit) =>
    post<RenamePlan>("/tgvio/rename/plan", { path, password, only, season, inherit }),
  /** The folder and its subfolders holding videos or subtitles, parents first. */
  tree: (path: string, password: string) => post<{ folders: { path: string; depth: number }[] }>("/tgvio/rename/tree", { path, password }),
  /** `subject`: what the plan named the folder after, so its new name gets that poster at once. */
  apply: (path: string, password: string, items: { old: string; new: string; into?: string }[], folder = "", subject?: RenameInherit,
    extra?: { remove?: string[]; unwrap?: string[]; up?: string[]; batch?: string }) =>
    post<{ results: RenameResult[]; path: string }>("/tgvio/rename/apply", { path, password, items, folder, subject, ...extra }),
  /** Recent 整理 runs, newest first; `undone` once put back. */
  journal: () => get<{ items: { id: string; at: string; root: string; changes: number; deleted: number; undone: boolean }[] }>("/tgvio/rename/journal"),
  /** Puts a 整理 run back, last change first (deleted ads stay deleted). */
  undo: (id: string) => post<{ changes: number }>("/tgvio/rename/undo", { id }),
};
