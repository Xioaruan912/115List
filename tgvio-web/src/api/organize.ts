import { get, post } from "../lib/api";

/** Folders waiting to be organized (made by 找资源, not yet through 按 TMDB 整理命名), kept on the server. */
export const organize = {
  /** names: waiting in dir; done: organized (by 按 TMDB 整理命名 or by hand); self: dir's own state. */
  pending: (dir: string) => get<{ names: string[]; done: string[]; self: "" | "pending" | "done" }>("/tgvio/organize", { dir }),
  /** pending true: waiting; false: organized. */
  mark: (paths: string[], pending: boolean) => post<null>("/tgvio/organize", { paths, pending }),
  /**
   * What the server's organizer did lately with downloads 找资源 made (shown paths, newest first),
   * and what it is doing now (active).
   */
  recent: () => get<{ items: AutoNote[]; active: { path: string; state: AutoState }[]; removed?: { path: string; size: number; at: string }[] }>("/tgvio/organize/recent"),
  /** What 按 TMDB 整理命名 would call each (same rules as the server's planner): "" unknown to TMDB, "~" a series' episode. */
  check: (dir: string, folders: string[], files: string[]) => post<{ wants: Record<string, string> }>("/tgvio/organize/check", { dir, folders, files }),
};

export type AutoState = "downloading" | "waiting" | "organizing";

export interface AutoNote {
  path: string;
  at: string;
  done: boolean;
  why?: "person" | "error";
  batch?: string;
  /** Why a person has to look; folder: where, below path. */
  need?: string;
  folder?: string;
}

/** What the organizer is doing, as a sentence. */
export const AUTO_STATE: Record<AutoState, string> = {
  downloading: "正在下载。下载完成后会马上自动整理，不用在这里等。",
  waiting: "下载完了，正在等文件全部出现在网盘里，随后自动整理。",
  organizing: "正在自动整理：改名、删广告、拆掉多余的一层文件夹。",
};

/** Why the organizer left a folder to a person. */
export function needText(note: AutoNote): string {
  if (note.why === "error") return "整理时出错了，可以打开「整理」再试一次";
  const what: Record<string, string> = {
    "no-match": "没认出这是哪部片或哪部剧",
    "pick-season": "要你选这是第几季",
    season: "要你选这是第几季",
    "no-episode": "有视频认不出是第几集",
    version: "同一部（同一集）有几个版本，要你选留哪个",
    several: "一个文件夹里有好几部，要你确认",
    unknown: "有视频认不出是哪部",
  };
  const text = what[note.need ?? ""] ?? "有拿不准的地方";
  return note.folder ? `${text}（${note.folder.replace(/^\//, "")}）` : text;
}
