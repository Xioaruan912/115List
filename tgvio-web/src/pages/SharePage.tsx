import { ArrowLeftIcon, CaretRightIcon, DownloadSimpleIcon, LinkBreakIcon, LockKeyIcon, MoonIcon, SunIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, LayoutGroup, motion, useAnimate } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { cloudVideoInShare } from "../api/fs";
import { shareFileUrl, shareSubtitleUrl, visit } from "../api/share";
import { shareLibraryScope } from "../api/posters";
import { ShareLibrary } from "../components/ShareLibrary";
import { ShareSubtitleSearch } from "../components/ShareSubtitleSearch";
import { hasTitlePanel, SeriesPanel, SharePanelProvider, useTitlePanel } from "../components/SeriesPanel";
import { VideoPlayer } from "../components/VideoPlayer";
import { copyText } from "../lib/links";
import { KindIcon } from "../components/KindIcon";
import { Mark } from "../components/Mark";
import { applyTheme } from "../components/theme";
import { usePrefs } from "../stores/prefs";
import { PosterWall } from "../components/PosterWall";
import { SplitText } from "../components/SplitText";
import { ApiError } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";
import { kindOf } from "../lib/kind";
import { preferSubtitle, subtitlesFor, type SubtitleTrack } from "../lib/subtitles";
import { spring } from "../lib/motion";
import { basename, decodePath, encodePath, join, parent, segments } from "../lib/path";
import { sortObjs } from "../lib/sort";
import type { Obj } from "../lib/types";
import { useSession } from "../stores/session";
import { ErrorState } from "../components/ErrorState";
import { explain } from "../lib/errors";

const Markdown = lazy(() => import("../components/Markdown"));

const codeKey = (sid: string): string => `tgvio-web:share:${sid}`;

/**
 * A share opens bright: the page, its cards and the code gate follow the light
 * palette, and the film's own panel stays as dark as it is in the drive. Dark
 * is one tap away, and the choice is remembered on this device.
 */
const THEME_KEY = "tgvio-web:share-theme";
type ShareTheme = "light" | "dark";

function savedTheme(): ShareTheme {
  try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; } catch { return "light"; }
}

function chooseTheme(next: ShareTheme, set: (theme: ShareTheme) => void): void {
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode: this visit only */ }
  applyTheme(next);
  set(next);
}

function wrongCode(error: unknown): boolean {
  return error instanceof ApiError && error.code === 403;
}

/** Where we are: /@s/<id>/<path inside the share>. */
function useShareLocation(): { sid: string; path: string; go: (path: string) => void } {
  const [location, navigate] = useLocation();
  const parts = decodePath(location).split("/").filter(Boolean); // ["@s", id, ...rest]
  const sid = parts[1] ?? "";
  const path = `/${parts.slice(2).join("/")}`;
  return { sid, path, go: next => navigate(`/@s/${encodeURIComponent(sid)}${next === "/" ? "" : encodePath(next)}`) };
}

/* -------------------------------------------------------------- code gate */

function Gate({ title, initial, failures, busy, onSubmit }: { title: string; initial: string; failures: number; busy: boolean; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState(initial);
  const [scope, animateCard] = useAnimate<HTMLFormElement>();
  const error = failures > 0;
  useEffect(() => {
    if (failures && scope.current) void animateCard(scope.current, { x: [0, -14, 12, -8, 4, 0] }, { duration: 0.5 });
  }, [failures, animateCard, scope]);
  const submit = (event: FormEvent): void => { event.preventDefault(); if (code.trim()) onSubmit(code.trim()); };
  return (
    <motion.form ref={scope} onSubmit={submit} className="relative w-full max-w-[360px]"
      initial={{ opacity: 0, y: 60, rotateX: 50 }} animate={{ opacity: 1, y: 0, rotateX: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.01, delay: 0.6 } }}
      transition={{ ...spring.soft, delay: 0.35 }} style={{ transformPerspective: 1000 }}>
      {/* The ticket tears along the dashed line when the code is right. */}
      <motion.div className="hairline rounded-t-[22px] bg-surface px-6 pb-6 pt-7" style={{ boxShadow: "var(--shadow-lift)" }}
        exit={{ y: -50, rotate: -5, opacity: 0, transition: { duration: 0.55, ease: [0.5, 0, 0.75, 0] } }}>
        <span className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-ink"><LockKeyIcon size={22} weight="fill" /></span>
        <h1 className="mt-5 text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-[13.5px] text-muted">这是一个私密分享，输入提取码就能看到。</p>
        <label className="mt-5 block">
          <span className="label">提取码</span>
          <input className="field bg-[var(--bg)] font-mono text-[18px] tracking-[0.3em]" value={code} autoFocus autoComplete="off" spellCheck={false}
            onChange={event => setCode(event.target.value.replace(/\s/g, ""))} aria-invalid={error} />
        </label>
        <AnimatePresence>
          {error && <motion.p className="mt-2 text-[13px] text-danger" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>提取码不对，再试一次</motion.p>}
        </AnimatePresence>
      </motion.div>
      <div className="ticket-cut mx-[18px]" style={{ "--raised": "var(--bg)" } as CSSProperties} aria-hidden />
      <motion.div className="hairline rounded-b-[22px] bg-surface px-6 pb-6 pt-5" style={{ boxShadow: "var(--shadow-lift)" }}
        exit={{ y: 70, rotate: 7, opacity: 0, transition: { duration: 0.6, ease: [0.5, 0, 0.75, 0] } }}>
        <button className="btn btn-primary h-11 w-full" type="submit" disabled={!code.trim() || busy}>{busy ? "核对中…" : "入场"}</button>
      </motion.div>
    </motion.form>
  );
}

/* -------------------------------------------------------------- lightbox */

/** A subtitle picked online: the text stays in this browser, tied to one video. */
interface OnlineSub { path: string; track: SubtitleTrack; url: string }

/**
 * Subtitles for a video in a share: the files beside it, read by the server
 * (a share's storage may not allow the web proxy), plus any picked online.
 */
function useShareSubtitles(share: { sid: string; code: string; path: string }, online: OnlineSub[]) {
  const dir = parent(share.path);
  const list = useQuery({
    queryKey: ["share-subs", share.sid, dir, share.code],
    queryFn: () => visit.list(share.sid, dir, share.code),
    staleTime: 60_000,
    retry: false,
  });
  return useMemo(() => {
    const mine = online.filter(item => item.path === share.path);
    const local = subtitlesFor(basename(share.path), list.data?.content ?? []);
    const tracks = [...mine.map(item => item.track), ...local];
    if (!tracks.length) return undefined;
    const urlOf = (name: string) =>
      mine.find(item => item.track.name === name)?.url ?? shareSubtitleUrl(share.sid, share.code, join(dir, name));
    return { tracks, urlOf };
  }, [online, share.sid, share.code, share.path, dir, list.data]);
}

/** A video in a share: the same player as inside the drive, cloud versions included. */
function ShareVideo({ obj, url, share, online, onSearchSubtitles }: {
  obj: Obj; url: string; share: { sid: string; code: string; path: string }; online: OnlineSub[]; onSearchSubtitles?: () => void;
}) {
  const subtitles = useShareSubtitles(share, online);
  return (
    <VideoPlayer path={`share:${share.sid}${share.path}`} src={url} fallback={url} thumb={obj.thumb}
      subtitles={subtitles} onSearchSubtitles={onSearchSubtitles}
      cloud={() => cloudVideoInShare(share.sid, share.code, share.path)}
      onDownload={() => { location.href = url; }} onCopy={() => void copyText(new URL(url, location.href).href)} />
  );
}

function Lightbox({ obj, url, share, online, onSearchSubtitles, onClose }: { obj: Obj; url: string; share: { sid: string; code: string; path: string }; online: OnlineSub[]; onSearchSubtitles?: () => void; onClose: () => void }) {
  const kind = kindOf(obj);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-60 grid place-items-center p-3 sm:p-10">
      <motion.div className="absolute inset-0 bg-black/85 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div layoutId={`share-${obj.name}`} className="relative max-h-full w-full max-w-5xl overflow-hidden rounded-[18px] bg-black" transition={spring.soft}>
        {kind === "image" && <img src={url} alt={obj.name} referrerPolicy="no-referrer" className="mx-auto max-h-[80dvh] object-contain" />}
        {kind === "video" && <div className="relative aspect-video max-h-[80dvh] w-full"><ShareVideo obj={obj} url={url} share={share} online={online} onSearchSubtitles={onSearchSubtitles} /></div>}
        {kind === "audio" && <div className="p-8"><p className="mb-4 truncate text-white">{obj.name}</p><audio src={url} controls autoPlay className="w-full" /></div>}
      </motion.div>
      <motion.div className="relative mt-3 flex items-center gap-2" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.15 } }} exit={{ opacity: 0 }}>
        <a className="btn btn-primary" href={url} download={obj.name}><DownloadSimpleIcon size={16} />下载</a>
        <button className="btn btn-ghost text-white" onClick={onClose}><XIcon size={16} />关闭</button>
      </motion.div>
    </div>
  );
}

/* -------------------------------------------------------------- content */

function Tile({ obj, index, url, onOpen }: { obj: Obj; index: number; url: string; onOpen: () => void }) {
  const kind = kindOf(obj);
  const [broken, setBroken] = useState(false);
  const media = kind === "image" || kind === "video" || kind === "audio";
  const body = (
    <>
      <motion.div layoutId={`share-${obj.name}`} className="hairline relative aspect-[4/3] overflow-hidden rounded-[12px] bg-[var(--hover)]" transition={spring.soft}>
        {obj.thumb && !broken
          ? <img src={obj.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover transition-transform duration-700 ease-[var(--ease-expo)] group-hover:scale-[1.06]" />
          : <span className="grid size-full place-items-center text-faint"><KindIcon kind={kind} size={40} weight={obj.is_dir ? "duotone" : "light"} className="transition-transform duration-500 ease-[var(--ease-expo)] group-hover:scale-110 group-hover:-rotate-6" /></span>}
      </motion.div>
      <p className="mt-2 line-clamp-2 break-all text-[13.5px] font-medium leading-snug text-ink">{obj.name}</p>
      <p className="text-[12px] text-muted tabular">{obj.is_dir ? formatDate(obj.modified) : formatBytes(obj.size)}</p>
    </>
  );
  const className = "enter group block rounded-[16px] p-1.5 text-left transition-colors hover:bg-[var(--hover)]";
  const style = { "--i": index } as CSSProperties;
  if (obj.is_dir || media) return <button className={className} style={style} onClick={onOpen}>{body}</button>;
  return <a className={className} style={style} href={url} download={obj.name}>{body}</a>;
}

function Single({ obj, url, share, online, onSearchSubtitles }: { obj: Obj; url: string; share: { sid: string; code: string; path: string }; online: OnlineSub[]; onSearchSubtitles?: () => void }) {
  const kind = kindOf(obj);
  return (
    <div className="flex flex-col gap-5">
      {kind === "image" && <img src={url} alt={obj.name} referrerPolicy="no-referrer" className="max-h-[62dvh] w-full rounded-[14px] bg-black object-contain" />}
      {kind === "video" && <div className="relative aspect-video w-full overflow-hidden rounded-[14px]"><ShareVideo obj={obj} url={url} share={share} online={online} onSearchSubtitles={onSearchSubtitles} /></div>}
      {kind === "audio" && <audio src={url} controls className="w-full" />}
      {kind !== "image" && kind !== "video" && kind !== "audio" && (
        <motion.span className="grid size-24 place-items-center self-start rounded-[22px] bg-[var(--hover)] text-accent-text" initial={{ rotate: -14, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ ...spring.pop, delay: 0.5 }}>
          <KindIcon kind={kind} size={46} weight="duotone" />
        </motion.span>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <a className="btn btn-primary h-11 px-5" href={url} download={obj.name}><DownloadSimpleIcon size={17} />下载 {formatBytes(obj.size)}</a>
        <span className="text-[13px] text-muted tabular">{formatDate(obj.modified)}</span>
      </div>
    </div>
  );
}

export function SharePage() {
  const { sid, path, go } = useShareLocation();
  const search = useSearch();
  const siteTitle = useSession(state => state.settings.site_title) || "OpenList";
  const signedIn = useSession(state => state.status === "ready");
  // The code comes from the link (?pw=, or ?pwd= from older links) or from what
  // this device already typed: once a code is known here, the page opens itself.
  const [code, setCode] = useState(() => {
    const link = new URLSearchParams(search);
    return link.get("pw") ?? link.get("pwd") ?? localStorage.getItem(codeKey(sid)) ?? sessionStorage.getItem(codeKey(sid)) ?? "";
  });
  const [failures, setFailures] = useState(0);
  const [gate, setGate] = useState(false);
  const [open, setOpen] = useState<Obj | null>(null);
  // A file picked in 片库: it is not in the folder the page has open.
  const [playing, setPlaying] = useState<string | null>(null);
  const [mode, setMode] = useState<"library" | "files" | null>(null);
  const [theme, setTheme] = useState<ShareTheme>(savedTheme);
  // An online subtitle picked for one video in this browser (never written into the share).
  const [online, setOnline] = useState<OnlineSub[]>([]);
  const [subFor, setSubFor] = useState<string | null>(null);

  // The page brings its own palette (light unless chosen otherwise); leaving it
  // gives the site's own theme back.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => () => { applyTheme(usePrefs.getState().theme); }, []);

  const info = useQuery({ queryKey: ["share-get", sid, path, code], queryFn: () => visit.get(sid, path, code), retry: false, staleTime: 60_000 });
  const isDir = info.data?.is_dir;
  const list = useQuery({ queryKey: ["share-list", sid, path, code], queryFn: ({ signal }) => visit.list(sid, path, code, signal), enabled: !!isDir, retry: false, staleTime: 60_000 });
  const items = useMemo(() => sortObjs(list.data?.content ?? [], "name", false), [list.data]);
  // 片库 or 文件: the share's films listed like the library when it holds any.
  const scope = useQuery({ queryKey: ["share-scope", sid, code], queryFn: () => shareLibraryScope(sid, code), enabled: !!info.data, retry: false, staleTime: 5 * 60_000 });
  const modeKey = `tgvio-web:share-mode:${sid}`;
  // A share of one film or one series opens on its own page (backdrop, poster,
  // 播放); a share of many shows them as 片库. Deciding needs the title lookup.
  const panel = useMemo(() => ({ sid, code, play: (p: string) => setPlaying(p), openDir: (p: string) => go(p) }), [sid, code, go]);
  const titleQuery = useTitlePanel(isDir ? path : "/", items, panel);
  const isTitle = isDir && hasTitlePanel(titleQuery.data);
  const view = (mode ?? sessionStorage.getItem(modeKey) ?? (isTitle || !scope.data?.enabled ? "files" : "library")) as "library" | "files";
  const choose = (next: "library" | "files"): void => { sessionStorage.setItem(modeKey, next); setMode(next); };
  const showLibrary = isDir && view === "library" && !!scope.data?.enabled && !isTitle;
  const asObj = (file: string): Obj => ({ name: basename(file), size: 0, is_dir: false, modified: "", created: "", sign: "", thumb: "", type: 0, hashinfo: "" });

  const addOnline = (file: string, picked: { name: string; text: string; lang: string }): void => {
    const ext = (picked.name.split(".").pop() ?? "srt").toLowerCase();
    const format = (ext === "ssa" ? "ass" : ext === "ass" || ext === "vtt" ? ext : "srt") as SubtitleTrack["format"];
    const label = picked.lang ? `在线 · ${picked.lang}` : `在线 · ${basename(picked.name)}`;
    const track: SubtitleTrack = { name: label, format, label, rank: 99 };
    const url = URL.createObjectURL(new Blob([picked.text], { type: "text/plain;charset=utf-8" }));
    preferSubtitle(track.name);
    setOnline(items => [...items.filter(item => item.path !== file), { path: file, track, url }]);
  };

  useEffect(() => {
    if (info.isSuccess && code) {
      localStorage.setItem(codeKey(sid), code);
      sessionStorage.setItem(codeKey(sid), code);
    }
  }, [info.isSuccess, code, sid]);
  useEffect(() => {
    document.title = `${info.data && !info.data.is_dir ? info.data.name : "分享"} - ${siteTitle}`;
  }, [info.data, siteTitle]);

  const locked = info.isError && wrongCode(info.error);
  const dead = info.isError && !locked;
  // Once the gate is up it stays up while a code is being checked, and only
  // tears open when the share actually loads: a wrong code shakes it instead.
  useEffect(() => {
    if (locked) setGate(true);
    else if (info.data) setGate(false);
  }, [locked, info.data]);
  useEffect(() => {
    if (locked && code) setFailures(n => n + 1);
  }, [info.errorUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const showGate = (gate || locked) && !info.data;
  const title = path === "/" ? (info.data && info.data.name !== sid ? info.data.name : `${items.length || ""} 个文件`.trim()) : segments(path).at(-1) ?? "";
  const crumbs = segments(path);
  const readme = list.data?.readme || info.data?.readme || "";
  const totalBytes = items.reduce((sum, item) => sum + (item.is_dir ? 0 : item.size), 0);

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-bg text-ink">
      {/* Light is the default a share opens in; dark keeps the film wall. */}
      {theme === "dark"
        ? <div className="fixed inset-0"><PosterWall /></div>
        : <div className="pointer-events-none fixed inset-0" style={{ background: "radial-gradient(1100px 520px at 50% -10%, rgb(196 236 92 / 0.16), transparent 70%)" }} />}
      {theme === "dark" && <div className="fixed inset-0 bg-void/55" />}
      <header className="relative z-10 mx-auto flex max-w-[1180px] items-center gap-3 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <Mark className="size-9 text-base" rounded="rounded-[11px]" />
        <span className="font-semibold tracking-tight text-ink">{siteTitle}</span>
        <span className="flex-1" />
        <button className="icon-btn" aria-label={theme === "dark" ? "换成明亮主题" : "换成深色主题"} title={theme === "dark" ? "明亮" : "深色"} onClick={() => chooseTheme(theme === "dark" ? "light" : "dark", setTheme)}>
          {theme === "dark" ? <SunIcon size={17} /> : <MoonIcon size={17} />}
        </button>
        <Link href={signedIn ? "/" : "/@login"} className="rounded-full px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-[var(--hover)] hover:text-ink">{signedIn ? "打开网盘" : "登录"}</Link>
      </header>

      <main className="relative z-10 mx-auto flex min-h-[calc(100dvh-80px)] max-w-[1180px] flex-col items-center justify-center px-4 pb-16 pt-8 sm:px-8">
        <AnimatePresence mode="wait">
          {info.isPending && !showGate && (
            <motion.span key="wait" className="size-10 rounded-[12px] bg-accent" exit={{ scale: 0, rotate: 90, transition: { duration: 0.2, repeat: 0 } }}
              animate={{ scale: [1, 0.82, 1], rotate: [0, 90, 180] }} transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }} />
          )}
          {showGate && (
            <Gate key="gate" title="有人给你分享了文件" initial={code} failures={failures} busy={info.isFetching}
              onSubmit={next => { if (next === code) void info.refetch(); else setCode(next); }} />
          )}
          {dead && (
            <motion.div key="dead" className="flex max-w-sm flex-col items-center gap-4 text-center" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
              <motion.span className="grid size-16 place-items-center rounded-[20px] bg-[var(--hover)] text-muted" initial={{ rotate: 0 }} animate={{ rotate: [0, -12, 10, -6, 0] }} transition={{ delay: 0.4, duration: 0.7 }}>
                <LinkBreakIcon size={30} />
              </motion.span>
              <h1 className="text-[26px] font-semibold tracking-tight text-ink">链接已失效</h1>
              <p className="text-muted">{/expired|no longer valid/i.test(info.error.message) ? "分享已过期，或访问次数已经用完。" : /not exist/i.test(info.error.message) ? "这个分享不存在，可能已被删除。" : explain(info.error).hint}</p>
            </motion.div>
          )}
          {info.data && (
            <motion.section key="content" className="hairline w-full overflow-hidden rounded-[26px] bg-surface/85 backdrop-blur-2xl"
              style={{ boxShadow: "var(--shadow-float)", transformPerspective: 1400, transformOrigin: "50% 0%" }}
              initial={{ opacity: 0, rotateX: 38, y: 90, scale: 0.94 }} animate={{ opacity: 1, rotateX: 0, y: 0, scale: 1 }} transition={{ ...spring.soft, delay: 0.1 }}>
              <div className="px-5 pb-5 pt-6 sm:px-8 sm:pt-8">
                {crumbs.length > 0 && (
                  <nav className="mb-3 flex flex-wrap items-center gap-1 text-[13px] text-muted">
                    <button className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-[var(--hover)] hover:text-ink" onClick={() => go("/")}><ArrowLeftIcon size={13} />全部</button>
                    {crumbs.slice(0, -1).map((name, index) => (
                      <span key={index} className="inline-flex items-center gap-1">
                        <CaretRightIcon size={11} className="opacity-50" />
                        <button className="rounded-md px-1.5 py-0.5 hover:bg-[var(--hover)] hover:text-ink" onClick={() => go(`/${crumbs.slice(0, index + 1).join("/")}`)}>{name}</button>
                      </span>
                    ))}
                  </nav>
                )}
                <div className={`flex flex-wrap items-end justify-between gap-x-5 gap-y-3 ${isTitle ? "hidden" : ""}`}>
                  <h1 className="break-words text-[clamp(26px,4.4vw,46px)] font-semibold leading-[1.05] tracking-[-0.04em] text-ink">
                    <SplitText key={`${path}-${title}`} text={title || "分享"} />
                  </h1>
                  {/* 片库 / 文件: the same share, as films or as folders. A share
                      of one title has nothing to switch: it opens on its page. */}
                  {isDir && scope.data?.enabled && !isTitle && (
                    <div className="flex shrink-0 items-center rounded-full bg-[var(--hover)] p-0.5" role="group" aria-label="视图">
                      {(["library", "files"] as const).map(key => (
                        <button key={key} aria-pressed={view === key} onClick={() => choose(key)}
                          className={`relative h-8 rounded-full px-3.5 text-[13px] transition-colors ${view === key ? "text-accent-ink" : "text-muted hover:text-ink"}`}>
                          {view === key && <motion.span layoutId={`share-mode-${sid}`} className="absolute inset-0 rounded-full bg-accent" transition={spring.snappy} />}
                          <span className="relative">{key === "library" ? "片库" : "文件"}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {isDir && list.data && !isTitle && (
                  <p className="mt-2 text-[13px] text-muted tabular">
                    {showLibrary ? "按海报浏览这个分享里的影视" : `${items.length} 项${totalBytes ? `，${formatBytes(totalBytes)}` : ""}`}
                  </p>
                )}
              </div>
              <div className="px-3 pb-6 sm:px-6 sm:pb-8">
                {!isDir && <div className="px-2"><Single obj={info.data} url={info.data.raw_url || shareFileUrl(sid, path, code)} share={{ sid, code, path }} online={online} onSearchSubtitles={() => setSubFor(path)} /></div>}
                {/* A folder that is a film or a series: its page, as in the drive. */}
                {isTitle && (
                  <div className="mb-5 mt-1 px-2 sm:px-3">
                    <SharePanelProvider share={panel}>
                      <SeriesPanel path={path} items={items} />
                    </SharePanelProvider>
                  </div>
                )}
                {showLibrary && (
                  <div className="px-2 sm:px-3">
                    <ShareLibrary sid={sid} code={code}
                      onOpenDir={next => { choose("files"); go(next); }}
                      onPlay={next => setPlaying(next)} />
                  </div>
                )}
                {isDir && !showLibrary && list.isPending && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                    {Array.from({ length: 10 }, (_, i) => <div key={i} className="enter p-1.5" style={{ "--i": i } as CSSProperties}><div className="aspect-[4/3] rounded-[12px] bg-[var(--hover)]" /><div className="mt-2 h-3.5 w-2/3 rounded bg-[var(--hover)]" /></div>)}
                  </div>
                )}
                {isDir && !showLibrary && list.isError && <ErrorState className="mx-2" error={list.error} onRetry={() => list.refetch()} />}
                {isDir && !showLibrary && list.data && items.length === 0 && <p className="px-2 text-muted">这个文件夹是空的。</p>}
                {isDir && !showLibrary && items.length > 0 && (
                  <LayoutGroup>
                    <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-5">
                      {items.map((obj, index) => {
                        const inner = join(path, obj.name);
                        return <Tile key={obj.name} obj={obj} index={index} url={shareFileUrl(sid, inner, code)} onOpen={() => obj.is_dir ? go(inner) : setOpen(obj)} />;
                      })}
                    </div>
                    <AnimatePresence>
                      {open && <Lightbox key={open.name} obj={open} url={shareFileUrl(sid, join(path, open.name), code)} share={{ sid, code, path: join(path, open.name) }} online={online} onSearchSubtitles={() => setSubFor(join(path, open.name))} onClose={() => setOpen(null)} />}
                    </AnimatePresence>
                  </LayoutGroup>
                )}
                {/* A video played from 片库: same player, same place remembered. */}
                <AnimatePresence>
                  {playing && <Lightbox key={playing} obj={asObj(playing)} url={shareFileUrl(sid, playing, code)} share={{ sid, code, path: playing }} online={online} onSearchSubtitles={() => setSubFor(playing)} onClose={() => setPlaying(null)} />}
                </AnimatePresence>
                {readme && (
                  <div className="hairline mx-2 mt-6 rounded-[16px] bg-[var(--hover)] px-5 py-4">
                    <Suspense fallback={null}><Markdown source={readme} /></Suspense>
                  </div>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
      {subFor && (
        <ShareSubtitleSearch share={{ sid, code, path: subFor }} onClose={() => setSubFor(null)}
          onUse={picked => addOnline(subFor, picked)} />
      )}
    </div>
  );
}
