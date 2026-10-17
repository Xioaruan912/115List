import { extname } from "./path";
import type { Obj } from "./types";

/**
 * Subtitles beside a video: files named after it ("片名.chs.ass", "S01E02.srt"),
 * read through the same-origin proxy, decoded whatever their encoding (fansub
 * files are often GBK or UTF-16) and, for SRT and WebVTT, parsed into cues the
 * player draws itself. ASS keeps its styling and goes to ASS.js.
 */

export type SubtitleFormat = "ass" | "srt" | "vtt";

export interface SubtitleTrack {
  /** File name in the folder. */
  name: string;
  format: SubtitleFormat;
  /** What the menu shows: "简体中文", "English", or the file's own tag. */
  label: string;
  /** Higher is picked first when nothing was chosen. */
  rank: number;
}

export interface Cue { start: number; end: number; text: string }

const FORMAT: Record<string, SubtitleFormat> = { ass: "ass", ssa: "ass", srt: "srt", vtt: "vtt" };

const LANGUAGES: [RegExp, string, number][] = [
  [/(双语|中英|简英|chs[&_.+-]?eng|sc[&_.+-]?en|zh[&_.+-]?en|bilingual)/i, "中英双语", 5],
  [/(简|chs|sc|gb|zh[-_]?(cn|hans|sg)|^zh$|chi|zho)/i, "简体中文", 4],
  [/(繁|cht|tc|big5|zh[-_]?(tw|hk|hant))/i, "繁体中文", 3],
  [/^(en|eng|english)$/i, "English", 2],
  [/^(ja|jp|jpn)$/i, "日本語", 1],
];

function stem(name: string): string {
  const ext = extname(name);
  return ext ? name.slice(0, -(ext.length + 1)) : name;
}

function describe(tag: string): { label: string; rank: number } {
  for (const [pattern, label, rank] of LANGUAGES) if (pattern.test(tag)) return { label, rank };
  return { label: tag || "字幕", rank: 0 };
}

/**
 * The subtitles of one video among a folder's files: those whose name starts
 * with the video's own name. A folder with a single video takes every subtitle
 * in it (a "Movie.mkv" beside "简体.srt").
 */
export function subtitlesFor(video: string, files: Pick<Obj, "name" | "is_dir">[]): SubtitleTrack[] {
  const base = stem(video);
  const subtitles = files.filter(file => !file.is_dir && FORMAT[extname(file.name).toLowerCase()]);
  const videos = files.filter(file => !file.is_dir && /\.(mp4|mkv|avi|mov|webm|m4v|ts|flv|wmv|rmvb)$/i.test(file.name));
  let mine = subtitles.filter(file => file.name === `${base}.${extname(file.name)}` || file.name.startsWith(`${base}.`));
  if (!mine.length && videos.length === 1) mine = subtitles;
  return mine.map(file => {
    const own = stem(file.name);
    const tag = own.startsWith(base) ? own.slice(base.length).replace(/^[.\s_-]+/, "") : own;
    const { label, rank } = describe(tag);
    const format = FORMAT[extname(file.name).toLowerCase()];
    // ASS carries its look; at equal language prefer it.
    return { name: file.name, format, label, rank: rank * 2 + (format === "ass" ? 1 : 0) };
  }).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
}

/** Text from bytes in UTF-8 / UTF-16 (by BOM), else GB18030, the usual non-Unicode fansub encoding. */
export function decodeSubtitle(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  if (view[0] === 0xff && view[1] === 0xfe) return new TextDecoder("utf-16le").decode(view);
  if (view[0] === 0xfe && view[1] === 0xff) return new TextDecoder("utf-16be").decode(view);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(view).replace(/^﻿/, "");
  } catch {
    try { return new TextDecoder("gb18030").decode(view); } catch { return new TextDecoder("utf-8").decode(view); }
  }
}

function clock(value: string): number {
  const parts = value.trim().replace(",", ".").split(":");
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + Number(part);
  return Number.isFinite(seconds) ? seconds : NaN;
}

/** SRT and WebVTT cues, sorted by start; markup reduced to plain lines. */
export function parseCues(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex(line => line.includes("-->"));
    if (at < 0) continue;
    const [from, rest] = lines[at].split("-->");
    const start = clock(from);
    const end = clock(rest.trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const body = lines.slice(at + 1).join("\n")
      .replace(/\{\\[^}]*\}/g, "") // ASS overrides some SRT files carry ({\an8})
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** The cues showing at a moment (overlapping cues stack). */
export function cuesAt(cues: Cue[], time: number): Cue[] {
  const out: Cue[] = [];
  for (const cue of cues) {
    if (cue.start > time) break;
    if (cue.end > time) out.push(cue);
  }
  return out;
}

let preferred = "";

/** A subtitle just saved: the player picks it as soon as the folder lists it. */
export function preferSubtitle(name: string): void { preferred = name; setSubtitlesOff(false); }

/** Takes the preferred subtitle when it is among `names`. */
export function takePreferred(names: string[]): string | null {
  if (!preferred || !names.includes(preferred)) return null;
  const name = preferred;
  preferred = "";
  return name;
}

const OFF_KEY = "tgvio-web:subtitles-off";

/** Whether the person turned subtitles off (remembered across videos). */
export function subtitlesOff(): boolean {
  try { return localStorage.getItem(OFF_KEY) === "1"; } catch { return false; }
}

export function setSubtitlesOff(off: boolean): void {
  try { if (off) localStorage.setItem(OFF_KEY, "1"); else localStorage.removeItem(OFF_KEY); } catch { /* ignore */ }
}
