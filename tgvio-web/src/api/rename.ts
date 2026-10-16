import { post } from "../lib/api";
import type { Poster } from "./posters";

/** One proposed rename; no `new` means there is nothing to propose (see `reason`). */
export interface RenameItem {
  old: string;
  new?: string;
  kind: "video" | "subtitle" | "folder";
  season?: number;
  episode?: number;
  reason?: "same" | "no-episode" | "several" | "conflict" | "unknown";
}

export interface RenamePlan {
  subject: Poster | null;
  items: RenameItem[];
  /** "no-match": TMDB has nothing for this folder (choose its poster first). */
  reason?: "no-match";
}

export interface RenameResult { old: string; new: string; error?: string }

export const tmdbRename = {
  /** `only`: just these files of the folder, each named by its own match. */
  plan: (path: string, password: string, only?: string[]) => post<RenamePlan>("/tgvio/rename/plan", { path, password, only }),
  apply: (path: string, password: string, items: { old: string; new: string }[], folder = "") =>
    post<{ results: RenameResult[]; path: string }>("/tgvio/rename/apply", { path, password, items, folder }),
};
