import { useQuery } from "@tanstack/react-query";
import { resources } from "../api/resources";
import { isGuest } from "../lib/perm";
import { useSession } from "../stores/session";
import { useLibraryScope } from "./useLibraryScope";

/**
 * Where 找资源 lives: the folder downloads go to (设置 › 影视库 › 资源搜索 ›
 * 默认保存位置, else the first library folder), when resource search is on.
 */
export function useResourceRoot(): { enabled: boolean; folder: string; at: (path: string) => boolean } {
  const me = useSession(state => state.me);
  const library = useLibraryScope();
  const query = useQuery({ queryKey: ["resources"], queryFn: resources.list, enabled: !!me && !isGuest(me), staleTime: 5 * 60_000, retry: false });
  const folder = (query.data?.folder || library.paths[0] || "").replace(/(.)\/+$/, "$1");
  const enabled = !!query.data?.enabled && !!folder;
  return { enabled, folder, at: path => enabled && path === folder };
}
