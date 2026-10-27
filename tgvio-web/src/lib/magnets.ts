/**
 * Magnets pasted back from a resource site: pulled out of whatever was copied
 * (plain text, a copied piece of web page, a bookmarklet's list), named, sized
 * and tagged the way a Chinese viewer picks: Chinese subtitles first, then
 * Chinese audio, then picture quality. A season pack or a "全 N 集" counts as a
 * 合集 (a whole series in one go).
 */

export interface Magnet {
  /** The magnet as given, with its info hash. */
  url: string;
  hash: string;
  title: string;
  /** Bytes, when the link (xl=) or the text beside it says. */
  size?: number;
  tags: Tag[];
  /** Picture height: 2160, 1080, 720, 480. */
  height?: number;
  collection: boolean;
  /** Higher is better. */
  score: number;
  /** Read by the server from a site: the magnet is fetched when it is downloaded. */
  seed?: { site: string; id: string };
}

export type Tag = "中字" | "双语" | "国语" | "粤语" | "4K" | "1080P" | "720P" | "HDR" | "杜比视界" | "H265" | "原盘" | "REMUX" | "蓝光" | "WEB" | "合集";

const SUBS = /中字|中文字幕|简中|繁中|简繁|繁简|简体|繁體|繁体|中英|中日|中韩|内封|内嵌|外挂字幕|官中|\bchs\b|\bcht\b|\bzh[-_.]?(cn|tw|hans|hant)\b|\bgb\b|\bbig5\b/i;
const BILINGUAL = /双语|雙語|中英|中日|中韩|双字/i;
const MANDARIN = /国语|國語|普通话|国配|國配|\bmandarin\b/i;
const CANTONESE = /粤语|粵語|国粤|國粵|\bcantonese\b/i;
const COLLECTION = /合集|\bE[Pp]?\d{1,3}\s*[-~]\s*E?[Pp]?\d{1,3}\b|全\s*\d+\s*[集话話季]|全集|\bcomplete\b|\bS\d{1,2}\s*[-~]\s*S?\d{1,2}\b|第\s*[\d一二三四五六七八九十]+\s*[-~至到]\s*[\d一二三四五六七八九十]+\s*季|\b(S\d{1,2})\b(?![\s._-]*E\d)|第\s*[\d一二三四五六七八九十]+\s*季(?![\s._-]*第?\s*\d+\s*[集话話])/i;
const SINGLE_EPISODE = /\bS\d{1,2}\s*E\d{1,4}\b(?!\s*[-~]\s*E?\d)|第\s*\d+\s*[集话話](?!\s*[-~])/i;

/** "12.3 GB", "800MB", "1.2T" → bytes. */
export function parseSize(text: string): number | undefined {
  // "4K" is a picture size, not 4 KB: kilobytes need their B.
  const m = /(\d+(?:\.\d+)?)\s*(?:([TGM])i?B?|(K)i?B)(?![a-z])/i.exec(text);
  if (!m) return undefined;
  const unit = { T: 2 ** 40, G: 2 ** 30, M: 2 ** 20, K: 2 ** 10 }[(m[2] ?? m[3]).toUpperCase() as "T" | "G" | "M" | "K"];
  return Math.round(Number(m[1]) * unit);
}

function heightOf(text: string): number | undefined {
  if (/2160p|\b4k\b|\buhd\b/i.test(text)) return 2160;
  if (/1080[pi]|\bfhd\b/i.test(text)) return 1080;
  if (/720p/i.test(text)) return 720;
  if (/480p|\bsd\b/i.test(text)) return 480;
  return undefined;
}

/** Tags, height and score for a title (and whatever text came with it). */
export function describe(title: string, extra = ""): Pick<Magnet, "tags" | "height" | "collection" | "score"> {
  const text = `${title} ${extra}`;
  const tags: Tag[] = [];
  const has = (re: RegExp) => re.test(text);
  const subs = has(SUBS);
  if (subs) tags.push("中字");
  if (has(BILINGUAL)) tags.push("双语");
  if (has(MANDARIN)) tags.push("国语");
  if (has(CANTONESE)) tags.push("粤语");
  const height = heightOf(text);
  if (height === 2160) tags.push("4K");
  else if (height === 1080) tags.push("1080P");
  else if (height === 720) tags.push("720P");
  if (/\bhdr(10\+?)?\b/i.test(text)) tags.push("HDR");
  if (/\bdv\b|dolby\s*vision|杜比视界/i.test(text)) tags.push("杜比视界");
  if (/[hx]\.?265|\bhevc\b/i.test(text)) tags.push("H265");
  if (/原盘|\biso\b|\bbdmv\b/i.test(text)) tags.push("原盘");
  if (/remux/i.test(text)) tags.push("REMUX");
  else if (/blu-?ray|蓝光|\bbd(rip)?\b/i.test(text)) tags.push("蓝光");
  if (/web-?(dl|rip)|\bweb\b|\bnf\b|\bamzn\b/i.test(text)) tags.push("WEB");
  const collection = !has(SINGLE_EPISODE) && has(COLLECTION);
  if (collection) tags.push("合集");
  let score = 0;
  if (subs) score += 100;
  if (tags.includes("双语")) score += 10;
  if (tags.includes("国语") || tags.includes("粤语")) score += 20;
  score += height === 2160 ? 30 : height === 1080 ? 25 : height === 720 ? 10 : 0;
  if (tags.includes("REMUX") || tags.includes("蓝光")) score += 5;
  if (collection) score += 8;
  return { tags, height, collection, score };
}

const MAGNET = /magnet:\?[^\s"'<>]*xt=urn:btih:([a-z0-9]{32,40})[^\s"'<>]*/gi;

function decode(value: string): string {
  try { return decodeURIComponent(value.replace(/\+/g, " ")); } catch { return value; }
}

function fromLink(url: string, hint = "", extra = ""): Magnet | null {
  const m = /xt=urn:btih:([a-z0-9]{32,40})/i.exec(url);
  if (!m) return null;
  const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
  const dn = params.get("dn");
  const title = (hint.trim() || (dn ? decode(dn) : "") || m[1]).replace(/\s+/g, " ").slice(0, 300);
  const xl = Number(params.get("xl"));
  const size = xl > 0 ? xl : parseSize(extra) ?? parseSize(hint);
  return { url, hash: m[1].toLowerCase(), title, size, ...describe(title, extra) };
}

/** The text on the same line before a magnet: on most sites that is its title. */
function lineBefore(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  let line = text.slice(start, index).trim();
  if (!line) {
    const prev = text.lastIndexOf("\n", start - 2) + 1;
    line = text.slice(prev, Math.max(prev, start - 1)).trim();
  }
  return /magnet:\?/i.test(line) ? "" : line.replace(/[：:|\-–—\s]+$/, "");
}

/** Magnets in plain text, each titled by its dn= or the words before it. */
export function fromText(text: string): Magnet[] {
  const out: Magnet[] = [];
  for (const match of text.matchAll(MAGNET)) {
    const before = lineBefore(text, match.index ?? 0);
    const after = text.slice((match.index ?? 0) + match[0].length).split("\n")[0];
    const item = fromLink(match[0], /xt=urn:btih:[^&]*&.*dn=/i.test(match[0]) ? "" : before, `${before} ${after}`);
    if (item) out.push(item);
  }
  return out;
}

/** Magnets in a copied piece of web page: each link's title, and its row's text for size and tags. */
export function fromHTML(html: string): Magnet[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: Magnet[] = [];
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href^='magnet:' i]"))) {
    const row = a.closest("li, tr, .seed, p, div") ?? a;
    const title = a.getAttribute("title") || a.textContent || "";
    const item = fromLink(a.getAttribute("href") ?? "", title, row.textContent ?? "");
    if (item) out.push(item);
  }
  return out.length ? out : fromText(doc.body.textContent ?? "");
}

/** A bookmarklet's list: [{u: magnet, t: title, x: row text}]. */
export function fromList(list: { u: string; t?: string; x?: string }[]): Magnet[] {
  return list.map(item => fromLink(item.u, item.t ?? "", item.x ?? "")).filter((item): item is Magnet => !!item);
}

/** A site's seed, read by the server ("潜伏[全30集][中文字幕]…", "41.73G", ["4K"]). */
export function fromSeed(site: string, seed: { id: string; title: string; size?: string; features?: string[] }): Magnet {
  const extra = (seed.features ?? []).join(" ");
  return { url: "", hash: `seed:${site}:${seed.id}`, title: seed.title, size: seed.size ? parseSize(seed.size) : undefined, seed: { site, id: seed.id }, ...describe(seed.title, extra) };
}

/** One per info hash (the first title wins), best first; between equals the smaller one, so the default pick is not a 170 GB remux. */
export function rank(items: Magnet[]): Magnet[] {
  const seen = new Map<string, Magnet>();
  for (const item of items) if (!seen.has(item.hash)) seen.set(item.hash, item);
  return [...seen.values()].sort((a, b) => b.score - a.score || (a.size ?? Infinity) - (b.size ?? Infinity));
}

/** The library's folder name for a title: "潜伏 (2009)". Characters drives refuse are dropped. */
const CN_DIGIT: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_NAME = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** "第四季", "第十二季", "Season 2", "S03": the season a title names, 0 when none. */
export function seasonOfTitle(title: string): number {
  const cn = title.match(/第\s*([一二三四五六七八九十]+|\d+)\s*季/);
  if (cn) {
    const text = cn[1];
    if (/^\d+$/.test(text)) return Number(text);
    const [tens, ones] = text.includes("十") ? text.split("十") : ["", text];
    return (text.includes("十") ? (tens ? CN_DIGIT[tens] ?? 0 : 1) * 10 : 0) + (ones ? CN_DIGIT[ones] ?? 0 : 0);
  }
  const en = title.match(/\bseason\s*(\d{1,2})\b|\bS(\d{1,2})(?!\d|E\d)/i);
  return en ? Number(en[1] ?? en[2]) : 0;
}

/** 1..99 the way season folders are named: 二, 十二, 二十. */
export function seasonNumeral(n: number): string {
  if (n <= 0 || n >= 100) return String(n);
  if (n < 10) return CN_NAME[n];
  return (n >= 20 ? CN_NAME[Math.floor(n / 10)] : "") + "十" + (n % 10 ? CN_NAME[n % 10] : "");
}

export function folderName(title: string, year?: number): string {
  const clean = title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return year ? `${clean} (${year})` : clean;
}

/**
 * A folder name for several titles of one series: what their names share
 * ("招魂", "招魂2", "招魂3：…" → "招魂"), else the first title's.
 */
export function seriesName(titles: string[]): string {
  if (!titles.length) return "";
  let prefix = titles[0];
  for (const title of titles.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < title.length && prefix[i] === title[i]) i++;
    prefix = prefix.slice(0, i);
  }
  prefix = prefix.replace(/[\s\d:：·.\-_（(【\[]+$/u, "").trim();
  return folderName(prefix.length >= 1 ? prefix : titles[0]);
}

/**
 * The bookmarklet: on a resource site's page, collect its magnets and open the
 * library root folder with them (in the address's #, which never reaches a server).
 */
export function bookmarklet(origin: string, folder = "/"): string {
  const code = `(()=>{const l=[...document.querySelectorAll('a[href^="magnet:"]')].map(a=>{const r=a.closest('li,tr,p,div')||a;return{u:a.href,t:a.title||a.textContent.trim(),x:r.textContent.replace(/\\s+/g,' ').slice(0,300)}});if(!l.length){alert('这一页没有磁力链接');return}window.open(${JSON.stringify(origin + folder.split("/").map(encodeURIComponent).join("/"))}+'#resources='+encodeURIComponent(JSON.stringify(l)))})()`;
  return `javascript:${encodeURIComponent(code)}`;
}
