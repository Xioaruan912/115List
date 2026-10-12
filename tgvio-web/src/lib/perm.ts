import { Role, type Me } from "./types";

export const Perm = {
  SeeHides: 0,
  NoPassword: 1,
  Offline: 2,
  Write: 3,
  Rename: 4,
  Move: 5,
  Copy: 6,
  Remove: 7,
  WebdavRead: 8,
  WebdavManage: 9,
  FtpRead: 10,
  FtpManage: 11,
  ReadArchives: 12,
  Decompress: 13,
  Share: 14,
  CustomShareId: 15,
} as const;

export const PERM_LABELS: [number, string][] = [
  [Perm.SeeHides, "查看隐藏文件"],
  [Perm.NoPassword, "免密访问"],
  [Perm.Offline, "离线下载"],
  [Perm.Write, "新建与上传"],
  [Perm.Rename, "重命名"],
  [Perm.Move, "移动"],
  [Perm.Copy, "复制"],
  [Perm.Remove, "删除"],
  [Perm.WebdavRead, "WebDAV 读取"],
  [Perm.WebdavManage, "WebDAV 管理"],
  [Perm.FtpRead, "FTP 读取"],
  [Perm.FtpManage, "FTP 管理"],
  [Perm.ReadArchives, "读取压缩包"],
  [Perm.Decompress, "解压"],
  [Perm.Share, "分享"],
  [Perm.CustomShareId, "自定义分享 ID"],
];

export function hasBit(permission: number, bit: number): boolean {
  return ((permission >> bit) & 1) === 1;
}

export function isAdmin(me: Me | null | undefined): boolean {
  return me?.role === Role.Admin;
}

export function isGuest(me: Me | null | undefined): boolean {
  return !me || me.role === Role.Guest;
}

/** Admins can do everything; other users by their permission bits. */
export function can(me: Me | null | undefined, bit: number, dirWritable = false): boolean {
  if (!me) return false;
  if (isAdmin(me)) return true;
  if (bit === Perm.Write && dirWritable) return true;
  return hasBit(me.permission, bit);
}
