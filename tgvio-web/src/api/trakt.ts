import { get, post } from "../lib/api";

/** Trakt: a public (PKCE) application — a Client ID, no secret. */
export interface TraktStatus {
  client_id: string;
  redirect: string;
  connected: boolean;
  expires_at?: number;
}

export const trakt = {
  get: () => get<TraktStatus>("/admin/tgvio/trakt"),
  setId: (client_id: string) => post<{ client_id: string }>("/admin/tgvio/trakt", { client_id }),
  connect: () => post<{ url: string }>("/admin/tgvio/trakt/connect"),
  disconnect: () => post<null>("/admin/tgvio/trakt/disconnect"),
};
