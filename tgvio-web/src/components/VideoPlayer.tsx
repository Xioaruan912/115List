import {
  ArrowClockwiseIcon, CornersInIcon, CornersOutIcon, PauseIcon, PictureInPictureIcon, PlayIcon, SpeakerHighIcon,
  SpeakerLowIcon, SpeakerSlashIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CloudQuality, CloudVideo } from "../api/fs";
import { apiBase } from "../lib/config";
import { absolute } from "../lib/links";
import { spring } from "../lib/motion";
import { formatClock, resumeAt, saveProgress } from "../lib/progress";
import { useUi } from "../stores/ui";

/**
 * The video player inside the viewer: its own controls (scrubber with buffered
 * ranges and a hover time, volume, speed, picture in picture, full screen),
 * keyboard and double-tap seeking, resume, and honest states for the slow and
 * the unplayable. 115 hands out 4K H.265 files that many browsers cannot decode,
 * so "it will not play" gets a way out instead of an endless spinner.
 */

/** Hand-off links for players that take a URL, per platform. */
export function externalPlayers(url: string): { label: string; href: string }[] {
  const ua = navigator.userAgent;
  const encoded = encodeURIComponent(url);
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return [
      { label: "Infuse", href: `infuse://x-callback-url/play?url=${encoded}` },
      { label: "nPlayer", href: `nplayer-${url}` },
      { label: "VLC", href: `vlc-x-callback://x-callback-url/stream?url=${encoded}` },
    ];
  }
  if (/Android/.test(ua)) {
    return [
      { label: "VLC", href: `intent:${url}#Intent;package=org.videolan.vlc;type=video/*;end` },
      { label: "MX Player", href: `intent:${url}#Intent;package=com.mxtech.videoplayer.ad;type=video/*;end` },
      { label: "其他播放器", href: `intent:${url}#Intent;type=video/*;end` },
    ];
  }
  if (/Macintosh/.test(ua)) return [{ label: "IINA", href: `iina://weblink?url=${encoded}` }, { label: "VLC", href: `vlc://${url}` }];
  return [{ label: "PotPlayer", href: `potplayer://${url}` }, { label: "VLC", href: `vlc://${url}` }];
}

type Phase = "loading" | "ready" | "blocked" | "failed";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const VOLUME_KEY = "tgvio-web:volume";
const QUALITY_KEY = "tgvio-web:quality";

type Source = { kind: "origin" } | { kind: "cloud"; quality: CloudQuality };

/** The cloud version that plays everywhere without eating bandwidth: 1080P or the nearest below. */
function bestCloud(qualities: CloudQuality[]): CloudQuality {
  const sorted = [...qualities].sort((a, b) => b.height - a.height);
  return sorted.find(q => q.height > 0 && q.height <= 1080) ?? sorted[sorted.length - 1];
}

function firstSource(info: CloudVideo | null): Source {
  let preferred = "";
  try { preferred = localStorage.getItem(QUALITY_KEY) ?? ""; } catch { /* ignore */ }
  if (!info || preferred === "origin") return { kind: "origin" };
  return { kind: "cloud", quality: info.qualities.find(q => q.name === preferred) ?? bestCloud(info.qualities) };
}

function savedVolume(): { volume: number; muted: boolean } {
  try { return { volume: 1, muted: false, ...JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "{}") }; } catch { return { volume: 1, muted: false }; }
}

function IconButton({ label, onClick, children, active = false }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <motion.button type="button" aria-label={label} title={label} onClick={onClick} whileTap={{ scale: 0.86 }}
      className={`grid size-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/12 ${active ? "text-accent" : "text-white"}`}>
      {children}
    </motion.button>
  );
}

/** A big icon that pops in the centre and fades, like a tap acknowledgement. */
function Flash({ flash }: { flash: { id: number; kind: "play" | "pause" } | null }) {
  return (
    <AnimatePresence>
      {flash && (
        <motion.span key={flash.id} className="pointer-events-none absolute left-1/2 top-1/2 -ml-9 -mt-9 grid size-18 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md"
          initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.35, opacity: 0 }} transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}>
          {flash.kind === "play" ? <PlayIcon size={30} weight="fill" className="translate-x-0.5" /> : <PauseIcon size={30} weight="fill" />}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function Scrubber({ video, time, duration, buffered, onSeek, onScrub }: {
  video: HTMLVideoElement | null;
  time: number;
  duration: number;
  buffered: [number, number][];
  onSeek: (time: number) => void;
  onScrub: (active: boolean) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const at = (event: ReactPointerEvent): number => {
    const rect = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };
  const shown = drag ?? (duration ? time / duration : 0);
  const tip = drag ?? hover;
  return (
    <div
      ref={track}
      className="group/scrub relative flex h-5 cursor-pointer touch-none items-center"
      role="slider" aria-label="进度" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} tabIndex={-1}
      onPointerDown={event => { if (!duration) return; event.currentTarget.setPointerCapture(event.pointerId); setDrag(at(event)); onScrub(true); }}
      onPointerMove={event => { const value = at(event); setHover(value); if (drag !== null) setDrag(value); }}
      onPointerUp={event => { if (drag !== null) { onSeek(at(event) * duration); setDrag(null); onScrub(false); } }}
      onPointerCancel={() => { setDrag(null); onScrub(false); }}
      onPointerLeave={() => setHover(null)}
    >
      <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/18 transition-[height] duration-200 group-hover/scrub:h-[5px]">
        {duration > 0 && buffered.map(([start, end], index) => (
          <span key={index} className="absolute inset-y-0 bg-white/30" style={{ left: `${start / duration * 100}%`, width: `${(end - start) / duration * 100}%` }} />
        ))}
        {!duration && video && <span className="scrub-wait absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent" />}
        <span className="absolute inset-y-0 left-0 origin-left bg-accent" style={{ width: "100%", transform: `scaleX(${shown})` }} />
      </div>
      {duration > 0 && (
        <span className={`pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_4px_rgb(196_236_92/0.25)] transition-transform duration-200 ${drag !== null ? "scale-110" : "scale-0 group-hover/scrub:scale-100"}`}
          style={{ left: `${shown * 100}%` }} />
      )}
      <AnimatePresence>
        {tip !== null && duration > 0 && (
          <motion.span className="pointer-events-none absolute bottom-6 -translate-x-1/2 rounded-md bg-black/75 px-2 py-1 font-mono text-[11.5px] text-white backdrop-blur-md tabular"
            style={{ left: `${tip * 100}%` }} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            {formatClock(tip * duration)}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

export function VideoPlayer({ path, src, fallback, thumb, chrome, cloud, onAspect, onDownload, onCopy }: {
  path: string;
  /** Asks for the drive's own transcodes (115); absent for other storages. */
  cloud?: () => Promise<CloudVideo>;
  src: string;
  fallback: string;
  thumb: string;
  /** Whether the surrounding chrome is showing; omit to let the player track activity itself. */
  chrome?: boolean;
  onAspect?: (aspect: number) => void;
  onDownload: () => void;
  onCopy: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState(src);
  const [phase, setPhase] = useState<Phase>("loading");
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<[number, number][]>([]);
  const [{ volume, muted }, setSound] = useState(savedVolume);
  const [speed, setSpeed] = useState(1);
  const [speedMenu, setSpeedMenu] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [flash, setFlash] = useState<{ id: number; kind: "play" | "pause" } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 420);
    return () => clearTimeout(timer);
  }, [flash]);
  const [skip, setSkip] = useState<{ id: number; side: -1 | 1 } | null>(null);
  const [resumed, setResumed] = useState(0);
  const [stuck, setStuck] = useState(false);
  const [size, setSize] = useState("");
  const progressAt = useRef(performance.now());
  // Outside the viewer nobody hides the controls for us: do it after 3 s without a pointer.
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (chrome !== undefined) return;
    const element = root.current;
    if (!element) return;
    let timer = window.setTimeout(() => setActive(false), 3000);
    const wake = (): void => { setActive(true); clearTimeout(timer); timer = window.setTimeout(() => setActive(false), 3000); };
    element.addEventListener("pointermove", wake);
    element.addEventListener("pointerdown", wake);
    return () => { clearTimeout(timer); element.removeEventListener("pointermove", wake); element.removeEventListener("pointerdown", wake); };
  }, [chrome]);
  const saved = useRef(0);
  const [cloudInfo, setCloudInfo] = useState<CloudVideo | null | undefined>(cloud ? undefined : null);
  const [source, setSource] = useState<Source | null>(cloud ? null : { kind: "origin" });
  const [qualityMenu, setQualityMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const pendingSeek = useRef<{ time: number } | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);

  // Ask which cloud versions exist before loading anything: a 4K original would
  // otherwise start downloading only to be thrown away.
  useEffect(() => {
    if (!cloud) return;
    let live = true;
    cloud()
      .then(info => { if (live) setCloudInfo(info.qualities.length && info.ticket ? info : null); })
      .catch(() => { if (live) setCloudInfo(null); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!source && cloudInfo !== undefined) setSource(firstSource(cloudInfo));
  }, [cloudInfo, source]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4200);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => () => hlsRef.current?.destroy(), []);

  const video = (): HTMLVideoElement | null => ref.current;

  const switchTo = useCallback((next: Source, message = "") => {
    const element = video();
    pendingSeek.current = element && element.currentTime > 1 ? { time: element.currentTime } : null;
    setPhase("loading"); setWaiting(true); setStuck(false); setQualityMenu(false);
    setSource(next);
    if (message) setNotice(message);
    try { localStorage.setItem(QUALITY_KEY, next.kind === "origin" ? "origin" : next.quality.name); } catch { /* ignore */ }
  }, []);

  // The original will not play: the cloud version is the way out, if there is one.
  const originFailed = useCallback(() => {
    if (cloudInfo) switchTo({ kind: "cloud", quality: bestCloud(cloudInfo.qualities) }, `原文件放不了，已改用云端 ${bestCloud(cloudInfo.qualities).name}`);
    else setPhase("failed");
  }, [cloudInfo, switchTo]);

  // Load the chosen source. Start inside the tap that opened the viewer, so
  // mobile browsers count playback as user initiated.
  useEffect(() => {
    const element = video();
    if (!element || !source) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    let cancelled = false;
    const start = (): void => {
      element.volume = volume;
      element.muted = muted;
      progressAt.current = performance.now();
      element.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "NotAllowedError") setPhase(state => state === "failed" ? state : "blocked");
      });
    };
    if (source.kind === "origin") {
      element.src = url;
      start();
      return () => { cancelled = true; };
    }
    const playlist = `${apiBase}/tgvio/hls/${cloudInfo!.ticket}/${encodeURIComponent(source.quality.id)}/index.m3u8`;
    const native = element.canPlayType("application/vnd.apple.mpegurl") !== "" && /Apple/.test(navigator.vendor);
    if (native) {
      element.src = playlist; // Safari and iPhone play HLS themselves
      start();
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          if (element.canPlayType("application/vnd.apple.mpegurl")) { element.src = playlist; start(); } else setPhase("failed");
          return;
        }
        const hls = new Hls({ maxBufferLength: 40, backBufferLength: 30, fragLoadingMaxRetry: 4 });
        hlsRef.current = hls;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else setPhase("failed");
        });
        hls.loadSource(playlist);
        hls.attachMedia(element);
        start();
      }).catch(() => setPhase("failed"));
    }
    return () => { cancelled = true; };
  }, [source, url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing arriving for a long while: offer the way out, without stopping the attempt.
  useEffect(() => {
    if (phase === "failed") return;
    const timer = window.setInterval(() => {
      const element = video();
      if (!element) return;
      const quiet = performance.now() - progressAt.current;
      setStuck(waiting && quiet > (duration ? 20_000 : 14_000));
    }, 1000);
    return () => clearInterval(timer);
  }, [waiting, duration, phase]);

  useEffect(() => () => {
    const element = video();
    if (element && element.currentTime > 0) saveProgress(path, element.currentTime, element.duration);
  }, [path]);

  useEffect(() => {
    if (!resumed) return;
    const timer = window.setTimeout(() => setResumed(0), 5200);
    return () => clearTimeout(timer);
  }, [resumed]);

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    const element = video();
    if (!element || phase === "failed") return;
    if (element.paused) { void element.play().catch(() => setPhase("blocked")); setFlash({ id: Date.now(), kind: "play" }); }
    else { element.pause(); setFlash({ id: Date.now(), kind: "pause" }); }
  }, [phase]);

  const seekBy = useCallback((delta: number) => {
    const element = video();
    if (!element || !element.duration) return;
    element.currentTime = Math.min(element.duration - 0.5, Math.max(0, element.currentTime + delta));
    setSkip({ id: Date.now(), side: delta < 0 ? -1 : 1 });
  }, []);

  const setVolume = (next: { volume?: number; muted?: boolean }): void => {
    setSound(state => {
      const value = { ...state, ...next };
      const element = video();
      if (element) { element.volume = value.volume; element.muted = value.muted; }
      try { localStorage.setItem(VOLUME_KEY, JSON.stringify(value)); } catch { /* ignore */ }
      return value;
    });
  };

  const toggleFullscreen = (): void => {
    const element = video() as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    if (root.current?.requestFullscreen) void root.current.requestFullscreen().catch(() => element?.webkitEnterFullscreen?.());
    else element?.webkitEnterFullscreen?.(); // iPhone: only the video element itself can go full screen
  };

  const pip = typeof document !== "undefined" && document.pictureInPictureEnabled;

  // Keys while the player is open. They win over the viewer's (arrows seek instead of paging).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (useUi.getState().dialog || event.metaKey || event.ctrlKey || event.altKey) return;
      const element = video();
      if (!element) return;
      const key = event.key.toLowerCase();
      const handled = () => { event.preventDefault(); event.stopImmediatePropagation(); };
      if (key === " " || key === "k") { handled(); toggle(); }
      else if (key === "arrowleft" && !event.shiftKey) { handled(); seekBy(-5); }
      else if (key === "arrowright" && !event.shiftKey) { handled(); seekBy(5); }
      else if (key === "j") { handled(); seekBy(-10); }
      else if (key === "l") { handled(); seekBy(10); }
      else if (key === "m") { handled(); setVolume({ muted: !element.muted }); }
      else if (key === "f") { handled(); toggleFullscreen(); }
      else if (key === "arrowup") { handled(); setVolume({ volume: Math.min(1, element.volume + 0.1), muted: false }); }
      else if (key === "arrowdown") { handled(); setVolume({ volume: Math.max(0, element.volume - 0.1) }); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [toggle, seekBy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Touch: tap shows or hides the controls; double tap on a side seeks 10 s.
  const taps = useRef({ at: 0, x: 0, timer: 0, touch: false, shown: true });
  const onSurfaceClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (phase !== "ready" && phase !== "loading") return;
    if (!taps.current.touch) { toggle(); return; } // mouse: click plays or pauses at once, double click is full screen
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const now = Date.now();
    const state = taps.current;
    if (now - state.at < 280) {
      clearTimeout(state.timer);
      state.at = 0;
      if (x < 0.35) seekBy(-10);
      else if (x > 0.65) seekBy(10);
      else toggleFullscreen();
      return;
    }
    state.at = now;
    state.x = x;
    if (state.shown) state.timer = window.setTimeout(toggle, 280); // controls were hidden: this tap only brings them back
  };

  const visible = (chrome ?? active) || !playing || scrubbing || speedMenu || qualityMenu;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const players = externalPlayers(absolute(src));
  const VolumeIcon = muted || volume === 0 ? SpeakerSlashIcon : volume < 0.5 ? SpeakerLowIcon : SpeakerHighIcon;
  const showCover = phase !== "ready" || (waiting && time === 0);

  return (
    <div ref={root} className={`video-player absolute inset-0 overflow-hidden bg-[#060607] ${visible ? "" : "cursor-none"}`}>
      <video
        ref={ref}
        playsInline
        preload="metadata"
        className="absolute inset-0 size-full object-contain"
        onLoadedMetadata={event => {
          const v = event.currentTarget;
          setDuration(v.duration || 0);
          if (v.videoWidth) { onAspect?.(v.videoWidth / v.videoHeight); setSize(`${v.videoWidth}×${v.videoHeight}`); }
          if (pendingSeek.current) { v.currentTime = pendingSeek.current.time; pendingSeek.current = null; }
          else {
            const at = resumeAt(path);
            if (at && v.currentTime < 1) { v.currentTime = at; setResumed(at); }
          }
          progressAt.current = performance.now();
        }}
        onDurationChange={event => setDuration(event.currentTarget.duration || 0)}
        onPlay={() => setPlaying(true)}
        onPause={event => { setPlaying(false); saveProgress(path, event.currentTarget.currentTime, event.currentTarget.duration); }}
        onPlaying={event => {
          setWaiting(false); setStuck(false);
          // Sound and no picture: the codec (usually H.265) is not supported here.
          if (event.currentTarget.videoWidth === 0) { event.currentTarget.pause(); if (source?.kind === "origin") originFailed(); else setPhase("failed"); }
          else setPhase("ready");
        }}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onProgress={event => {
          progressAt.current = performance.now();
          const ranges = event.currentTarget.buffered;
          setBuffered(Array.from({ length: ranges.length }, (_, i) => [ranges.start(i), ranges.end(i)] as [number, number]));
        }}
        onTimeUpdate={event => {
          const v = event.currentTarget;
          setTime(v.currentTime);
          progressAt.current = performance.now();
          if (Math.abs(v.currentTime - saved.current) < 4) return;
          saved.current = v.currentTime;
          saveProgress(path, v.currentTime, v.duration);
        }}
        onRateChange={event => setSpeed(event.currentTarget.playbackRate)}
        onEnded={event => { setPlaying(false); saveProgress(path, event.currentTarget.duration, event.currentTarget.duration); }}
        onError={() => {
          if (source?.kind !== "origin") { if (!hlsRef.current) setPhase("failed"); return; } // hls.js reports its own errors
          if (cloudInfo) { originFailed(); return; }
          if (url !== fallback) { setUrl(fallback); setPhase("loading"); setWaiting(true); progressAt.current = performance.now(); }
          else setPhase("failed");
        }}
      />

      {/* Poster and loading: the thumbnail, blurred, until the first frame. */}
      <AnimatePresence>
        {showCover && (
          <motion.div key="cover" className="pointer-events-none absolute inset-0" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.6 } }}>
            {thumb && <img src={thumb} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full scale-110 object-cover opacity-45 blur-2xl" />}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(6_6_7/0.2)_0%,rgb(6_6_7/0.85)_75%)]" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute inset-0" onPointerDown={event => { taps.current.touch = event.pointerType !== "mouse"; taps.current.shown = visibleRef.current; }} onClick={onSurfaceClick}
        onDoubleClick={event => { if (!taps.current.touch) { event.preventDefault(); toggle(); toggleFullscreen(); } }} />

      <AnimatePresence>
        {phase !== "failed" && waiting && !stuck && phase !== "blocked" && (
          <motion.div key="wait" className="pointer-events-none absolute inset-0 grid place-items-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.25 } }} exit={{ opacity: 0 }}>
            <div className="flex flex-col items-center gap-3 text-white">
              <span className="loader-bars" aria-hidden><i /><i /><i /><i /></span>
              <p className="text-[12.5px] text-white/60">{!source ? "正在准备播放" : time > 0 ? "缓冲中" : duration ? "正在缓冲" : "正在连接网盘"}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Flash flash={flash} />

      <AnimatePresence>
        {!playing && phase === "ready" && !flash && !scrubbing && (
          <motion.button key="paused" type="button" aria-label="播放" onClick={toggle}
            className="absolute left-1/2 top-1/2 -ml-9 -mt-9 grid size-18 place-items-center rounded-full bg-white/14 text-white backdrop-blur-xl transition-colors hover:bg-accent hover:text-accent-ink"
            style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.18), 0 20px 50px -20px rgb(0 0 0 / 0.7)" }}
            initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.2 }} transition={spring.bouncy}>
            <PlayIcon size={30} weight="fill" className="translate-x-0.5" />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {skip && (
          <motion.span key={skip.id} className={`pointer-events-none absolute top-1/2 -mt-8 grid size-16 place-items-center rounded-full bg-white/12 text-[13px] font-semibold text-white backdrop-blur-md ${skip.side < 0 ? "left-[14%]" : "right-[14%]"}`}
            initial={{ opacity: 0, scale: 0.7, x: skip.side * -10 }} animate={{ opacity: 1, scale: 1, x: 0 }} exit={{ opacity: 0, scale: 1.2, x: skip.side * 16 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            onAnimationComplete={() => window.setTimeout(() => setSkip(current => current?.id === skip.id ? null : current), 250)}>
            {skip.side < 0 ? "-" : "+"}{Math.abs(10)}s
          </motion.span>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {phase === "blocked" && (
          <motion.button key="blocked" className="absolute inset-0 grid place-items-center" onClick={toggle} aria-label="播放"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.15 }} transition={spring.soft}>
            <span className="relative grid size-20 place-items-center rounded-full bg-accent text-accent-ink">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent/40 [animation-duration:1.8s]" />
              <PlayIcon size={30} weight="fill" className="relative translate-x-0.5" />
            </span>
          </motion.button>
        )}
        {(phase === "failed" || stuck) && (
          <motion.div key="help" className="absolute inset-0 grid place-items-center p-4"
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.soft}>
            <div className="w-full max-w-sm rounded-[18px] bg-black/60 p-5 text-center text-white backdrop-blur-xl" style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.1)" }}>
              <p className="font-semibold">{phase === "failed" ? "浏览器放不了这个视频" : "视频迟迟没有开始"}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/65">
                {phase === "failed"
                  ? "多半是 H.265 这类浏览器解不了的编码。换个播放器打开，画质也更好。"
                  : "网盘传得慢，或者浏览器解不了这个编码（4K、H.265 常见）。可以继续等，也可以换个播放器。"}
              </p>
              {cloudInfo && source?.kind === "origin" && (
                <button className="btn btn-primary mt-4 w-full" onClick={() => switchTo({ kind: "cloud", quality: bestCloud(cloudInfo.qualities) })}>
                  <PlayIcon size={15} weight="fill" />用网盘云端 {bestCloud(cloudInfo.qualities).name} 播放
                </button>
              )}
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {players.map(player => (
                  <a key={player.label} href={player.href} className="rounded-full bg-white/12 px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-white/20">{player.label}</a>
                ))}
              </div>
              <div className="mt-3 flex justify-center gap-1 text-[13px] text-white/75">
                <button className="rounded-full px-3 py-1.5 hover:bg-white/10" onClick={onDownload}>下载</button>
                <button className="rounded-full px-3 py-1.5 hover:bg-white/10" onClick={onCopy}>复制链接</button>
                {stuck && phase !== "failed"
                  ? <button className="rounded-full px-3 py-1.5 hover:bg-white/10" onClick={() => { setStuck(false); progressAt.current = performance.now(); }}>继续等</button>
                  : <button className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 hover:bg-white/10" onClick={() => { setUrl(`${src}${src.includes("?") ? "&" : "?"}_=${Date.now()}`); setPhase("loading"); setWaiting(true); setStuck(false); }}><ArrowClockwiseIcon size={13} />重试</button>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {notice && (
          <motion.div key="notice" className="absolute left-1/2 top-3 z-[1] -translate-x-1/2 whitespace-nowrap rounded-full bg-black/65 px-3.5 py-1.5 text-[13px] text-white backdrop-blur-xl"
            initial={{ opacity: 0, y: -12, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={spring.bouncy}>
            {notice}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {resumed > 0 && !notice && (
          <motion.div key="resume" className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/60 py-1 pl-3.5 pr-1 text-[13px] text-white backdrop-blur-xl"
            initial={{ opacity: 0, y: -12, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={spring.bouncy}>
            <span className="tabular">从 {formatClock(resumed)} 继续</span>
            <button className="rounded-full px-2.5 py-1 text-accent hover:bg-white/10" onClick={() => { const v = video(); if (v) v.currentTime = 0; setResumed(0); }}>从头播放</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Control bar: a floating glass strip, scrubber on top. */}
      {phase !== "failed" && phase !== "blocked" && (
        <motion.div
          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-10 sm:px-4"
          initial={false}
          animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 12 }}
          transition={spring.snappy}
          style={{ pointerEvents: visible ? "auto" : "none" }}
        >
          <Scrubber video={ref.current} time={time} duration={duration} buffered={buffered} onScrub={setScrubbing}
            onSeek={value => { const v = video(); if (v) v.currentTime = value; setTime(value); }} />
          <div className="mt-0.5 flex items-center gap-0.5 text-white">
            <IconButton label={playing ? "暂停" : "播放"} onClick={toggle}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={playing ? "pause" : "play"} initial={{ scale: 0.4, opacity: 0, rotate: -40 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.4, opacity: 0 }} transition={spring.bouncy}>
                  {playing ? <PauseIcon size={19} weight="fill" /> : <PlayIcon size={19} weight="fill" />}
                </motion.span>
              </AnimatePresence>
            </IconButton>
            <div className="group/vol flex items-center max-sm:hidden">
              <IconButton label={muted ? "取消静音" : "静音"} onClick={() => setVolume({ muted: !muted })}><VolumeIcon size={19} /></IconButton>
              <input type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume} aria-label="音量"
                onChange={event => setVolume({ volume: Number(event.target.value), muted: Number(event.target.value) === 0 })}
                className="volume-range w-0 opacity-0 transition-all duration-300 ease-[var(--ease-expo)] group-hover/vol:mr-2 group-hover/vol:w-20 group-hover/vol:opacity-100 focus:mr-2 focus:w-20 focus:opacity-100"
                style={{ "--v": `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties} />
            </div>
            <span className="ml-1.5 font-mono text-[12px] text-white/85 tabular">
              {formatClock(time)}<span className="text-white/45"> / {duration ? formatClock(duration) : "--:--"}</span>
            </span>
            <span className="flex-1" />
            {cloudInfo ? (
              <div className="relative">
                <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => { setQualityMenu(open => !open); setSpeedMenu(false); }} aria-label="清晰度"
                  className="flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium text-white transition-colors hover:bg-white/12">
                  {source?.kind === "cloud" && <span className="size-1.5 rounded-full bg-accent" aria-hidden />}
                  {source?.kind === "cloud" ? source.quality.name : "原画"}
                </motion.button>
                <AnimatePresence>
                  {qualityMenu && (
                    <motion.div className="absolute bottom-11 right-0 w-44 overflow-hidden rounded-[12px] bg-black/80 p-1 backdrop-blur-xl" style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.1)", transformOrigin: "100% 100%" }}
                      initial={{ opacity: 0, scale: 0.85, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={spring.snappy}>
                      <p className="px-3 pb-1 pt-1.5 text-[11px] text-white/45">网盘云端转码</p>
                      {[...cloudInfo.qualities].sort((a, b) => b.height - a.height).map(q => {
                        const active = source?.kind === "cloud" && source.quality.id === q.id;
                        return (
                          <button key={q.id} className={`flex w-full items-center justify-between rounded-[8px] px-3 py-1.5 text-left text-[13px] hover:bg-white/12 ${active ? "text-accent" : "text-white"}`}
                            onClick={() => { if (!active) switchTo({ kind: "cloud", quality: q }); else setQualityMenu(false); }}>
                            {q.name}<span className="font-mono text-[11px] text-white/40">{(q.bandwidth / 1e6).toFixed(1)}M</span>
                          </button>
                        );
                      })}
                      <div className="mx-2 my-1 h-px bg-white/10" />
                      <button className={`flex w-full items-center justify-between rounded-[8px] px-3 py-1.5 text-left text-[13px] hover:bg-white/12 ${source?.kind === "origin" ? "text-accent" : "text-white"}`}
                        onClick={() => { if (source?.kind !== "origin") switchTo({ kind: "origin" }); else setQualityMenu(false); }}>
                        原画<span className="text-[11px] text-white/40">原文件</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : size ? <span className="mr-1 rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10.5px] text-white/70 max-sm:hidden">{size.split("×")[1]}p</span> : null}
            <div className="relative">
              <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => { setSpeedMenu(open => !open); setQualityMenu(false); }} aria-label="播放速度"
                className={`h-9 rounded-full px-2.5 font-mono text-[12.5px] font-medium transition-colors hover:bg-white/12 ${speed !== 1 ? "text-accent" : "text-white"}`}>
                {speed}×
              </motion.button>
              <AnimatePresence>
                {speedMenu && (
                  <motion.div className="absolute bottom-11 right-0 flex flex-col overflow-hidden rounded-[12px] bg-black/80 p-1 backdrop-blur-xl" style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.1)", transformOrigin: "100% 100%" }}
                    initial={{ opacity: 0, scale: 0.85, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={spring.snappy}>
                    {SPEEDS.map(value => (
                      <button key={value} className={`rounded-[8px] px-4 py-1.5 text-left font-mono text-[12.5px] hover:bg-white/12 ${value === speed ? "text-accent" : "text-white"}`}
                        onClick={() => { const v = video(); if (v) v.playbackRate = value; setSpeedMenu(false); }}>
                        {value}×
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            {pip && <IconButton label="画中画" onClick={() => { const v = video(); if (v) void (document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture()).catch(() => undefined); }}><PictureInPictureIcon size={19} /></IconButton>}
            <IconButton label={fullscreen ? "退出全屏" : "全屏"} onClick={toggleFullscreen}>{fullscreen ? <CornersInIcon size={19} /> : <CornersOutIcon size={19} />}</IconButton>
          </div>
        </motion.div>
      )}
    </div>
  );
}
