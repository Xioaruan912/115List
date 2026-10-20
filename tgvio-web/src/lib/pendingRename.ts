/**
 * Folders made by 找资源 as a collection: once their downloads arrive, the
 * folder offers 按 TMDB 整理命名. Kept on this device for 30 days.
 */
const KEY = "tgvio-web:pending-rename";
const TTL = 30 * 86_400_000;

type Entry = { path: string; at: number };

function read(): Entry[] {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? "[]") as Entry[]).filter(entry => Date.now() - entry.at < TTL); } catch { return []; }
}

function write(entries: Entry[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(entries.slice(-50))); } catch { /* storage full or off */ }
}

export function markPendingRename(path: string): void {
  write([...read().filter(entry => entry.path !== path), { path, at: Date.now() }]);
}

export function pendingRename(path: string): boolean {
  return read().some(entry => entry.path === path);
}

export function clearPendingRename(path: string): void {
  write(read().filter(entry => entry.path !== path));
}
