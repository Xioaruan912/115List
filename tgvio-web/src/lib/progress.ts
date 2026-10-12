/**
 * Where each video was left off, kept in this browser only. The viewer writes it
 * while playing; cinema mode reads it for the "继续观看" row and the poster bars.
 */
const KEY = "tgvio-web:progress";
const LIMIT = 120;

export interface Progress { time: number; duration: number; at: number }

type Store = Record<string, Progress>;

function load(): Store {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store; } catch { return {}; }
}

let store = load();
const listeners = new Set<() => void>();

export function getProgress(path: string): Progress | undefined {
  return store[path];
}

/** Fraction watched, 0 when unknown. */
export function watched(path: string): number {
  const entry = store[path];
  return entry && entry.duration > 0 ? Math.min(1, entry.time / entry.duration) : 0;
}

/** A resume point worth offering: past the opening, not at the credits. */
export function resumeAt(path: string): number {
  const entry = store[path];
  if (!entry || entry.time < 15 || entry.duration - entry.time < 25) return 0;
  return entry.time;
}

export function saveProgress(path: string, time: number, duration: number): void {
  if (!Number.isFinite(duration) || duration < 60) return;
  const done = duration - time < 25;
  const next: Store = { ...store };
  if (done) delete next[path];
  else next[path] = { time: Math.round(time), duration: Math.round(duration), at: Date.now() };
  const keys = Object.keys(next);
  if (keys.length > LIMIT) {
    for (const key of keys.sort((a, b) => next[a].at - next[b].at).slice(0, keys.length - LIMIT)) delete next[key];
  }
  store = next;
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* quota: progress is a nicety */ }
  for (const listener of listeners) listener();
}

/** Videos in this folder that were started and not finished, most recent first. */
export function inProgress(dir: string): { name: string; progress: Progress }[] {
  const prefix = dir === "/" ? "/" : `${dir}/`;
  return Object.entries(store)
    .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
    .map(([path, progress]) => ({ name: path.slice(prefix.length), progress }))
    .sort((a, b) => b.progress.at - a.progress.at);
}

export function subscribeProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
