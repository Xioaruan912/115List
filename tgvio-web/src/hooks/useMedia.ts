import { useSyncExternalStore } from "react";

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    notify => {
      const list = matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

export const useIsMobile = (): boolean => useMedia("(max-width: 639px)");
export const useCanHover = (): boolean => useMedia("(hover: hover) and (pointer: fine)");
