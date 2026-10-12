declare global {
  interface Window {
    OPENLIST_CONFIG?: { cdn?: string; base_path?: string; api?: string; main_color?: string };
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

const raw = typeof window === "undefined" ? undefined : window.OPENLIST_CONFIG;

/** Site base path without a trailing slash ("" at the root). */
export const basePath = trimSlash(raw?.base_path && raw.base_path !== "/" ? raw.base_path : "");

/** Origin + base of the API. */
export const apiBase = trimSlash(raw?.api || basePath);
