import type { Settings } from "./types";

/** OpenList's stock logo, which the site replaces with its letter mark. */
export function isStockLogo(url: string | undefined): boolean {
  const value = (url ?? "").trim();
  return !value || value.includes("res.oplist.org/logo/") || value.includes("cdn.oplist.org/gh/OpenListTeam/Logo");
}

export function markLetter(title: string | undefined): string {
  const first = [...(title ?? "").trim()][0];
  return first ? first.toUpperCase() : "O";
}

/**
 * iOS ignores SVG touch icons, so draw the mark into a PNG for "Add to Home
 * Screen". The browser tab already gets the server's SVG mark.
 */
export async function applyTouchIcon(settings: Settings): Promise<void> {
  if (!isStockLogo(settings.logo?.split("\n")[0]) || typeof document === "undefined") return;
  const size = 180;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const font = `700 ${Math.round(size * 0.58)}px "Geist Variable", -apple-system, "PingFang SC", sans-serif`;
  try { await document.fonts.load(font); } catch { /* fall back to system fonts */ }
  ctx.fillStyle = "#c4ec5c";
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.234);
  ctx.fill();
  ctx.fillStyle = "#11140b";
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(markLetter(settings.site_title), size / 2, size * 0.52);
  let link = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "apple-touch-icon";
    document.head.append(link);
  }
  link.href = canvas.toDataURL("image/png");
}
