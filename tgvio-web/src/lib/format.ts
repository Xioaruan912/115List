const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exp = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exp;
  return `${exp === 0 ? value : value.toFixed(value >= 100 ? 0 : digits)} ${UNITS[exp]}`;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function formatDate(iso: string | number | Date, now: Date = new Date()): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  const time = date.getTime();
  if (!Number.isFinite(time) || date.getFullYear() < 1980) return "";
  const diff = (now.getTime() - time) / 1000;
  if (diff >= 0 && diff < 60) return "刚刚";
  if (diff >= 0 && diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff >= 0 && diff < 86400 && now.getDate() === date.getDate()) return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameYear = now.getFullYear() === date.getFullYear();
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return sameYear ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : `${date.getFullYear()}-${day}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} 天 ${h} 小时`;
  if (h) return `${h} 小时 ${m} 分`;
  return `${m} 分 ${s % 60} 秒`;
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}
