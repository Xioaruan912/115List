import { apiBase } from "./config";
import { encodePath } from "./path";
import type { Obj } from "./types";

function signed(prefix: string, path: string, sign: string): string {
  return `${apiBase}${prefix}${encodePath(path)}${sign ? `?sign=${encodeURIComponent(sign)}` : ""}`;
}

/** Direct download: OpenList redirects to the drive or proxies, per storage settings. */
export const downloadUrl = (path: string, obj: Pick<Obj, "sign">): string => signed("/d", path, obj.sign);

/** Always proxied through OpenList: same-origin, so fetch() can read it. */
export const proxyUrl = (path: string, obj: Pick<Obj, "sign">): string => signed("/p", path, obj.sign);

export function absolute(url: string): string {
  return new URL(url, location.href).href;
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}
