import { get, post } from "../lib/api";

/** One signed-in device: a browser on a phone or computer. */
export interface Device {
  id: string;
  user_id: number;
  username: string;
  device: string;
  browser: string;
  ip: string;
  created: string;
  last_seen: string;
  current: boolean;
}

export interface DeviceList { devices: Device[]; idle_days: number }

export const devices = {
  mine: () => get<DeviceList>("/me/devices"),
  revoke: (id: string) => post<{ revoked: number }>("/me/devices/revoke", { id }),
  revokeOthers: () => post<{ revoked: number }>("/me/devices/revoke", { others: true }),
  ofUser: (userId: number) => get<DeviceList>("/admin/tgvio/devices", { user_id: userId }),
  adminRevoke: (id: string) => post<{ revoked: number }>("/admin/tgvio/devices/revoke", { id }),
  adminRevokeAll: (userId: number) => post<{ revoked: number }>("/admin/tgvio/devices/revoke", { user_id: userId, all: true }),
  config: () => get<{ idle_days: number }>("/admin/tgvio/sessions"),
  setConfig: (idleDays: number) => post<{ idle_days: number }>("/admin/tgvio/sessions", { idle_days: idleDays }),
};
