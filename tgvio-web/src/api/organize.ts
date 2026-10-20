import { get, post } from "../lib/api";

/** Folders waiting to be organized (made by 找资源, not yet through 按 TMDB 整理命名), kept on the server. */
export const organize = {
  /** names: waiting in dir; done: organized (by 按 TMDB 整理命名 or by hand); self: dir's own state. */
  pending: (dir: string) => get<{ names: string[]; done: string[]; self: "" | "pending" | "done" }>("/tgvio/organize", { dir }),
  /** pending true: waiting; false: organized. */
  mark: (paths: string[], pending: boolean) => post<null>("/tgvio/organize", { paths, pending }),
};
