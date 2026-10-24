import { create } from "zustand";
import type { Magnet } from "../lib/magnets";
import type { Obj } from "../lib/types";

export type Dialog =
  | { kind: "mkdir"; dir: string }
  | { kind: "rename"; dir: string; obj: Obj }
  | { kind: "delete"; dir: string; names: string[] }
  | { kind: "transfer"; mode: "move" | "copy"; dir: string; names: string[] }
  | { kind: "info"; dir: string; obj: Obj }
  | { kind: "offline"; dir: string }
  | { kind: "share115"; dir: string }
  | { kind: "subtitle-search"; path: string }
  | { kind: "decompress"; dir: string; obj: Obj; innerPath: string; archivePass: string }
  | { kind: "share"; dir: string; names: string[] }
  | { kind: "shares" }
  /** `then`: the dialog to go back to once a poster is chosen (整理 asks again with the new film). */
  | { kind: "poster"; name: string; dir?: string; then?: Dialog }
  | { kind: "tmdb-rename"; targets: { path: string; only?: string[] }[] }
  | { kind: "resources"; query?: string; items?: Magnet[]; base?: string; folder?: string }
  | { kind: "account" };

export interface Rect { x: number; y: number; width: number; height: number }

interface UiState {
  viewer: { dir: string; name: string; origin: Rect | null } | null;
  palette: boolean;
  dialog: Dialog | null;
  menu: { x: number; y: number; dir: string; obj: Obj | null } | null;
  uploads: boolean;
  tasks: boolean;
  selected: Set<string>;
  selectionDir: string;
  openViewer: (dir: string, name: string, origin: Rect | null) => void;
  closeViewer: () => void;
  setPalette: (open: boolean) => void;
  openDialog: (dialog: Dialog) => void;
  closeDialog: () => void;
  openMenu: (menu: UiState["menu"]) => void;
  closeMenu: () => void;
  setUploads: (open: boolean) => void;
  setTasks: (open: boolean) => void;
  select: (dir: string, names: Iterable<string>) => void;
  toggle: (dir: string, name: string) => void;
  clearSelection: () => void;
}

export const useUi = create<UiState>((set, getState) => ({
  viewer: null,
  palette: false,
  dialog: null,
  menu: null,
  uploads: false,
  tasks: false,
  selected: new Set(),
  selectionDir: "",
  openViewer: (dir, name, origin) => set({ viewer: { dir, name, origin }, menu: null }),
  closeViewer: () => set({ viewer: null }),
  setPalette: palette => set({ palette, menu: null }),
  openDialog: dialog => set({ dialog, menu: null, palette: false }),
  closeDialog: () => set({ dialog: null }),
  openMenu: menu => set({ menu }),
  closeMenu: () => set({ menu: null }),
  setUploads: uploads => set({ uploads }),
  setTasks: tasks => set({ tasks }),
  select: (dir, names) => set({ selectionDir: dir, selected: new Set(names) }),
  toggle: (dir, name) => {
    const current = getState().selectionDir === dir ? new Set(getState().selected) : new Set<string>();
    if (current.has(name)) current.delete(name);
    else current.add(name);
    set({ selectionDir: dir, selected: current });
  },
  clearSelection: () => set({ selected: new Set(), selectionDir: "" }),
}));

/** Rect of an element in viewport coordinates. */
export function rectOf(element: Element | null | undefined): Rect | null {
  if (!element) return null;
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}
