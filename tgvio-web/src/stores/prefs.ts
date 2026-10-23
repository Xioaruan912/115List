import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ViewMode = "grid" | "list" | "cinema";
/** "rating" and "year" go by TMDB (the poster store); things it does not know come last. */
export type SortKey = "name" | "size" | "modified" | "rating" | "year";
export type Theme = "system" | "dark" | "light";
/** 动效: auto (full unless this device turns out slow), full, or lite (no blur, grain, tilt or drift). */
export type MotionMode = "auto" | "full" | "lite";

interface Prefs {
  view: ViewMode;
  sortKey: SortKey;
  sortDesc: boolean;
  blur: boolean;
  theme: Theme;
  phoneCols: 2 | 3 | 4;
  /** 整理模式: library folders show only what is not organized yet. */
  organizing: boolean;
  setOrganizing: (on: boolean) => void;
  motion: MotionMode;
  setMotion: (motion: MotionMode) => void;
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
  organizing: false,
  setOrganizing: organizing => set({ organizing }),
  motion: "auto",
  setMotion: motion => set({ motion }),
  setPhoneCols: phoneCols => set({ phoneCols }),
  setView: view => set({ view }),
  setSort: key => set(state => state.sortKey === key ? { sortDesc: !state.sortDesc } : { sortKey: key, sortDesc: key !== "name" }),
  setBlur: blur => set({ blur }),
  setTheme: theme => {
    try { localStorage.setItem("tgvio-web:theme", theme); } catch { /* ignore */ }
    set({ theme });
  },
}), { name: "tgvio-web:prefs", partialize: ({ view, sortKey, sortDesc, blur, theme, phoneCols, organizing, motion }) => ({ view, sortKey, sortDesc, blur, theme, phoneCols, organizing, motion }) }));

export function resolvedTheme(theme: Theme): "dark" | "light" {
  if (theme !== "system") return theme;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
