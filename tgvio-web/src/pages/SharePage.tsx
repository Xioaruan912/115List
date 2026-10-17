import { ArrowLeftIcon, CaretRightIcon, DownloadSimpleIcon, LinkBreakIcon, LockKeyIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, LayoutGroup, motion, useAnimate } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { cloudVideoInShare } from "../api/fs";
import { shareFileUrl, visit } from "../api/share";
import { VideoPlayer } from "../components/VideoPlayer";
import { copyText } from "../lib/links";
import { KindIcon } from "../components/KindIcon";
import { Mark } from "../components/Mark";
import { PosterWall } from "../components/PosterWall";
import { SplitText } from "../components/SplitText";
import { ApiError } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";
import { kindOf } from "../lib/kind";
import { spring } from "../lib/motion";
import { decodePath, encodePath, join, segments } from "../lib/path";
import { sortObjs } from "../lib/sort";
import type { Obj } from "../lib/types";
import { useSession } from "../stores/session";
import { ErrorState } from "../components/ErrorState";
import { explain } from "../lib/errors";

const Markdown = lazy(() => import("../components/Markdown"));

const codeKey = (sid: string): string => `tgvio-web:share:${sid}`;

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
      <motion.div className="rounded-t-[22px] bg-surface/90 px-6 pb-6 pt-7 backdrop-blur-2xl" style={{ boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.08), inset 0 0 0 1px rgb(255 255 255 / 0.07)" }}
        exit={{ y: -50, rotate: -5, opacity: 0, transition: { duration: 0.55, ease: [0.5, 0, 0.75, 0] } }}>
        <span className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-ink"><LockKeyIcon size={22} weight="fill" /></span>
        <h1 className="mt-5 text-[22px] font-semibold tracking-tight text-white">{title}</h1>
        <p className="mt-1 text-[13.5px] text-white/60">这是一个私密分享，输入提取码就能看到。</p>
        <label className="mt-5 block">
          <span className="label">提取码</span>
          <input className="field font-mono text-[18px] tracking-[0.3em]" value={code} autoFocus autoComplete="off" spellCheck={false}
            onChange={event => setCode(event.target.value.replace(/\s/g, ""))} aria-invalid={error} />
        </label>
        <AnimatePresence>
          {error && <motion.p className="mt-2 text-[13px] text-danger" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>提取码不对，再试一次</motion.p>}
        </AnimatePresence>
      </motion.div>
      <div className="ticket-cut mx-[18px]" style={{ "--raised": "var(--void)" } as CSSProperties} aria-hidden />
      <motion.div className="rounded-b-[22px] bg-surface/90 px-6 pb-6 pt-5 backdrop-blur-2xl" style={{ boxShadow: "inset 0 -1px 0 rgb(255 255 255 / 0.04), inset 0 0 0 1px rgb(255 255 255 / 0.07)" }}
        exit={{ y: 70, rotate: 7, opacity: 0, transition: { duration: 0.6, ease: [0.5, 0, 0.75, 0] } }}>
        <button className="btn btn-primary h-11 w-full" type="submit" disabled={!code.trim() || busy}>{busy ? "核对中…" : "入场"}</button>
      </motion.div>
    </motion.form>
  );
}

/* -------------------------------------------------------------- lightbox */

/** A video in a share: the same player as inside the drive, cloud versions included. */
function ShareVideo({ obj, url, share }: { obj: Obj; url: string; share: { sid: string; code: string; path: string } }) {
  return (
    <VideoPlayer path={`share:${share.sid}${share.path}`} src={url} fallback={url} thumb={obj.thumb}
      cloud={() => cloudVideoInShare(share.sid, share.code, share.path)}
      onDownload={() => { location.href = url; }} onCopy={() => void copyText(new URL(url, location.href).href)} />
  );
}

function Lightbox({ obj, url, share, onClose }: { obj: Obj; url: string; share: { sid: string; code: string; path: string }; onClose: () => void }) {
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
        {kind === "video" && <div className="relative aspect-video max-h-[80dvh] w-full"><ShareVideo obj={obj} url={url} share={share} /></div>}
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
      <motion.div layoutId={`share-${obj.name}`} className="relative aspect-[4/3] overflow-hidden rounded-[12px] bg-white/[0.04]" style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.07)" }} transition={spring.soft}>
        {obj.thumb && !broken
          ? <img src={obj.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover transition-transform duration-700 ease-[var(--ease-expo)] group-hover:scale-[1.06]" />
          : <span className="grid size-full place-items-center text-white/40"><KindIcon kind={kind} size={40} weight={obj.is_dir ? "duotone" : "light"} className="transition-transform duration-500 ease-[var(--ease-expo)] group-hover:scale-110 group-hover:-rotate-6" /></span>}
      </motion.div>
      <p className="mt-2 line-clamp-2 break-all text-[13.5px] font-medium leading-snug text-white">{obj.name}</p>
      <p className="text-[12px] text-white/50 tabular">{obj.is_dir ? formatDate(obj.modified) : formatBytes(obj.size)}</p>
    </>
  );
  const className = "enter group block rounded-[16px] p-1.5 text-left transition-colors hover:bg-white/[0.05]";
  const style = { "--i": index } as CSSProperties;
  if (obj.is_dir || media) return <button className={className} style={style} onClick={onOpen}>{body}</button>;
  return <a className={className} style={style} href={url} download={obj.name}>{body}</a>;
}

function Single({ obj, url, share }: { obj: Obj; url: string; share: { sid: string; code: string; path: string } }) {
  const kind = kindOf(obj);
  return (
    <div className="flex flex-col gap-5">
      {kind === "image" && <img src={url} alt={obj.name} referrerPolicy="no-referrer" className="max-h-[62dvh] w-full rounded-[14px] bg-black object-contain" />}
      {kind === "video" && <div className="relative aspect-video w-full overflow-hidden rounded-[14px]"><ShareVideo obj={obj} url={url} share={share} /></div>}
      {kind === "audio" && <audio src={url} controls className="w-full" />}
      {kind !== "image" && kind !== "video" && kind !== "audio" && (
        <motion.span className="grid size-24 place-items-center self-start rounded-[22px] bg-white/[0.05] text-accent" initial={{ rotate: -14, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ ...spring.pop, delay: 0.5 }}>
          <KindIcon kind={kind} size={46} weight="duotone" />
        </motion.span>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <a className="btn btn-primary h-11 px-5" href={url} download={obj.name}><DownloadSimpleIcon size={17} />下载 {formatBytes(obj.size)}</a>
        <span className="text-[13px] text-white/50 tabular">{formatDate(obj.modified)}</span>
      </div>
    </div>
  );
}

export function SharePage() {
  const { sid, path, go } = useShareLocation();
  const search = useSearch();
  const siteTitle = useSession(state => state.settings.site_title) || "OpenList";
  const signedIn = useSession(state => state.status === "ready");
  const [code, setCode] = useState(() => new URLSearchParams(search).get("pwd") ?? sessionStorage.getItem(codeKey(sid)) ?? "");
  const [failures, setFailures] = useState(0);
  const [gate, setGate] = useState(false);
  const [open, setOpen] = useState<Obj | null>(null);

  const info = useQuery({ queryKey: ["share-get", sid, path, code], queryFn: () => visit.get(sid, path, code), retry: false, staleTime: 60_000 });
  const isDir = info.data?.is_dir;
  const list = useQuery({ queryKey: ["share-list", sid, path, code], queryFn: ({ signal }) => visit.list(sid, path, code, signal), enabled: !!isDir, retry: false, staleTime: 60_000 });
  const items = useMemo(() => sortObjs(list.data?.content ?? [], "name", false), [list.data]);

  useEffect(() => {
    if (info.isSuccess && code) sessionStorage.setItem(codeKey(sid), code);
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
    <div className="theme-dark relative min-h-dvh overflow-x-hidden bg-void text-ink">
      <div className="fixed inset-0"><PosterWall /></div>
      <div className="fixed inset-0 bg-void/55" />
      <header className="relative z-10 mx-auto flex max-w-[1180px] items-center gap-3 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <Mark className="size-9 text-base" rounded="rounded-[11px]" />
        <span className="font-semibold tracking-tight text-white">{siteTitle}</span>
        <span className="flex-1" />
        <Link href={signedIn ? "/" : "/@login"} className="rounded-full px-3 py-1.5 text-[13px] text-white/70 transition-colors hover:bg-white/10 hover:text-white">{signedIn ? "打开网盘" : "登录"}</Link>
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
              <motion.span className="grid size-16 place-items-center rounded-[20px] bg-white/[0.06] text-white/70" initial={{ rotate: 0 }} animate={{ rotate: [0, -12, 10, -6, 0] }} transition={{ delay: 0.4, duration: 0.7 }}>
                <LinkBreakIcon size={30} />
              </motion.span>
              <h1 className="text-[26px] font-semibold tracking-tight text-white">链接已失效</h1>
              <p className="text-white/60">{/expired|no longer valid/i.test(info.error.message) ? "分享已过期，或访问次数已经用完。" : /not exist/i.test(info.error.message) ? "这个分享不存在，可能已被删除。" : explain(info.error).hint}</p>
            </motion.div>
          )}
          {info.data && (
            <motion.section key="content" className="w-full overflow-hidden rounded-[26px] bg-[#0f0f11]/80 backdrop-blur-2xl"
              style={{ boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.07), inset 0 0 0 1px rgb(255 255 255 / 0.06), 0 40px 120px -40px rgb(0 0 0 / 0.9)", transformPerspective: 1400, transformOrigin: "50% 0%" }}
              initial={{ opacity: 0, rotateX: 38, y: 90, scale: 0.94 }} animate={{ opacity: 1, rotateX: 0, y: 0, scale: 1 }} transition={{ ...spring.soft, delay: 0.1 }}>
              <div className="px-5 pb-5 pt-6 sm:px-8 sm:pt-8">
                {crumbs.length > 0 && (
                  <nav className="mb-3 flex flex-wrap items-center gap-1 text-[13px] text-white/55">
                    <button className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-white/10 hover:text-white" onClick={() => go("/")}><ArrowLeftIcon size={13} />全部</button>
                    {crumbs.slice(0, -1).map((name, index) => (
                      <span key={index} className="inline-flex items-center gap-1">
                        <CaretRightIcon size={11} className="opacity-50" />
                        <button className="rounded-md px-1.5 py-0.5 hover:bg-white/10 hover:text-white" onClick={() => go(`/${crumbs.slice(0, index + 1).join("/")}`)}>{name}</button>
                      </span>
                    ))}
                  </nav>
                )}
                <h1 className="break-words text-[clamp(26px,4.4vw,46px)] font-semibold leading-[1.05] tracking-[-0.04em] text-white">
                  <SplitText key={`${path}-${title}`} text={title || "分享"} />
                </h1>
                {isDir && list.data && (
                  <p className="mt-2 text-[13px] text-white/50 tabular">{items.length} 项{totalBytes ? `，${formatBytes(totalBytes)}` : ""}</p>
                )}
              </div>
              <div className="px-3 pb-6 sm:px-6 sm:pb-8">
                {!isDir && <div className="px-2"><Single obj={info.data} url={info.data.raw_url || shareFileUrl(sid, path, code)} share={{ sid, code, path }} /></div>}
                {isDir && list.isPending && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                    {Array.from({ length: 10 }, (_, i) => <div key={i} className="enter p-1.5" style={{ "--i": i } as CSSProperties}><div className="aspect-[4/3] rounded-[12px] bg-white/[0.05]" /><div className="mt-2 h-3.5 w-2/3 rounded bg-white/[0.06]" /></div>)}
                  </div>
                )}
                {isDir && list.isError && <ErrorState className="mx-2" error={list.error} onRetry={() => list.refetch()} />}
                {isDir && list.data && items.length === 0 && <p className="px-2 text-white/55">这个文件夹是空的。</p>}
                {isDir && items.length > 0 && (
                  <LayoutGroup>
                    <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-5">
                      {items.map((obj, index) => {
                        const inner = join(path, obj.name);
                        return <Tile key={obj.name} obj={obj} index={index} url={shareFileUrl(sid, inner, code)} onOpen={() => obj.is_dir ? go(inner) : setOpen(obj)} />;
                      })}
                    </div>
                    <AnimatePresence>
                      {open && <Lightbox key={open.name} obj={open} url={shareFileUrl(sid, join(path, open.name), code)} share={{ sid, code, path: join(path, open.name) }} onClose={() => setOpen(null)} />}
                    </AnimatePresence>
                  </LayoutGroup>
                )}
                {readme && (
                  <div className="mx-2 mt-6 rounded-[16px] bg-white/[0.03] px-5 py-4" style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.06)" }}>
                    <Suspense fallback={null}><Markdown source={readme} /></Suspense>
                  </div>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
