import { get, post } from "../lib/api";
import type { DriverInfo, Meta, Page, RecycleItem, SettingItem, Storage, TaskInfo, TgvioStats, User } from "../lib/types";

export const storages = {
  list: () => get<Page<Storage>>("/admin/storage/list", { page: 1, per_page: 0 }),
  get: (id: number) => get<Storage>("/admin/storage/get", { id }),
  create: (storage: Partial<Storage>) => post<{ id: number }>("/admin/storage/create", storage),
  update: (storage: Partial<Storage>) => post<null>("/admin/storage/update", storage),
  remove: (id: number) => post<null>("/admin/storage/delete", undefined, { id }),
  enable: (id: number) => post<null>("/admin/storage/enable", undefined, { id }),
  disable: (id: number) => post<null>("/admin/storage/disable", undefined, { id }),
  reloadAll: () => post<null>("/admin/storage/load_all"),
};

export const drivers = {
  list: () => get<Record<string, DriverInfo>>("/admin/driver/list"),
};

export const users = {
  list: () => get<Page<User>>("/admin/user/list", { page: 1, per_page: 0 }),
  create: (user: Partial<User>) => post<null>("/admin/user/create", user),
  update: (user: Partial<User>) => post<null>("/admin/user/update", user),
  remove: (id: number) => post<null>("/admin/user/delete", undefined, { id }),
  cancel2fa: (id: number) => post<null>("/admin/user/cancel_2fa", undefined, { id }),
};

export const settings = {
  list: (groups: number[]) => get<SettingItem[]>("/admin/setting/list", { groups: groups.join(",") }),
  save: (items: SettingItem[]) => post<null>("/admin/setting/save", items),
  resetToken: () => post<string>("/admin/setting/reset_token"),
};

export const metas = {
  list: () => get<Page<Meta>>("/admin/meta/list", { page: 1, per_page: 0 }),
  create: (meta: Partial<Meta>) => post<null>("/admin/meta/create", meta),
  update: (meta: Partial<Meta>) => post<null>("/admin/meta/update", meta),
  remove: (id: number) => post<null>("/admin/meta/delete", undefined, { id }),
};

export const TASK_TYPES = [
  ["upload", "上传"],
  ["copy", "复制"],
  ["move", "移动"],
  ["offline_download", "离线下载"],
  ["offline_download_transfer", "离线转存"],
  ["decompress", "解压"],
  ["decompress_upload", "解压上传"],
] as const;

export type TaskType = typeof TASK_TYPES[number][0];

export const tasks = {
  undone: (type: TaskType) => get<TaskInfo[] | null>(`/task/${type}/undone`),
  done: (type: TaskType) => get<TaskInfo[] | null>(`/task/${type}/done`),
  cancel: (type: TaskType, tid: string) => post<null>(`/task/${type}/cancel`, undefined, { tid }),
  remove: (type: TaskType, tid: string) => post<null>(`/task/${type}/delete`, undefined, { tid }),
  retry: (type: TaskType, tid: string) => post<null>(`/task/${type}/retry`, undefined, { tid }),
  clearDone: (type: TaskType) => post<null>(`/task/${type}/clear_done`),
  clearSucceeded: (type: TaskType) => post<null>(`/task/${type}/clear_succeeded`),
  retryFailed: (type: TaskType) => post<null>(`/task/${type}/retry_failed`),
};

export const tgvio = {
  stats: () => get<TgvioStats>("/tgvio/stats"),
  recycle: (offset: number, limit: number) => get<{ items: RecycleItem[] | null; page_bytes: number; has_more: boolean }>("/admin/tgvio/recycle", { offset, limit }),
  clean: (ids: string[]) => post<unknown>("/admin/tgvio/recycle/clean", { ids }),
};
