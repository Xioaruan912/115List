import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { posters, type Poster } from "../api/posters";
import { kindOf } from "../lib/kind";
import type { Obj } from "../lib/types";
import { useSession } from "../stores/session";
import { isGuest } from "../lib/perm";

/**
 * TMDB posters for the folders and videos of a directory, by name. The server
 * answers from its store at once and looks unknown names up in the background,
 * so while some are pending this asks again every few seconds (a minute at most).
 * No drive request is involved.
 */
export function usePosters(dir: string, items: Obj[]): { items: Record<string, Poster>; blur: boolean } {
  const me = useSession(state => state.me);
  const names = useMemo(() => items.filter(item => item.is_dir || kindOf(item) === "video").map(item => item.name), [items]);
  const query = useQuery({
    queryKey: ["posters", dir, names.length, names[0], names[names.length - 1]],
    queryFn: () => posters.lookup(dir, names),
    enabled: names.length > 0 && !!me && !isGuest(me),
    staleTime: 5 * 60_000,
    retry: false,
    refetchInterval: q => {
      const data = q.state.data;
      return data && data.pending > 0 && q.state.dataUpdateCount < 20 ? 3000 : false;
    },
  });
  return { items: query.data?.items ?? EMPTY, blur: !!query.data?.blur };
}

const EMPTY: Record<string, Poster> = {};
