export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export const ObjType = { Unknown: 0, Folder: 1, Video: 2, Audio: 3, Text: 4, Image: 5 } as const;

export interface Obj {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
  created: string;
  sign: string;
  thumb: string;
  type: number;
  hashinfo: string;
  mount_details?: { driver_name?: string; total_space?: number; free_space?: number } | null;
}

export interface FsList {
  content: Obj[] | null;
  total: number;
  readme: string;
  header: string;
  write: boolean;
  provider: string;
}

export interface FsGet extends Obj {
  raw_url: string;
  readme: string;
  header: string;
  provider: string;
  related: Obj[] | null;
}

export interface Me {
  id: number;
  username: string;
  base_path: string;
  role: number;
  disabled: boolean;
  permission: number;
  otp: boolean;
}

export const Role = { General: 0, Guest: 1, Admin: 2 } as const;

export type Settings = Record<string, string>;

export interface SearchNode {
  parent: string;
  name: string;
  is_dir: boolean;
  size: number;
  type: number;
}

export interface TaskInfo {
  id: string;
  name: string;
  creator: string;
  state: number;
  status: string;
  progress: number;
  start_time: string | null;
  end_time: string | null;
  total_bytes: number;
  error: string;
}

export interface Storage {
  id: number;
  mount_path: string;
  order: number;
  driver: string;
  cache_expiration: number;
  custom_cache_policies: string;
  status: string;
  addition: string;
  remark: string;
  modified: string;
  disabled: boolean;
  disable_index: boolean;
  enable_sign: boolean;
  order_by: string;
  order_direction: string;
  extract_folder: string;
  web_proxy: boolean;
  webdav_policy: string;
  proxy_range: boolean;
  down_proxy_url: string;
  disable_proxy_sign: boolean;
  [key: string]: unknown;
}

export interface DriverItem {
  name: string;
  type: string;
  default: string;
  options: string;
  required: boolean;
  help: string;
}

export interface DriverInfo {
  common: DriverItem[];
  additional: DriverItem[];
  config: { name: string; local_sort?: boolean; no_upload?: boolean; default_root?: string; [key: string]: unknown };
}

export interface User {
  id: number;
  username: string;
  password: string;
  base_path: string;
  role: number;
  disabled: boolean;
  permission: number;
  sso_id: string;
  allow_ldap: boolean;
}

export interface SettingItem {
  key: string;
  value: string;
  help: string;
  type: string;
  options: string;
  group: number;
  flag: number;
  index: number;
}

export interface Meta {
  id: number;
  path: string;
  password: string;
  p_sub: boolean;
  write: boolean;
  w_sub: boolean;
  hide: string;
  h_sub: boolean;
  readme: string;
  r_sub: boolean;
  header: string;
  header_sub: boolean;
  read_users: number[] | null;
  read_users_sub: boolean;
  write_users: number[] | null;
  write_users_sub: boolean;
}

export interface Page<T> {
  content: T[] | null;
  total: number;
}

export interface TgvioStats {
  started_at: string;
  uptime_seconds: number;
  counters: Record<string, number>;
  state: Record<string, unknown>;
  space: { total_bytes?: number; used_bytes?: number; free_bytes?: number; error?: string };
}

export interface RecycleItem {
  id: string;
  name: string;
  size: number;
  parent: string;
  deleted_at: number;
}

export interface UploadSnapshot {
  upload_id: string;
  state: "receiving" | "completed" | "failed_retriable" | "failed_permanent" | "aborted";
  attempt: number;
  path: string;
  size: number;
  chunk_size: number;
  total_chunks: number;
  received: [number, number][];
  received_bytes: number;
  frontier: number;
  storage_progress: number;
  error?: string;
}
