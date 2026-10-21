/**
 * Server task names in plain words. OpenList names tasks in English with
 * mount points and real paths ("download magnet:?… to (/115/我要看)",
 * "transfer [](/data/temp/…) to [/115](/我要看)"); a decompress task even
 * carries the archive password. This turns them into "下载 潜伏 到 /115/我要看".
 */

const VERB: Record<string, string> = { copy: "复制", move: "移动", merge: "合并" };

function base(path: string): string {
  const clean = path.replace(/\/+$/, "");
  return clean.slice(clean.lastIndexOf("/") + 1) || clean;
}

function join(mount: string, path: string): string {
  return (`${mount.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`).replace(/\/+$/, "") || "/";
}

/** What a download URL is called: a magnet's dn, else its file name. */
function urlName(url: string): string {
  if (/^magnet:/i.test(url)) {
    const dn = /[?&]dn=([^&]+)/i.exec(url)?.[1];
    if (dn) try { return decodeURIComponent(dn.replace(/\+/g, " ")); } catch { return dn; }
    return `磁力 ${(/btih:([a-z0-9]{8})/i.exec(url)?.[1] ?? "").toLowerCase()}…`;
  }
  try { return decodeURIComponent(base(new URL(url).pathname)) || url; } catch { return url; }
}

export function taskName(raw: string): string {
  let m = /^download (.+) to \((.*)\)$/s.exec(raw);
  if (m) return `下载 ${urlName(m[1])} 到 ${m[2] || "/"}`;
  m = /^transfer \[(.*?)\]\((.*?)\) to \[(.*?)\]\((.*?)\)$/s.exec(raw);
  if (m) return `转存 ${base(m[2])} 到 ${join(m[3], m[4])}`;
  m = /^upload (.+) to \[(.*?)\]\((.*?)\)$/s.exec(raw);
  if (m) return `上传 ${m[1]} 到 ${join(m[2], m[3])}`;
  m = /^decompress \[(.*?)\]\((.*?)\)\[(.*?)\] to \[(.*?)\]\((.*?)\)/s.exec(raw);
  if (m) return `解压 ${base(m[2])}${m[3] && m[3] !== "/" ? ` 里的 ${m[3]}` : ""} 到 ${join(m[4], m[5])}`;
  m = /^(\w+) \[(.*?)\]\((.*?)\) to \[(.*?)\]\((.*?)\)$/s.exec(raw);
  if (m && VERB[m[1]]) return `${VERB[m[1]]} ${base(join(m[2], m[3]))} 到 ${join(m[4], m[5])}`;
  // Never show a password, whatever the format.
  return raw.replace(/ with password <.*>$/s, "");
}
