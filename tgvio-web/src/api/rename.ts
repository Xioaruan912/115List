import { post } from "../lib/api";
import type { Poster } from "./posters";

/** One proposed rename; no `new` means there is nothing to propose (see `reason`). */
export interface RenameItem {
  old: string;
  new?: string;
  kind: "video" | "subtitle" | "folder";
  season?: number;
  episode?: number;
  reason?: "same" | "no-episode" | "several" | "conflict" | "unknown" | "pick-season" | "inner";
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
}

/** What the folder above a subfolder was planned as. */
export interface RenameInherit { kind: string; id: number; season?: number }

export interface RenameResult { old: string; new: string; error?: string }

export const tmdbRename = {
  /** `only`: just these files of the folder, each named by its own match. */
  plan: (path: string, password: string, only?: string[], season?: number, inherit?: RenameInherit) =>
    post<RenamePlan>("/tgvio/rename/plan", { path, password, only, season, inherit }),
  /** The folder and its subfolders holding videos or subtitles, parents first. */
  tree: (path: string, password: string) => post<{ folders: { path: string; depth: number }[] }>("/tgvio/rename/tree", { path, password }),
  apply: (path: string, password: string, items: { old: string; new: string }[], folder = "") =>
    post<{ results: RenameResult[]; path: string }>("/tgvio/rename/apply", { path, password, items, folder }),
};
