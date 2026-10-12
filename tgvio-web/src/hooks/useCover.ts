import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { kindOf, type Kind } from "../lib/kind";
import type { FsList } from "../lib/types";
import { dirKey, fetchDir } from "./useDir";

/**
 * What a folder looks like from outside: the first few thumbnails inside it and
 * what kind of things it holds. Covers are fetched for folders that sit on screen
 * for a moment, strictly one listing at a time (the 115 API is rate limited), and
 * remembered for half an hour so scrolling back costs nothing. The listing goes
 * into the query cache too, so opening the folder afterwards is instant.
 */
export interface Cover { thumbs: string[]; count: number; kinds: Kind[] }

const KEY = "tgvio-web:covers";
const TTL = 30 * 60_000;
const MAX = 400;

type Stored = Record<string, Cover & { at: number }>;

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Stored;
    const now = Date.now();
    for (const key of Object.keys(raw)) if (now - raw[key].at > TTL) delete raw[key];
    return raw;
  } catch { return {}; }
}

let stored = load();
const failed = new Set<string>();
const listeners = new Set<() => void>();
let saveTimer = 0;

function remember(path: string, cover: Cover): void {
  stored = { ...stored, [path]: { ...cover, at: Date.now() } };
  const keys = Object.keys(stored);
  if (keys.length > MAX) for (const key of keys.sort((a, b) => stored[a].at - stored[b].at).slice(0, keys.length - MAX)) delete stored[key];
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(stored)); } catch { /* full: covers are a nicety */ } }, 400);
  for (const listener of listeners) listener();
}

export function coverFrom(list: FsList): Cover {
  const content = list.content ?? [];
  const thumbs: string[] = [];
  const kinds: Kind[] = [];
  for (const item of content) {
    if (item.thumb && thumbs.length < 4) thumbs.push(item.thumb);
    const kind = kindOf(item);
    if (!kinds.includes(kind) && kinds.length < 3) kinds.push(kind);
  }
  return { thumbs, count: content.length, kinds };
}

const queue: { path: string; client: QueryClient }[] = [];
const queued = new Set<string>();
let running = false;

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.pop()!; // newest first: what just scrolled into view
    queued.delete(job.path);
    if (stored[job.path] || failed.has(job.path)) continue;
    try {
      const cached = job.client.getQueryData<FsList>(dirKey(job.path));
      const list = cached ?? await fetchDir(job.path);
      if (!cached) job.client.setQueryData(dirKey(job.path), list);
      remember(job.path, coverFrom(list));
      if (!cached) await new Promise(resolve => setTimeout(resolve, 140));
    } catch {
      failed.add(job.path); // password-protected or unreadable: keep the plain folder
      for (const listener of listeners) listener();
    }
  }
  running = false;
}

function request(path: string, client: QueryClient): void {
  if (stored[path] || failed.has(path) || queued.has(path)) return;
  queued.add(path);
  queue.push({ path, client });
  if (queue.length > 24) queued.delete(queue.shift()!.path); // scrolled far past: drop the oldest
  void pump();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The cover for a folder once it has been on screen for a beat. */
export function useCover(path: string, ref: RefObject<Element | null>, enabled = true): Cover | null | undefined {
  const client = useQueryClient();
  const cover = useSyncExternalStore(subscribe, () => stored[path]);
  const gaveUp = useSyncExternalStore(subscribe, () => failed.has(path));
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || cover || seen || !element) return;
    let timer = 0;
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(timer);
      if (entry.isIntersecting) timer = window.setTimeout(() => setSeen(true), 260);
    }, { rootMargin: "120px 0px" });
    observer.observe(element);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [enabled, cover, seen, ref]);

  useEffect(() => {
    if (!enabled || cover || !seen) return;
    // Already listed (hovered or visited)? Then it is free.
    const cached = client.getQueryData<FsList>(dirKey(path));
    if (cached) remember(path, coverFrom(cached));
    else request(path, client);
  }, [enabled, cover, seen, path, client]);

  if (gaveUp) return null;
  return cover;
}

/** Keep covers fresh when a folder's listing changes in this tab. */
export function refreshCover(path: string, list: FsList): void {
  if (stored[path]) remember(path, coverFrom(list));
}
