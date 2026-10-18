import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";
import { isInside } from "../lib/path";
import { useSession } from "../stores/session";
import { isGuest } from "../lib/perm";

/**
 * Where the media-library features apply (posters, series pages, TMDB renaming,
 * the library page, thumbnails): only inside the 影视库 paths set by the admin.
 * The server enforces it; this hides the entry points elsewhere.
 */
export function useLibraryScope(): { enabled: boolean; has: (path: string) => boolean } {
  const me = useSession(state => state.me);
  const query = useQuery({
    queryKey: ["library-scope", me?.id],
    queryFn: () => get<{ enabled: boolean; paths: string[] }>("/tgvio/library/scope"),
    enabled: !!me && !isGuest(me),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const paths = query.data?.enabled ? query.data.paths : [];
  return { enabled: paths.length > 0, has: path => paths.some(root => root === "/" || path === root || isInside(path, root)) };
}
