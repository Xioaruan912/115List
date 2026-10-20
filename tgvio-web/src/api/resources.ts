import { get, post } from "../lib/api";

/** A resource site: its search page, with {q} where the keywords go. */
/** reader: how the server reads the site itself ("seedhub"); empty: the site only opens in the browser. */
export interface ResourceSite { id: string; name: string; search: string; enabled?: boolean; reader?: "" | "seedhub" }
export interface ResourceTitle { id: string; title: string; year?: number; kind?: string; info?: string; image?: string; rating?: number; url: string }
export interface ResourceSeed { id: string; title: string; size?: string; features?: string[]; date?: string }
export interface ResourceConfig { enabled: boolean; sites: ResourceSite[] }
/** How a site answered the server: ok, a bot check (fine in a browser), or nothing. */
export interface ProbeResult { id: string; state: "ok" | "challenge" | "down"; status?: number; ms: number; message?: string }

export const resources = {
  list: () => get<{ enabled: boolean; sites: ResourceSite[] }>("/tgvio/resources"),
  titles: (site: string, q: string) => post<{ items: ResourceTitle[] }>("/tgvio/resources/titles", { site, q }),
  seeds: (site: string, id: string) => post<{ items: ResourceSeed[] }>("/tgvio/resources/seeds", { site, id }),
  magnets: (site: string, seeds: string[]) => post<{ items: { seed: string; url?: string; error?: string }[] }>("/tgvio/resources/magnets", { site, seeds }),
};

export const resourceAdmin = {
  get: () => get<{ config: ResourceConfig; default: ResourceSite[] }>("/admin/tgvio/resources"),
  save: (config: ResourceConfig) => post<{ config: ResourceConfig; default: ResourceSite[] }>("/admin/tgvio/resources", config),
  probe: () => post<{ results: ProbeResult[] }>("/admin/tgvio/resources/probe"),
};

export function searchURL(site: ResourceSite, query: string): string {
  return site.search.replaceAll("{q}", encodeURIComponent(query.trim()));
}

/**
 * Whether this browser reaches a site: a no-cors request settles when the site
 * answers at all (even with a check page) and fails when it cannot be reached.
 */
export async function reachable(site: ResourceSite, timeout = 6000): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    await fetch(new URL(site.search.replaceAll("{q}", "")).origin + "/favicon.ico", { mode: "no-cors", cache: "no-store", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
