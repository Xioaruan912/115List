import { CheckIcon, MagnifyingGlassIcon, MinusIcon, PlusIcon, SubtitlesIcon, SubtitlesSlashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { spring } from "../lib/motion";
import { cuesAt, decodeSubtitle, parseCues, type SubtitleTrack } from "../lib/subtitles";

/**
 * Subtitles over the player. ASS goes to ASS.js (loaded only when one is shown)
 * so its fonts, positions and effects survive; SRT and WebVTT are drawn here,
 * lifted above the control bar while it shows. Both sit inside the player's
 * root, so they stay on screen in fullscreen.
 */

async function fetchSubtitle(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`subtitle: HTTP ${response.status}`);
  return decodeSubtitle(await response.arrayBuffer());
}

export function SubtitleLayer({ video, track, url, delay, lifted, onFailed }: {
  video: HTMLVideoElement | null;
  track: SubtitleTrack;
  url: string;
  /** Seconds the subtitles are shifted later (negative: earlier). */
  delay: number;
  /** The control bar is showing: plain cues move up out of its way. */
  lifted: boolean;
  onFailed: () => void;
}) {
  const text = useQuery({ queryKey: ["subtitle", url], queryFn: () => fetchSubtitle(url), staleTime: Infinity, retry: 1 });
  useEffect(() => { if (text.isError) onFailed(); }, [text.isError]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!text.data || !video) return null;
  return track.format === "ass"
    ? <AssLayer video={video} content={text.data} delay={delay} onFailed={onFailed} />
    : <CueLayer video={video} content={text.data} delay={delay} lifted={lifted} />;
}

function AssLayer({ video, content, delay, onFailed }: { video: HTMLVideoElement; content: string; delay: number; onFailed: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const instance = useRef<{ delay: number; destroy: () => void } | null>(null);
  useEffect(() => {
    let live = true;
    void import("assjs").then(({ default: ASS }) => {
      if (!live || !box.current) return;
      try {
        const ass = new ASS(content, video, { container: box.current, resampling: "video_height" });
        ass.delay = delay;
        instance.current = ass;
        // ASS.js starts drawing on the video's play and seeking events; one made
        // mid-playback (a track picked from the menu) is told where things stand.
        video.dispatchEvent(new Event("seeking"));
        if (!video.paused) video.dispatchEvent(new Event("play"));
      } catch {
        onFailed();
      }
    }, onFailed);
    return () => { live = false; instance.current?.destroy(); instance.current = null; };
  }, [video, content]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (instance.current) instance.current.delay = delay; }, [delay]);
  return <div ref={box} className="subtitle-ass pointer-events-none absolute inset-0 overflow-hidden" />;
}

function CueLayer({ video, content, delay, lifted }: { video: HTMLVideoElement; content: string; delay: number; lifted: boolean }) {
  const cues = useMemo(() => parseCues(content), [content]);
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    let frame = 0;
    let last = "";
    const tick = (): void => {
      const now = cuesAt(cues, video.currentTime - delay).map(cue => cue.text);
      const key = now.join("\u0000");
      if (key !== last) { last = key; setLines(now); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cues, video, delay]);
  return (
    <div className={`pointer-events-none absolute inset-x-0 flex flex-col items-center gap-1 px-[6%] text-center transition-[bottom] duration-300 ease-[var(--ease-expo)] ${lifted ? "bottom-[92px]" : "bottom-[6%]"}`}>
      {lines.map((line, index) => (
        <p key={index} className="subtitle-cue whitespace-pre-line text-[clamp(16px,2.5vw,34px)] font-medium leading-snug text-white">{line}</p>
      ))}
    </div>
  );
}

/** The CC button and its menu: tracks, off, and a delay nudge for files out of sync. */
export function SubtitleMenu({ tracks, current, delay, open, onOpen, onPick, onDelay, onSearch }: {
  tracks: SubtitleTrack[];
  /** The track showing, or null when off. */
  current: SubtitleTrack | null;
  delay: number;
  open: boolean;
  onOpen: (open: boolean) => void;
  onPick: (track: SubtitleTrack | null) => void;
  onDelay: (delay: number) => void;
  /** Look for subtitles online (射手网); absent when not set up or the folder is read-only. */
  onSearch?: () => void;
}) {
  if (!tracks.length && !onSearch) return null;
  const Icon = current ? SubtitlesIcon : SubtitlesSlashIcon;
  const row = "flex w-full items-center justify-between gap-3 rounded-[8px] px-3 py-1.5 text-left text-[13px] hover:bg-white/12 touch:py-2.5";
  return (
    <div className="relative">
      <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => onOpen(!open)} aria-label="字幕" aria-expanded={open}
        className={`grid size-9 place-items-center rounded-full transition-colors sm:touch:size-11 hover:bg-white/12 ${current ? "text-accent" : "text-white"}`}>
        <Icon size={19} />
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div className="absolute bottom-11 right-0 w-56 sm:touch:bottom-13 overflow-hidden rounded-[12px] bg-black/80 p-1 backdrop-blur-xl" style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.1)", transformOrigin: "100% 100%" }}
            initial={{ opacity: 0, scale: 0.85, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={spring.snappy}>
            <p className="px-3 pb-1 pt-1.5 text-[11px] text-white/45">字幕</p>
            {tracks.map(track => {
              const active = current?.name === track.name;
              return (
                <button key={track.name} className={`${row} ${active ? "text-accent" : "text-white"}`} title={track.name} onClick={() => onPick(track)}>
                  <span className="min-w-0 truncate">{track.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] uppercase text-white/40">{track.format}{active && <CheckIcon size={12} className="text-accent" />}</span>
                </button>
              );
            })}
            {tracks.length > 0 && (
              <button className={`${row} ${current ? "text-white" : "text-accent"}`} onClick={() => onPick(null)}>
                关闭{!current && <CheckIcon size={12} />}
              </button>
            )}
            {!tracks.length && <p className="px-3 pb-1 text-[12.5px] text-white/55">这个视频旁边没有字幕</p>}
            {onSearch && (
              <>
                <div className="mx-2 my-1 h-px bg-white/10" />
                <button className={`${row} text-white`} onClick={onSearch}>
                  <span className="flex items-center gap-2"><MagnifyingGlassIcon size={13} />在线搜索字幕…</span>
                </button>
              </>
            )}
            {current && (
              <>
                <div className="mx-2 my-1 h-px bg-white/10" />
                <div className="flex items-center justify-between px-3 py-1 text-[12.5px] text-white/75">
                  <span>时间轴</span>
                  <span className="flex items-center gap-1">
                    <button className="grid size-7 place-items-center rounded-full hover:bg-white/12 touch:size-10" aria-label="字幕提前 0.5 秒" onClick={() => onDelay(delay - 0.5)}><MinusIcon size={12} /></button>
                    <button className="w-12 rounded-full py-0.5 text-center font-mono text-[11.5px] tabular hover:bg-white/12" aria-label="字幕时间复位" onClick={() => onDelay(0)}>
                      {delay > 0 ? "+" : ""}{delay.toFixed(1)}s
                    </button>
                    <button className="grid size-7 place-items-center rounded-full hover:bg-white/12 touch:size-10" aria-label="字幕推后 0.5 秒" onClick={() => onDelay(delay + 0.5)}><PlusIcon size={12} /></button>
                  </span>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
