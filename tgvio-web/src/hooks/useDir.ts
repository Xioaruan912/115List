import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { listDir } from "../api/fs";
import { ApiError } from "../lib/api";

const PASSWORDS = "tgvio-web:passwords";

// Folder passwords live in this page's memory only: every visit (a reload, a
// new tab, opening the site again) asks again, as a protected folder should.
const passwords: Record<string, string> = {};
// The last one typed, tried on folders above where it was typed (opened a
// subfolder's link first, then went up): one password usually guards them all.
let lastTyped = "";

// Passwords kept by older versions (30 days in localStorage) are dropped.
try { localStorage.removeItem(PASSWORDS); sessionStorage.removeItem(PASSWORDS); } catch { /* ignore */ }

/** Sign-out: this page forgets the folder passwords. */
export function forgetPasswords(): void {
  for (const key of Object.keys(passwords)) delete passwords[key];
  lastTyped = "";
}

/** The password a user typed for this folder or the nearest ancestor. */
export function passwordFor(path: string): string {
  for (let probe = path; ; probe = probe.slice(0, Math.max(0, probe.lastIndexOf("/"))) || "/") {
    if (passwords[probe]) return passwords[probe];
    if (probe === "/") return lastTyped;
  }
}

export function rememberPassword(path: string, password: string): void {
  passwords[path] = password;
  lastTyped = password;
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
