import { get, post } from "../lib/api";

/** A 115 storage whose signed-in account can be browsed; `root` is the folder it mounts. */
export interface MountSource { id: number; mount_path: string; status: string; root: string }
export interface DriveFolder { id: string; name: string }

export const mount115 = {
  sources: () => get<MountSource[]>("/admin/tgvio/115/sources"),
  folders: (source: number, id: string, refresh = false) =>
    get<{ folders: DriveFolder[]; sources: MountSource[] }>("/admin/tgvio/115/folders", { source, id, ...(refresh ? { refresh: 1 } : {}) }),
  mount: (source: number, id: string, mountPath: string) => post<{ id: number; mount_path: string }>("/admin/tgvio/115/mount", { source, id, mount_path: mountPath }),
};
