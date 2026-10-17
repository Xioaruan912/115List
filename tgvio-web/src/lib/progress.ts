import { apiUrl, authHeaders, get, post } from "./api";

/**
 * Where each video was left off. Kept in this browser for instant reads and on
 * the server per account, so a film started on the phone resumes on the laptop:
 * changes go up a few seconds after they happen (and as the page closes), the
 * server's copy comes down when the site opens or the tab comes back. Entries
 * merge one by one, the newer winning. A finished video stays as a "done"
 * entry, so other devices learn it is finished and posters can say so.
 */
const KEY = "tgvio-web:progress";
const OWNER_KEY = "tgvio-web:progress-owner";
const LIMIT = 1000;

export interface Progress { time: number; duration: number; at: number; done?: boolean }

type Store = Record<string, Progress>;

function load(): Store {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store; } catch { return {}; }
}

let store = load();
const listeners = new Set<() => void>();

function commit(next: Store): void {
  const keys = Object.keys(next);
  if (keys.length > LIMIT) {
    for (const key of keys.sort((a, b) => next[a].at - next[b].at).slice(0, keys.length - LIMIT)) delete next[key];
  }
  store = next;
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* quota: progress is a nicety */ }
  for (const listener of listeners) listener();
}

export function getProgress(path: string): Progress | undefined {
  const entry = store[path];
  return entry && !entry.done ? entry : undefined;
}

/** Fraction watched, 0 when unknown, 1 once finished. */
export function watched(path: string): number {
  const entry = store[path];
  if (!entry) return 0;
  if (entry.done) return 1;
  return entry.duration > 0 ? Math.min(1, entry.time / entry.duration) : 0;
}

/** A resume point worth offering: past the opening, not at the credits. */
export function resumeAt(path: string): number {
  const entry = store[path];
  if (!entry || entry.done || entry.time < 15 || entry.duration - entry.time < 25) return 0;
  return entry.time;
}

export function saveProgress(path: string, time: number, duration: number): void {
  if (!Number.isFinite(duration) || duration < 60) return;
  const done = duration - time < 25;
  const entry: Progress = done
    ? { time: Math.round(duration), duration: Math.round(duration), at: Date.now(), done: true }
    : { time: Math.round(time), duration: Math.round(duration), at: Date.now() };
  commit({ ...store, [path]: entry });
  queue(path, entry);
}

/** Videos in this folder that were started and not finished, most recent first. */
export function inProgress(dir: string): { name: string; progress: Progress }[] {
  const prefix = dir === "/" ? "/" : `${dir}/`;
  return Object.entries(store)
    .filter(([path, progress]) => !progress.done && path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
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

/* ---------------------------------------------------------------- sync */

let syncing = false; // signed in as a real account; guests keep progress local
let pending: Store = {};
let timer = 0;

function queue(path: string, entry: Progress): void {
  if (!syncing) return;
  pending[path] = entry;
  clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), 5000);
}

/** Server entries newer than ours replace ours. */
function adopt(items: Store | null | undefined): void {
  if (!items) return;
  let next: Store | null = null;
  for (const [path, entry] of Object.entries(items)) {
    const mine = store[path];
    if (mine && mine.at >= entry.at) continue;
    next ??= { ...store };
    next[path] = entry;
  }
  if (next) commit(next);
}

async function flush(): Promise<void> {
  clearTimeout(timer);
  const items = pending;
  if (!syncing || !Object.keys(items).length) return;
  pending = {};
  try {
    adopt((await post<{ items: Store }>("/tgvio/progress", { items })).items);
  } catch {
    pending = { ...items, ...pending }; // offline: try again with the next change
  }
}

/** The page is going away: send what is left without waiting for an answer. */
function flushOnExit(): void {
  if (!syncing || !Object.keys(pending).length) return;
  try {
    void fetch(apiUrl("/tgvio/progress"), {
      method: "POST", keepalive: true,
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ items: pending }),
    });
    pending = {};
  } catch { /* best effort */ }
}

async function pull(): Promise<void> {
  try { adopt((await get<{ items: Store }>("/tgvio/progress")).items); } catch { /* offline: local copy stands */ }
}

let wired = false;

/**
 * Start syncing for the signed-in account (null: signed out or a guest). A
 * browser that switches accounts drops the previous one's local copy; the first
 * sync sends up what this browser recorded before syncing existed.
 */
export function syncProgress(account: string | null): void {
  syncing = !!account;
  if (!account) return;
  let owner = "";
  try { owner = localStorage.getItem(OWNER_KEY) ?? ""; localStorage.setItem(OWNER_KEY, account); } catch { /* ignore */ }
  if (owner && owner !== account) commit({});
  else if (!owner) Object.assign(pending, store);
  void flush().then(pull);
  if (wired) return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnExit();
    else if (syncing) void pull();
  });
  window.addEventListener("pagehide", flushOnExit);
}

/** Videos started and not finished anywhere, most recent first. */
export function recentProgress(limit = 16): { path: string; progress: Progress }[] {
  return Object.entries(store)
    .filter(([, progress]) => !progress.done)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, limit)
    .map(([path, progress]) => ({ path, progress }));
}
