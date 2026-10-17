import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ViewMode = "grid" | "list" | "cinema";
/** "rating" and "year" go by TMDB (the poster store); things it does not know come last. */
export type SortKey = "name" | "size" | "modified" | "rating" | "year";
export type Theme = "system" | "dark" | "light";

interface Prefs {
  view: ViewMode;
  sortKey: SortKey;
  sortDesc: boolean;
  blur: boolean;
  theme: Theme;
  phoneCols: 2 | 3 | 4;
  setPhoneCols: (cols: 2 | 3 | 4) => void;
  setView: (view: ViewMode) => void;
  setSort: (key: SortKey) => void;
  setBlur: (blur: boolean) => void;
  setTheme: (theme: Theme) => void;
}

export const usePrefs = create<Prefs>()(persist(set => ({
  view: "grid",
  sortKey: "name",
  sortDesc: false,
  blur: true,
  theme: "system",
  phoneCols: 3,
  setPhoneCols: phoneCols => set({ phoneCols }),
  setView: view => set({ view }),
  setSort: key => set(state => state.sortKey === key ? { sortDesc: !state.sortDesc } : { sortKey: key, sortDesc: key !== "name" }),
  setBlur: blur => set({ blur }),
  setTheme: theme => {
    try { localStorage.setItem("tgvio-web:theme", theme); } catch { /* ignore */ }
    set({ theme });
  },
}), { name: "tgvio-web:prefs", partialize: ({ view, sortKey, sortDesc, blur, theme, phoneCols }) => ({ view, sortKey, sortDesc, blur, theme, phoneCols }) }));

export function resolvedTheme(theme: Theme): "dark" | "light" {
  if (theme !== "system") return theme;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
