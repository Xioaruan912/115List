import { get, post } from "../lib/api";

/** A season followed on the server: new episodes are downloaded by themselves. */
export interface Follow {
  path: string;
  tmdb: number;
  title: string;
  season: number;
  site: string;
  seed_title: string;
  query: string;
  at: number;
}

export const follow = {
  list: () => get<{ items: Follow[]; enabled: boolean }>("/tgvio/follow"),
  add: (path: string) => post<{ item: Follow }>("/tgvio/follow", { path }),
  remove: (path: string) => post<null>("/tgvio/follow/remove", { path }),
  /** Look at the sites now; returns the episodes it started downloading. */
  check: () => post<{ parts: string[] }>("/tgvio/follow/check"),
};
