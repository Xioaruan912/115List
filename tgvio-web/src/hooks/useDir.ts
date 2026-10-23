import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { listDir } from "../api/fs";
import { ApiError } from "../lib/api";

const PASSWORDS = "tgvio-web:passwords";

// Folder passwords are asked once per device: kept in localStorage for 30 days
// (they used to be per tab, so every new tab asked again), dropped on sign-out.
const TTL = 30 * 86_400_000;

function loadPasswords(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(PASSWORDS) ?? "{}") as { at?: number; list?: Record<string, string> };
    const old = JSON.parse(sessionStorage.getItem(PASSWORDS) ?? "{}") as Record<string, string>;
    const fresh = saved.at && Date.now() - saved.at < TTL ? saved.list ?? {} : {};
    return { ...old, ...fresh };
  } catch { return {}; }
}

const passwords = loadPasswords();

function savePasswords(): void {
  try { localStorage.setItem(PASSWORDS, JSON.stringify({ at: Date.now(), list: passwords })); } catch { /* ignore */ }
}

/** Sign-out: this device forgets the folder passwords. */
export function forgetPasswords(): void {
  for (const key of Object.keys(passwords)) delete passwords[key];
  try { localStorage.removeItem(PASSWORDS); sessionStorage.removeItem(PASSWORDS); } catch { /* ignore */ }
}

/** The password a user typed for this folder or the nearest ancestor. */
export function passwordFor(path: string): string {
  for (let probe = path; ; probe = probe.slice(0, Math.max(0, probe.lastIndexOf("/"))) || "/") {
    if (passwords[probe]) return passwords[probe];
    if (probe === "/") return "";
  }
}

export function rememberPassword(path: string, password: string): void {
  passwords[path] = password;
  savePasswords();
}

export const dirKey = (path: string) => ["list", path] as const;

export function needsPassword(error: unknown): boolean {
  return error instanceof ApiError && error.code === 403 && /password/i.test(error.message);
}

export function fetchDir(path: string, refresh = false, signal?: AbortSignal) {
  return listDir(path, passwordFor(path), refresh, signal);
}

export function useDir(path: string) {
  return useQuery({
    queryKey: dirKey(path),
    queryFn: ({ signal }) => fetchDir(path, false, signal),
    staleTime: 20_000,
    retry: (count, error) => !needsPassword(error) && !(error instanceof ApiError && error.code < 500) && count < 1,
  });
}

let prefetching = false;

/**
 * Hovering a folder warms its listing, one request at a time and only for folders
 * not already cached: the 115 API is rate limited and listing is the costly call.
 */
export function prefetchDir(client: QueryClient, path: string): void {
  if (prefetching || client.getQueryData(dirKey(path))) return;
  prefetching = true;
  void client.prefetchQuery({ queryKey: dirKey(path), queryFn: ({ signal }) => fetchDir(path, false, signal), staleTime: 20_000 })
    .finally(() => { prefetching = false; });
}

export function useRefreshDir() {
  const client = useQueryClient();
  return useCallback(async (path: string, hard = false) => {
    if (hard) {
      const data = await fetchDir(path, true);
      client.setQueryData(dirKey(path), data);
    } else {
      await client.invalidateQueries({ queryKey: dirKey(path) });
    }
  }, [client]);
}
