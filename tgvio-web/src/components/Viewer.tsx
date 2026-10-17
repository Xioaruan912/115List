import {
  ArrowSquareOutIcon, CaretLeftIcon, DotsThreeIcon, CaretRightIcon, DownloadSimpleIcon, InfoIcon, LinkIcon, MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon, ShareNetworkIcon, TrashIcon, XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { animate, AnimatePresence, motion, useMotionValue, useTransform, type MotionValue, type PanInfo } from "motion/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { cloudVideo } from "../api/fs";
import { passwordFor, useDir } from "../hooks/useDir";
import { useIsMobile } from "../hooks/useMedia";
import * as actions from "../lib/actions";
import { formatBytes, formatDate } from "../lib/format";
import { galleryKind, kindOf, type Kind } from "../lib/kind";
import { downloadUrl, proxyUrl } from "../lib/links";
import { spring } from "../lib/motion";
import { extname, join } from "../lib/path";
import { can, Perm } from "../lib/perm";
import { sortObjs } from "../lib/sort";
import { subtitlesFor } from "../lib/subtitles";
import type { Obj } from "../lib/types";
import { usePrefs } from "../stores/prefs";
import { useSession } from "../stores/session";
import { rectOf, useUi, type Rect } from "../stores/ui";
import { ArchiveView } from "./ArchiveView";
import { KindIcon } from "./KindIcon";
import { VideoPlayer } from "./VideoPlayer";
import { Menu } from "./Menu";
import { ErrorState } from "./ErrorState";

const Markdown = lazy(() => import("./Markdown"));

interface Box { left: number; top: number; width: number; height: number }

function useViewport() {
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  useEffect(() => {
    const onResize = (): void => setSize({ w: innerWidth, h: innerHeight });
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);
  return size;
}

function fit(aspect: number, vw: number, vh: number, mobile: boolean, strip: boolean): Box {
  const padX = mobile ? 0 : 80;
  const top = mobile ? 60 : 72;
  const bottom = strip ? (mobile ? 92 : 104) : mobile ? 24 : 40;
  const bw = Math.max(80, vw - padX * 2);
  const bh = Math.max(80, vh - top - bottom);
  let width = bw;
  let height = width / aspect;
  if (height > bh) { height = bh; width = height * aspect; }
  return { left: (vw - width) / 2, top: top + (bh - height) / 2, width, height };
}

function panelBox(vw: number, vh: number, mobile: boolean): Box {
  const width = Math.min(vw - (mobile ? 16 : 160), 920);
  const top = mobile ? 60 : 72;
  const height = vh - top - (mobile ? 16 : 40);
  return { left: (vw - width) / 2, top, width, height };
}

/** Where the tile for this file sits right now, if it is on screen. */
function tileRect(name: string): Rect | null {
  const tile = document.querySelector(`[data-view="active"] [data-name="${CSS.escape(name)}"]`);
  const rect = rectOf(tile?.querySelector("[data-thumb]") ?? tile);
  if (!rect || rect.y + rect.height < 0 || rect.y > innerHeight) return null;
  return rect;
}

function flipFrom(rect: Rect, box: Box) {
  return {
    x: rect.x + rect.width / 2 - (box.left + box.width / 2),
    y: rect.y + rect.height / 2 - (box.top + box.height / 2),
    scale: Math.max(0.05, Math.min(rect.width / box.width, rect.height / box.height) * 1.02),
  };
}

function ImageView({ src, fallback, thumb, zoom, panX, panY, onAspect }: {
  src: string;
  fallback: string;
  thumb: string;
  zoom: MotionValue<number>;
  panX: MotionValue<number>;
  panY: MotionValue<number>;
  onAspect: (aspect: number) => void;
}) {
  const [url, setUrl] = useState(src);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <motion.div className="absolute inset-0" style={{ scale: zoom, x: panX, y: panY }}>
      {thumb && !loaded && (
        <img src={thumb} alt="" className="absolute inset-0 size-full object-contain blur-md" referrerPolicy="no-referrer"
          onLoad={event => onAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />
      )}
      <motion.img
        src={url}
        alt=""
        draggable={false}
        referrerPolicy="no-referrer"
        className="absolute inset-0 size-full select-none object-contain"
        initial={{ opacity: 0 }}
        animate={{ opacity: loaded ? 1 : 0 }}
        transition={{ duration: 0.35 }}
        onLoad={event => { setLoaded(true); onAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight); }}
        onError={() => { if (url !== fallback) setUrl(fallback); else setFailed(true); }}
      />
      {!loaded && !failed && <div className="absolute inset-0 grid place-items-center"><span className="spin size-6 rounded-full border-2 border-white/20 border-t-white/80" /></div>}
      {failed && <div className="absolute inset-0 grid place-items-center text-white/70">图片加载失败</div>}
    </motion.div>
  );
}

function AudioView({ obj, src }: { obj: Obj; src: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 rounded-[22px] bg-raised p-6 hairline">
      <div className="flex h-24 items-end gap-1.5" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="w-2 origin-bottom rounded-full bg-accent"
            style={{ height: `${30 + ((i * 47) % 70)}%`, animation: playing ? `eq 900ms ${i * 90}ms ease-in-out infinite alternate` : "none", transform: playing ? undefined : "scaleY(0.25)", transition: "transform 400ms" }} />
        ))}
      </div>
      <p className="max-w-full truncate text-center text-lg font-semibold tracking-tight">{obj.name}</p>
      <audio src={src} controls autoPlay className="w-full max-w-md" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    </div>
  );
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function TextView({ obj, url, kind }: { obj: Obj; url: string; kind: Kind }) {
  const tooBig = obj.size > 3 * 1024 * 1024;
  const text = useQuery({ queryKey: ["text", url], queryFn: () => fetchText(url), enabled: !tooBig, staleTime: 60_000, retry: false });
  const lines = useMemo(() => (text.data ?? "").split("\n"), [text.data]);
  return (
    <div className="absolute inset-0 overflow-auto rounded-[22px] bg-raised hairline" onPointerDown={event => event.stopPropagation()}>
      {tooBig && <p className="p-6 text-muted">文件超过 3 MB，请下载后查看。</p>}
      {text.isPending && !tooBig && <div className="space-y-2 p-6">{Array.from({ length: 12 }, (_, i) => <div key={i} className="skeleton h-3.5 rounded" style={{ width: `${40 + ((i * 29) % 55)}%` }} />)}</div>}
      {text.isError && <ErrorState className="m-6" error={text.error} onRetry={() => text.refetch()} />}
      {text.data !== undefined && (kind === "markdown" ? (
        <div className="px-6 py-6 sm:px-10"><Suspense fallback={null}><Markdown source={text.data} /></Suspense></div>
      ) : (
        <pre className="min-w-max py-5 font-mono text-[12.5px] leading-[1.7]">
          {lines.map((line, index) => (
            <div key={index} className="flex hover:bg-[var(--hover)]">
              <span className="w-14 shrink-0 select-none pr-4 text-right text-faint tabular">{index + 1}</span>
              <span className="pr-6 whitespace-pre">{line || " "}</span>
            </div>
          ))}
        </pre>
      ))}
    </div>
  );
}

function OtherView({ obj, dir }: { obj: Obj; dir: string }) {
  const kind = kindOf(obj);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 rounded-[22px] bg-raised p-8 text-center hairline">
      <motion.span initial={{ rotate: -12, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={spring.pop} className="text-accent-text">
        <KindIcon kind={kind} size={72} weight="duotone" />
      </motion.span>
      <div>
        <p className="max-w-[40ch] break-all text-lg font-semibold tracking-tight">{obj.name}</p>
        <p className="mt-1 text-muted tabular">{formatBytes(obj.size)}，{formatDate(obj.modified)}</p>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-primary" onClick={() => actions.download(dir, obj)}><DownloadSimpleIcon size={16} />下载</button>
        <button className="btn btn-line" onClick={() => void actions.copyLinks(dir, [obj])}><LinkIcon size={16} />复制链接</button>
      </div>
      {kind === "pdf" && <a className="text-[13px] text-accent-text underline underline-offset-4" href={downloadUrl(join(dir, obj.name), obj)} target="_blank" rel="noreferrer">在新标签页打开</a>}
    </div>
  );
}

function Strip({ items, current, onPick }: { items: Obj[]; current: number; onPick: (index: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>("[data-active=true]");
    active?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", inline: "center", block: "nearest" });
  }, [current]);
  return (
    <div ref={ref} className="pointer-events-auto flex max-w-full gap-1.5 overflow-x-auto px-[50vw] py-2 [scrollbar-width:none]">
      {items.map((obj, index) => {
        const active = index === current;
        return (
          <button key={obj.name} data-active={active} onClick={() => onPick(index)} aria-label={obj.name}
            className={`relative h-14 shrink-0 overflow-hidden rounded-lg transition-[width,opacity] duration-300 ease-[var(--ease-expo)] ${active ? "w-20 opacity-100" : "w-10 opacity-50 hover:opacity-90"}`}>
            {obj.thumb ? <img src={obj.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
              : <span className="grid size-full place-items-center bg-white/10 text-white/70"><KindIcon kind={kindOf(obj)} size={16} /></span>}
            {active && <motion.span layoutId="strip-ring" className="absolute inset-0 rounded-lg ring-2 ring-inset ring-accent" transition={spring.snappy} />}
          </button>
        );
      })}
    </div>
  );
}

function ViewerBody({ dir, name, origin }: { dir: string; name: string; origin: Rect | null }) {
  const list = useDir(dir);
  const sortKey = usePrefs(state => state.sortKey);
  const sortDesc = usePrefs(state => state.sortDesc);
  const blur = usePrefs(state => state.blur);
  const me = useSession(state => state.me);
  const closeViewer = useUi(state => state.closeViewer);
  const openDialog = useUi(state => state.openDialog);
  const mobile = useIsMobile();
  const { w: vw, h: vh } = useViewport();

  const files = useMemo(() => sortObjs((list.data?.content ?? []).filter(item => !item.is_dir), sortKey, sortDesc), [list.data, sortKey, sortDesc]);
  const [current, setCurrent] = useState(() => Math.max(0, files.findIndex(item => item.name === name)));
  const [direction, setDirection] = useState(0);
  useEffect(() => {
    if (!list.data) return;
    if (!files.length) { closeViewer(); return; }
    if (current >= files.length) setCurrent(files.length - 1);
  }, [files, current, list.data, closeViewer]);
  const obj = files[current] as Obj | undefined;
  const kind = obj ? kindOf(obj) : "file";
  const media = kind === "image" || kind === "video";
  // The thumbnail strip is for pictures and videos only: documents and archives
  // page with the arrows, the keys and the wheel, but never look like a gallery.
  const gallery = useMemo(() => files.filter(item => galleryKind(kindOf(item)) === "media"), [files]);
  // Subtitles beside the video, and the next episode by name (S01E02 after
  // S01E01) whatever the folder is sorted by.
  const videoName = obj && kind === "video" ? obj.name : "";
  const subtitles = useMemo(() => {
    if (!videoName) return undefined;
    const tracks = subtitlesFor(videoName, files);
    if (!tracks.length) return undefined;
    const byName = new Map(files.map(item => [item.name, item]));
    return { tracks, urlOf: (name: string) => proxyUrl(join(dir, name), byName.get(name) ?? { sign: "" }) };
  }, [videoName, files, dir]);
  const nextVideo = useMemo(() => {
    if (!videoName) return undefined;
    const videos = sortObjs(files.filter(item => kindOf(item) === "video"), "name", false);
    return videos[videos.findIndex(item => item.name === videoName) + 1];
  }, [videoName, files]);
  const strip = media && gallery.length > 1 && gallery.some(item => item.thumb) && !mobile;
  const [aspects, setAspects] = useState<Record<string, number>>({});
  // Videos start 16:9 (the tile they came from may be a square icon) until the metadata says otherwise.
  const aspect = obj ? aspects[obj.name] ?? (origin && kind !== "video" ? origin.width / origin.height : 16 / 9) : 16 / 9;
  const box = media ? fit(aspect, vw, vh, mobile, strip) : panelBox(vw, vh, mobile);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const zoom = useMotionValue(1);
  const panX = useMotionValue(0);
  const panY = useMotionValue(0);
  const scrim = useTransform(y, [0, 320], [1, 0.15]);
  const dragScale = useTransform(y, [0, 400], [1, 0.72]);
  const combinedScale = useTransform(() => scale.get() * dragScale.get());
  const [zoomed, setZoomed] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [closing, setClosing] = useState(false);
  const [more, setMore] = useState(false);

  // Opening: grow out of the tile that was tapped.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (!origin || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = flipFrom(origin, box);
    x.set(from.x); y.set(from.y); scale.set(from.scale);
    animate(x, 0, spring.sheet);
    animate(y, 0, spring.sheet);
    animate(scale, 1, spring.sheet);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resetZoom = useCallback(() => {
    animate(zoom, 1, spring.snappy); animate(panX, 0, spring.snappy); animate(panY, 0, spring.snappy);
    setZoomed(false);
  }, [zoom, panX, panY]);

  const go = useCallback((delta: number) => {
    const next = current + delta;
    if (next < 0 || next >= files.length) {
      animate(x, [0, -delta * 36, 0], { duration: 0.42, ease: "easeOut" }); // rubber-band at the ends
      return;
    }
    resetZoom();
    setDirection(delta);
    setCurrent(next);
  }, [current, files.length, resetZoom, x]);

  // Closing: shrink back into the tile of whatever is showing now.
  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const target = obj ? tileRect(obj.name) : null;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!target || reduced) { closeViewer(); return; }
    resetZoom();
    const to = flipFrom(target, box);
    const scaleNow = combinedScale.get();
    scale.set(scaleNow);
    y.stop();
    const yNow = y.get();
    void Promise.all([
      animate(x, to.x, spring.sheet),
      animate(y, [yNow, to.y], spring.sheet),
      animate(scale, to.scale, spring.sheet),
    ]).then(() => closeViewer());
    window.setTimeout(closeViewer, 650);
  }, [closing, obj, box, closeViewer, resetZoom, x, y, scale, combinedScale]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (useUi.getState().dialog) return;
      if (event.key === "Escape") { event.preventDefault(); close(); }
      else if (event.key === "ArrowRight" && !(event.target instanceof HTMLMediaElement)) go(1);
      else if (event.key === "ArrowLeft" && !(event.target instanceof HTMLMediaElement)) go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, go]);

  // Hide the chrome after a few idle seconds on media.
  useEffect(() => {
    if (!media) { setChrome(true); return; }
    let timer = window.setTimeout(() => setChrome(false), 3200);
    const wake = (): void => { setChrome(true); clearTimeout(timer); timer = window.setTimeout(() => setChrome(false), 3200); };
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    return () => { clearTimeout(timer); window.removeEventListener("pointermove", wake); window.removeEventListener("pointerdown", wake); };
  }, [media, current]);

  // Warm the neighbours.
  useEffect(() => {
    for (const offset of [1, -1]) {
      const near = files[current + offset];
      if (near && kindOf(near) === "image") { const img = new Image(); img.referrerPolicy = "no-referrer"; img.src = downloadUrl(join(dir, near.name), near); }
    }
  }, [current, files, dir]);

  // Pinch and wheel zoom for images.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const onPointerDown = (event: ReactPointerEvent): void => {
    if (kind !== "image") return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoom.get() };
    }
  };
  const onPointerMove = (event: ReactPointerEvent): void => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const next = Math.min(6, Math.max(1, pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance));
      zoom.set(next);
      setZoomed(next > 1.02);
    }
  };
  const onPointerUp = (event: ReactPointerEvent): void => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (zoom.get() <= 1.02) resetZoom();
  };
  const lastTap = useRef(0);
  const onTap = (event: ReactPointerEvent): void => {
    if (kind !== "image") return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (zoomed) resetZoom();
      else {
        const cx = event.clientX - (box.left + box.width / 2);
        const cy = event.clientY - (box.top + box.height / 2);
        animate(zoom, 2.5, spring.snappy); animate(panX, -cx * 1.5, spring.snappy); animate(panY, -cy * 1.5, spring.snappy);
        setZoomed(true);
      }
      lastTap.current = 0;
    } else lastTap.current = now;
  };
  const onWheel = (event: React.WheelEvent): void => {
    if (kind !== "image") return;
    const next = Math.min(6, Math.max(1, zoom.get() * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
    animate(zoom, next, spring.snappy);
    if (next <= 1.01) resetZoom(); else setZoomed(true);
  };

  // Wheel over the empty stage pages through files: one file per gesture. Each
  // wheel event during the cool-down extends it, so a trackpad fling or a fast
  // spin of the wheel moves one step, not ten.
  const wheel = useRef({ sum: 0, last: 0, lockUntil: 0 });
  const onStageWheel = (event: React.WheelEvent): void => {
    const now = performance.now();
    const state = wheel.current;
    const idle = now - state.last;
    state.last = now;
    if (now < state.lockUntil) { state.lockUntil = Math.max(state.lockUntil, now + 320); return; }
    if (idle > 320) state.sum = 0;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    state.sum += event.deltaMode === 1 ? delta * 40 : delta;
    if (Math.abs(state.sum) < 60) return;
    go(state.sum > 0 ? 1 : -1);
    state.sum = 0;
    state.lockUntil = now + 560;
  };

  const onDragEnd = (_: unknown, info: PanInfo): void => {
    if (zoomed) return;
    if (info.offset.y > 110 || info.velocity.y > 650) { close(); return; }
    if (info.offset.x < -70 || info.velocity.x < -500) go(1);
    else if (info.offset.x > 70 || info.velocity.x > 500) go(-1);
    animate(x, 0, spring.snappy);
    animate(y, 0, spring.snappy);
  };

  if (!obj) {
    return (
      <motion.div className="fixed inset-0 z-60 grid place-items-center bg-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeViewer}>
        <span className="spin size-6 rounded-full border-2 border-line-strong border-t-ink" />
      </motion.div>
    );
  }

  const path = join(dir, obj.name);
  const src = downloadUrl(path, obj);
  const fallback = proxyUrl(path, obj);
  const setAspect = (value: number): void => {
    if (Number.isFinite(value) && value > 0 && Math.abs((aspects[obj.name] ?? 0) - value) > 0.01) setAspects(state => ({ ...state, [obj.name]: value }));
  };
  const draggable = !zoomed && kind !== "video" && kind !== "audio";
  // 115 keeps its own transcodes; other storages have only the original.
  const cloudCapable = /115/.test(list.data?.provider ?? "");
  const darkStage = media;
  // Chrome over a dark stage is white; over the light scrim (documents) it follows the theme.
  const tone = darkStage
    ? { bar: "bg-gradient-to-b from-black/60 to-transparent text-white", text: "text-white", sub: "text-white/60", chip: "bg-white/10", hover: "hover:bg-white/15", danger: "text-[#ff8a7e]" }
    : { bar: "text-ink", text: "text-ink", sub: "text-muted", chip: "bg-raised hairline", hover: "hover:bg-[var(--hover)]", danger: "text-danger" };

  return (
    <motion.div className="fixed inset-0 z-60 select-none overflow-hidden" role="dialog" aria-modal="true" aria-label={obj.name}
      initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }}>
      {/* Fade in and out on the wrapper; the drag-to-dismiss fade lives on the layer
          inside. One element doing both left the stage transparent until the next
          re-render whenever the open animation was skipped (Reduce Motion on iOS). */}
      <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: closing ? 0 : 1 }} transition={{ duration: 0.35 }}
        onClick={close} onWheel={onStageWheel}>
        <motion.div className={`absolute inset-0 ${darkStage ? "bg-stage-deep" : "bg-scrim backdrop-blur-xl"}`} style={{ opacity: scrim }} />
      </motion.div>

      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={obj.name}
          custom={direction}
          className="absolute inset-0"
          variants={{
            enter: (d: number) => ({ x: d * Math.min(vw * 0.6, 420), opacity: 0, scale: 0.92 }),
            center: { x: 0, opacity: 1, scale: 1 },
            exit: (d: number) => ({ x: -d * Math.min(vw * 0.6, 420), opacity: 0, scale: 0.92 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={spring.soft}
          style={{ pointerEvents: "none" }}
        >
          <motion.div
            className={`pointer-events-auto absolute overflow-hidden ${media ? "rounded-[14px] max-sm:rounded-none" : ""} ${blur && media ? "" : ""}`}
            style={{ x, y, scale: combinedScale, touchAction: "none" }}
            animate={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            initial={false}
            transition={spring.soft}
            drag={draggable}
            dragDirectionLock
            dragElastic={0.9}
            dragMomentum={false}
            onDragEnd={onDragEnd}
            onPointerDown={event => { onPointerDown(event); onTap(event); }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            {kind === "image" && <ImageView key={obj.name} src={src} fallback={fallback} thumb={obj.thumb} zoom={zoom} panX={panX} panY={panY} onAspect={setAspect} />}
            {kind === "video" && <VideoPlayer key={obj.name} path={path} src={src} subtitles={subtitles}
              next={nextVideo ? { title: nextVideo.name.replace(/\.[^.]+$/, ""), thumb: nextVideo.thumb, play: () => { resetZoom(); setDirection(1); setCurrent(files.indexOf(nextVideo)); } } : undefined} fallback={fallback} thumb={obj.thumb} chrome={chrome} onAspect={setAspect} cloud={cloudCapable ? () => cloudVideo(path, passwordFor(dir)) : undefined} onDownload={() => actions.download(dir, obj)} onCopy={() => void actions.copyLinks(dir, [obj])} />}
            {kind === "audio" && <AudioView obj={obj} src={src} />}
            {(kind === "text" || kind === "code" || kind === "markdown") && <TextView obj={obj} url={fallback} kind={kind} />}
            {kind === "archive" && can(me, Perm.ReadArchives) && <ArchiveView dir={dir} obj={obj} />}
            {!media && kind !== "audio" && kind !== "text" && kind !== "code" && kind !== "markdown" && !(kind === "archive" && can(me, Perm.ReadArchives)) && <OtherView obj={obj} dir={dir} />}
          </motion.div>
        </motion.div>
      </AnimatePresence>

      {zoomed && kind === "image" && (
        <motion.div className="absolute inset-0 z-[1]" style={{ cursor: "grab" }}
          drag dragMomentum
          onDrag={(_, info) => { panX.set(panX.get() + info.delta.x); panY.set(panY.get() + info.delta.y); }}
          onPointerDown={onTap}
          onWheel={onWheel}
          dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
          dragElastic={0}
        />
      )}

      <motion.header
        className={`absolute inset-x-0 top-0 z-[2] flex items-center gap-2 ${tone.bar} px-3 pb-8 pt-[max(0.6rem,env(safe-area-inset-top))] ${tone.text} sm:px-5`}
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: chrome && !closing ? 1 : 0, y: chrome && !closing ? 0 : -16 }}
        transition={spring.snappy}
        style={{ pointerEvents: chrome ? "auto" : "none" }}
      >
        <button className={`grid size-9 place-items-center rounded-full ${tone.chip} backdrop-blur-md transition-transform ${tone.hover} active:scale-90`} onClick={close} aria-label="关闭"><XIcon size={18} /></button>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-[14px] font-medium">{obj.name}</p>
          <p className={`text-[12px] ${tone.sub} tabular`}>{current + 1} / {files.length}，{formatBytes(obj.size)}{extname(obj.name) ? `，${extname(obj.name).toUpperCase()}` : ""}</p>
        </div>
        {kind === "image" && !mobile && (
          <button className={`grid size-9 place-items-center rounded-full ${tone.hover}`} aria-label={zoomed ? "缩小" : "放大"}
            onClick={() => { if (zoomed) resetZoom(); else { animate(zoom, 2, spring.snappy); setZoomed(true); } }}>
            {zoomed ? <MagnifyingGlassMinusIcon size={18} /> : <MagnifyingGlassPlusIcon size={18} />}
          </button>
        )}
        <a className={`grid size-9 place-items-center rounded-full ${tone.hover}`} href={src} target="_blank" rel="noreferrer" aria-label="新标签页打开"><ArrowSquareOutIcon size={18} /></a>
        <button className={`grid size-9 place-items-center rounded-full ${tone.hover}`} onClick={() => actions.download(dir, obj)} aria-label="下载"><DownloadSimpleIcon size={18} /></button>
        <button className={`grid size-9 place-items-center rounded-full ${tone.hover}`} onClick={() => void actions.copyLinks(dir, [obj])} aria-label="复制链接"><LinkIcon size={18} /></button>
        {can(me, Perm.Share) && (
          <button className={`grid size-9 place-items-center rounded-full ${tone.hover} max-sm:hidden`} onClick={() => openDialog({ kind: "share", dir, names: [obj.name] })} aria-label="分享"><ShareNetworkIcon size={18} /></button>
        )}
        <button className={`grid size-9 place-items-center rounded-full ${tone.hover} max-sm:hidden`} onClick={() => openDialog({ kind: "info", dir, obj })} aria-label="属性"><InfoIcon size={18} /></button>
        <button className={`grid size-9 place-items-center rounded-full ${tone.hover} sm:hidden`} aria-label="更多"
          onClick={() => setMore(true)}><DotsThreeIcon size={20} weight="bold" /></button>
        {can(me, Perm.Remove) && (
          <button className={`grid size-9 place-items-center rounded-full ${tone.danger} ${tone.hover} max-sm:hidden`} aria-label="删除"
            onClick={() => openDialog({ kind: "delete", dir, names: [obj.name] })}><TrashIcon size={18} /></button>
        )}
      </motion.header>

      {!mobile && files.length > 1 && (
        <>
          {[-1, 1].map(delta => (
            <motion.button key={delta}
              className={`absolute top-1/2 z-[2] grid size-11 -translate-y-1/2 place-items-center rounded-full ${tone.chip} ${tone.text} backdrop-blur-md ${tone.hover} ${delta < 0 ? "left-4" : "right-4"}`}
              animate={{ opacity: chrome && !closing ? (files[current + delta] ? 1 : 0.25) : 0, x: chrome ? 0 : delta * 12 }}
              whileTap={{ scale: 0.88 }}
              onClick={() => go(delta)} aria-label={delta < 0 ? "上一个" : "下一个"}>
              {delta < 0 ? <CaretLeftIcon size={20} /> : <CaretRightIcon size={20} />}
            </motion.button>
          ))}
        </>
      )}

      <Menu open={more} x={0} y={0} onClose={() => setMore(false)} entries={[
        { heading: obj.name },
        { label: "属性", icon: <InfoIcon size={15} />, run: () => openDialog({ kind: "info", dir, obj }) },
        { label: "在新标签页打开", icon: <ArrowSquareOutIcon size={15} />, run: () => { window.open(src, "_blank", "noopener"); } },
        ...(can(me, Perm.Share) ? [{ label: "分享", icon: <ShareNetworkIcon size={15} />, run: () => openDialog({ kind: "share", dir, names: [obj.name] }) }] : []),
        ...(can(me, Perm.Remove) ? ["divider" as const, { label: "删除", icon: <TrashIcon size={15} />, danger: true, run: () => openDialog({ kind: "delete", dir, names: [obj.name] }) }] : []),
      ]} />

      {strip && (
        <motion.footer className="absolute inset-x-0 bottom-0 z-[2] flex justify-center bg-gradient-to-t from-black/60 to-transparent pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-6"
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: chrome && !closing ? 1 : 0, y: chrome && !closing ? 0 : 20 }} transition={spring.snappy}
          style={{ pointerEvents: chrome ? "auto" : "none" }}>
          <Strip items={gallery} current={gallery.indexOf(obj)} onPick={pick => {
            const index = files.indexOf(gallery[pick]);
            if (index >= 0 && index !== current) { resetZoom(); setDirection(index > current ? 1 : -1); setCurrent(index); }
          }} />
        </motion.footer>
      )}
    </motion.div>
  );
}

export function Viewer() {
  const viewer = useUi(state => state.viewer);
  return createPortal(
    <AnimatePresence>{viewer && <ViewerBody key={`${viewer.dir}`} dir={viewer.dir} name={viewer.name} origin={viewer.origin} />}</AnimatePresence>,
    document.body,
  );
}
