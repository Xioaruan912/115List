import type { SortKey } from "../stores/prefs";
import type { Obj } from "./types";

const collator = new Intl.Collator(["zh-CN", "en"], { numeric: true, sensitivity: "base" });

export function sortObjs(items: Obj[], key: SortKey, desc: boolean): Obj[] {
  const sign = desc ? -1 : 1;
  return [...items].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    let diff = 0;
    if (key === "size") diff = a.size - b.size;
    else if (key === "modified") diff = Date.parse(a.modified) - Date.parse(b.modified);
    if (diff === 0) diff = collator.compare(a.name, b.name) * (key === "name" ? 1 : sign);
    return diff * sign;
  });
}
