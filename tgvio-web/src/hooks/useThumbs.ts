import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { post } from "../lib/api";
import { apiBase } from "../lib/config";
import { kindOf } from "../lib/kind";
import { isGuest } from "../lib/perm";
import type { Obj } from "../lib/types";
import { useSession } from "../stores/session";
import { passwordFor } from "./useDir";

/**
 * Pictures for videos the drive lists without one: TMDB's still for episodes of
 * a known series, otherwise a frame the server takes from the drive's own
 * transcode in the background. While some are being made this asks again every
 * few seconds, for a couple of minutes at most.
 */
export function useThumbs(dir: string, items: Obj[]): Record<string, string> {
  const me = useSession(state => state.me);
  const names = useMemo(() => items.filter(item => !item.is_dir && !item.thumb && kindOf(item) === "video").map(item => item.name), [items]);
  const query = useQuery({
    queryKey: ["thumbs", dir, names.length, digest(names)],
    queryFn: () => post<{ items: Record<string, string>; pending: number }>("/tgvio/thumbs", { dir, names, password: passwordFor(dir) }),
    enabled: names.length > 0 && !!me && !isGuest(me),
    staleTime: 10 * 60_000,
    retry: false,
    refetchInterval: q => {
      const data = q.state.data;
      return data && data.pending > 0 && q.state.dataUpdateCount < 40 ? 4000 : false;
    },
  });
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const [name, url] of Object.entries(query.data?.items ?? {})) out[name] = `${apiBase}${url}`;
    return out;
  }, [query.data]);
}

/** A short fingerprint of every name, so a rename anywhere asks again. */
function digest(names: string[]): number {
  let h = 2166136261;
  for (const name of names) for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}
