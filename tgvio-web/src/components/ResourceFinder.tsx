import {
  ArrowSquareOutIcon, BookmarkSimpleIcon, CaretDownIcon, CaretLeftIcon, CheckIcon, ClipboardTextIcon, DownloadSimpleIcon, FolderSimpleIcon, MagnetIcon, StarIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import * as fs from "../api/fs";
import { posters, type Poster } from "../api/posters";
import { resources, searchURL, type ResourceSite, type ResourceTitle } from "../api/resources";
import { useLibraryScope } from "../hooks/useLibraryScope";
import { reason } from "../lib/errors";
import { formatBytes } from "../lib/format";
import { bookmarklet, folderName, fromHTML, fromSeed, fromText, rank, type Magnet } from "../lib/magnets";
import { spring } from "../lib/motion";
import { basename, join } from "../lib/path";
import { markPendingRename } from "../lib/pendingRename";
import { toast } from "../stores/toast";
import { FolderPicker } from "./Dialogs";
import { ErrorState } from "./ErrorState";
import { Sheet } from "./Sheet";

/**
 * 找资源, in two steps that follow on by themselves:
 *
 *   1. 搜：typing searches the sites the server reads (SeedHub) and lists
 *      their titles; a site that only opens in the browser gets one button,
 *      and the magnets copied there can be pasted anywhere in this sheet.
 *   2. 选：a title (or a paste) shows its releases, Chinese subtitles first,
 *      the best one already ticked, the folder and collection already chosen;
 *      下载 sends them to the drive's offline download.
 *
 * TMDB stays behind the scenes: the picked title is matched to name the
 * collection folder and set its poster, so 按 TMDB 整理命名 works later.
 */

const BASE_KEY = "tgvio-web:resources-folder";

/** The TMDB entry of a site's title: same name, film or series, year within one (sites and TMDB disagree on first airing). */
async function matchTMDB(title: string, year: number | undefined, tv: boolean | undefined): Promise<Poster | null> {
  try {
    const { results } = await posters.search(title);
    const fits = (r: Poster) => (tv === undefined || (r.kind === "tv") === tv) && (!year || !r.year || Math.abs(r.year - year) <= 1);
    return results.find(r => (r.title === title || r.original === title) && fits(r)) ?? results.find(fits) ?? null;
  } catch { return null; }
}

function TitleRow({ title, onOpen, busy }: { title: ResourceTitle; onOpen: () => void; busy: boolean }) {
  return (
    <li>
      <button onClick={onOpen} disabled={busy}
        className="flex w-full items-center gap-3 rounded-[12px] p-2 text-left transition-colors hover:bg-[var(--hover)] disabled:opacity-60">
        <span className="h-[72px] w-12 shrink-0 overflow-hidden rounded-[8px] bg-surface">{title.image && <img src={title.image} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" />}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium">{title.title}</span>
          {title.info && <span className="block truncate text-[12px] text-faint">{title.info}</span>}
          <span className="mt-0.5 flex items-center gap-2 text-[12px] text-muted tabular">
            {title.year}{title.kind && <span>{title.kind}</span>}
            {title.rating ? <span className="inline-flex items-center gap-0.5"><StarIcon size={11} weight="fill" className="text-accent-text" />{title.rating.toFixed(1)}</span> : null}
          </span>
        </span>
        <span className="shrink-0 pr-1 text-[12.5px] text-accent-text">{busy ? "读取中…" : "看资源"}</span>
      </button>
    </li>
  );
}

/** Step 1 for a site the server reads: its titles, as the person types. */
function SiteTitles({ site, query, opening, onOpen }: { site: ResourceSite; query: string; opening: string; onOpen: (title: ResourceTitle) => void }) {
  const titles = useQuery({ queryKey: ["resource-titles", site.id, query], queryFn: () => resources.titles(site.id, query), enabled: !!query, staleTime: 10 * 60_000, retry: false });
  if (!query) return null;
  if (titles.isPending) return <ul className="mt-3 space-y-1">{Array.from({ length: 3 }, (_, i) => <li key={i} className="skeleton h-[88px] rounded-[12px]" style={{ opacity: 1 - i * 0.2 }} />)}</ul>;
  if (titles.isError) return <ErrorState compact className="mt-3" error={titles.error} onRetry={() => titles.refetch()} />;
  if (!titles.data.items.length) return <p className="mt-6 text-center text-[13px] text-muted">{site.name} 上没有「{query}」，换个叫法试试</p>;
  return (
    <ul className="mt-2">
      {titles.data.items.map(title => <TitleRow key={title.id} title={title} busy={opening === title.id} onOpen={() => onOpen(title)} />)}
    </ul>
  );
}

/** A bookmark that sends a site page's magnets back here. React refuses javascript: links, so the href is set by hand. */
function Bookmarklet() {
  const ref = useRef<HTMLAnchorElement>(null);
  const code = useMemo(() => bookmarklet(location.origin), []);
  useEffect(() => { ref.current?.setAttribute("href", code); }, [code]);
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] leading-relaxed text-faint">
      <span>不想一条条复制：把</span>
      <a ref={ref} className="inline-flex items-center gap-1 rounded-[8px] bg-accent-soft px-2 py-0.5 font-medium text-accent-text" onClick={event => event.preventDefault()} draggable>
        <BookmarkSimpleIcon size={13} />送回影视库
      </a>
      <span>拖到书签栏，在资源站页面点它，整页磁力直接送回来。</span>
      <button className="underline hover:text-ink" onClick={() => void navigator.clipboard.writeText(decodeURIComponent(code)).then(() => toast.success("书签代码已复制", "手机上：收藏任意网页，把书签网址换成这段代码"), () => toast.error("没能复制"))}>
        手机用：复制书签代码
      </button>
    </p>
  );
}

function SeedRow({ item, on, onToggle }: { item: Magnet; on: boolean; onToggle: () => void }) {
  return (
    <li>
      <button className={`flex w-full items-start gap-3 rounded-[12px] px-3 py-3 text-left transition-colors hover:bg-[var(--hover)] ${on ? "bg-accent-soft" : ""}`} onClick={onToggle} aria-pressed={on}>
        <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] ${on ? "bg-accent text-accent-ink" : ""}`} style={on ? undefined : { boxShadow: "inset 0 0 0 1.5px var(--line-strong)" }}>
          {on && <CheckIcon size={13} weight="bold" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-all text-[13.5px] leading-snug">{item.title}</span>
          <span className="mt-1.5 flex flex-wrap gap-1">
            {item.tags.map(tag => (
              <span key={tag} className={`rounded-[6px] px-1.5 py-px text-[11px] ${tag === "中字" ? "bg-accent text-accent-ink" : tag === "合集" ? "text-accent-text hairline" : "text-muted hairline"}`}>{tag}</span>
            ))}
          </span>
        </span>
        <span className="shrink-0 pt-0.5 text-[12.5px] text-muted tabular">{item.size ? formatBytes(item.size) : ""}</span>
      </button>
    </li>
  );
}

type Picked = { title: string; year?: number; kind?: string; image?: string; tv?: boolean };

export function ResourceFinder({ initialQuery = "", initialItems, onClose }: { initialQuery?: string; initialItems?: Magnet[]; onClose: () => void }) {
  const library = useLibraryScope();
  const sites = useQuery({ queryKey: ["resources"], queryFn: resources.list, staleTime: 5 * 60_000 });
  const [query, setQuery] = useState(initialQuery);
  const typed = useDeferredValue(query.trim());
  // Search once typing settles, not on every key.
  const [searched, setSearched] = useState(initialQuery.trim());
  useEffect(() => { const timer = window.setTimeout(() => setSearched(typed), 450); return () => clearTimeout(timer); }, [typed]);

  // Step 2 state: what was picked and its releases.
  const [picked, setPickedTitle] = useState<Picked | null>(initialItems?.length ? { title: "粘贴的磁力" } : null);
  const [items, setItems] = useState<Magnet[]>(() => rank(initialItems ?? []));
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(initialItems?.length ? [rank(initialItems)[0].hash] : []));
  const [subject, setSubject] = useState<Poster | null>(null);
  const [onlySubs, setOnlySubs] = useState(false);
  const [opening, setOpening] = useState("");
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState("");

  // Where it goes: the remembered (or first library) folder, a collection folder for series or several picks.
  const [base, setBase] = useState(() => localStorage.getItem(BASE_KEY) ?? "");
  useEffect(() => { if (!base && library.paths.length) setBase(library.paths[0]); }, [base, library.paths]);
  const [where, setWhere] = useState(false);
  const [collection, setCollection] = useState<boolean | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enabledSites = sites.data?.sites ?? [];
  const readers = enabledSites.filter(site => site.reader);
  const browserSites = enabledSites.filter(site => !site.reader);

  const show = (title: Picked, found: Magnet[]): void => {
    const next = rank(found);
    setPickedTitle(title);
    setItems(next);
    setTicked(new Set(next.length ? [next[0].hash] : []));
    setOnlySubs(false);
    setCollection(null);
    setName(null);
    setSubject(null);
    void matchTMDB(title.title === "粘贴的磁力" ? query.trim() || "" : title.title, title.year, title.tv).then(setSubject);
  };

  const openTitle = async (site: ResourceSite, title: ResourceTitle): Promise<void> => {
    setOpening(title.id);
    try {
      const { items: seeds } = await resources.seeds(site.id, title.id);
      if (!seeds.length) { toast.error(`「${title.title}」暂时没有磁力资源`, "换一部，或者去网站上看看"); return; }
      show({ title: title.title, year: title.year, kind: title.kind, image: title.image, tv: /剧|动漫|综艺/.test(title.kind ?? "") }, seeds.map(seed => fromSeed(site.id, seed)));
    } catch (error) { toast.error(`没有读到 ${site.name} 的资源`, error); }
    finally { setOpening(""); }
  };

  // Magnets pasted anywhere in the sheet go straight to step 2 (or join the list there).
  const takePaste = (found: Magnet[]): boolean => {
    if (!found.length) return false;
    if (picked) {
      const next = rank([...items, ...found]);
      setItems(next);
      setTicked(current => current.size ? current : new Set([next[0].hash]));
    } else {
      show({ title: query.trim() || "粘贴的磁力" }, found);
    }
    toast.success(`收到 ${found.length} 个磁力`, found.some(item => item.tags.includes("中字")) ? "带中文字幕的排在前面" : undefined);
    return true;
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const found = html ? fromHTML(html) : [];
    if (takePaste(found.length ? found : fromText(text))) event.preventDefault();
  };
  const readClipboard = async (): Promise<void> => {
    try { if (!takePaste(fromText(await navigator.clipboard.readText()))) toast.error("剪贴板里没有磁力链接"); }
    catch { toast.error("读不到剪贴板", "在下面的框里粘贴也可以"); }
  };

  const shown = onlySubs ? items.filter(item => item.tags.includes("中字")) : items;
  const chosen = items.filter(item => ticked.has(item.hash));
  const isCollection = collection ?? (chosen.length > 1 || !!picked?.tv || subject?.kind === "tv");
  const folder = (name ?? (subject ? folderName(subject.title, subject.year) : picked && picked.title !== "粘贴的磁力" ? folderName(picked.title, picked.year) : folderName(query))).trim();
  const target = isCollection && folder ? join(base, folder) : base;

  const submit = async (): Promise<void> => {
    if (!chosen.length || !base) return;
    setBusy(true);
    try {
      // Seeds read by the server get their magnets now, only for what was ticked.
      const urls: string[] = chosen.filter(item => item.url).map(item => item.url);
      const bySite = new Map<string, string[]>();
      for (const item of chosen) if (item.seed) bySite.set(item.seed.site, [...(bySite.get(item.seed.site) ?? []), item.seed.id]);
      let failed = 0;
      for (const [site, seeds] of bySite) {
        const { items: found } = await resources.magnets(site, seeds);
        for (const one of found) { if (one.url) urls.push(one.url); else failed++; }
      }
      if (!urls.length) throw new Error("没能取到磁力链接，换一个资源试试");
      if (isCollection && folder) {
        await fs.mkdir(target).catch((error: unknown) => { if (!/exist/i.test(reason(error))) throw error; });
        if (subject) await posters.set(folder, { kind: subject.kind, id: subject.id }).catch(() => undefined);
      }
      const tools = await fs.offlineTools(target);
      const tool = tools.find(item => fs.nativeOfflineTools.includes(item)) ?? tools[0];
      if (!tool) throw new Error("这个文件夹所在的网盘不支持离线下载");
      await fs.offlineDownload(target, urls, tool, "delete_on_upload_succeed");
      try { localStorage.setItem(BASE_KEY, base); } catch { /* ignore */ }
      if (isCollection && folder) markPendingRename(target);
      if (failed) toast.error(`${failed} 个资源没取到磁力`, "其余的已经开始下载");
      toast.success(`已开始下载 ${urls.length} 个`, isCollection ? `保存在「${folder}」，下好后打开它可以一键整理命名` : `保存到 ${basename(target) || target}`);
      onClose();
    } catch (error) {
      toast.error("没有添加成功", error);
    } finally {
      setBusy(false);
    }
  };

  const step2 = !!picked;
  return (
    <Sheet open onClose={onClose} width={680}
      title={step2
        ? <button className="-ml-1.5 inline-flex items-center gap-1 rounded-[8px] py-0.5 pl-1 pr-2 hover:bg-[var(--hover)]" onClick={() => setPickedTitle(null)} aria-label="返回搜索"><CaretLeftIcon size={16} />{picked.title}</button>
        : "找资源"}
      footer={step2 ? <>
        <button className="mr-auto flex min-w-0 items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13px] hover:bg-[var(--hover)]" onClick={() => setWhere(open => !open)} aria-expanded={where} title={target}>
          <FolderSimpleIcon size={17} weight="duotone" className="shrink-0 text-accent-text" />
          <span className="min-w-0 truncate"><span className="text-faint">保存到 </span>{target ? target.split("/").filter(Boolean).slice(-2).join(" / ") : "（选个文件夹）"}</span>
          <CaretDownIcon size={12} className={`shrink-0 text-faint transition-transform ${where ? "rotate-180" : ""}`} />
        </button>
        <button className="btn btn-primary" disabled={!chosen.length || !base || busy} onClick={() => void submit()}>
          <DownloadSimpleIcon size={16} />{busy ? "添加中…" : chosen.length > 1 ? `下载 ${chosen.length} 个` : "下载"}
        </button>
      </> : undefined}>
      <div onPaste={onPaste}>
        <AnimatePresence mode="popLayout" initial={false}>
          {!step2 ? (
            <motion.div key="search" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={spring.snappy}>
              <input id="resource-q" className="field h-12 text-[16px]" value={query} onChange={event => setQuery(event.target.value)} placeholder="片名，比如：潜伏" autoFocus aria-label="片名"
                onKeyDown={event => { if (event.key === "Enter") setSearched(query.trim()); }} />

              {readers.map(site => <SiteTitles key={site.id} site={site} query={searched} opening={opening} onOpen={title => void openTitle(site, title)} />)}

              {sites.data && !enabledSites.length && <p className="mt-6 text-center text-[13px] text-muted">还没有可用的资源网站，请管理员在 设置 › 影视库 › 资源搜索 里添加。</p>}

              {/* Sites that only open in the browser: one button each; then paste here. */}
              {browserSites.length > 0 && (
                <div className={readers.length ? "mt-4 border-t border-line pt-4" : "mt-4"}>
                  {!readers.length && <p className="mb-3 text-[13px] leading-relaxed text-muted">在网站里找到想要的版本，复制磁力，回到这里粘贴（Ctrl V 或长按粘贴）就会列出来。</p>}
                  <div className="flex flex-wrap gap-2">
                    {browserSites.map(site => (
                      <a key={site.id} className={`btn ${readers.length ? "btn-line" : "btn-primary"} h-10 px-4 ${query.trim() ? "" : "pointer-events-none opacity-45"}`}
                        href={searchURL(site, query)} target="_blank" rel="noreferrer noopener">
                        在 {site.name} 搜「{query.trim() || "…"}」<ArrowSquareOutIcon size={14} />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* The manual way, folded away: paste box, clipboard, bookmarklet. */}
              {enabledSites.length > 0 && (
                <div className="mt-4">
                  <button className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink" onClick={() => setManual(open => !open)} aria-expanded={manual}>
                    <MagnetIcon size={14} />手动粘贴磁力<CaretDownIcon size={11} className={`transition-transform ${manual ? "rotate-180" : ""}`} />
                  </button>
                  {manual && (
                    <div className="mt-2">
                      <textarea className="field font-mono text-[12.5px]" rows={3} value={draft} aria-label="粘贴磁力"
                        onChange={event => { if (takePaste(fromText(event.target.value))) setDraft(""); else setDraft(event.target.value); }}
                        placeholder="magnet:?xt=…（一次可以粘贴很多条，也可以框选网页上的整个列表复制过来）" />
                      <div className="mt-1.5 flex justify-end">
                        <button className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink" onClick={() => void readClipboard()}><ClipboardTextIcon size={14} />读取剪贴板</button>
                      </div>
                      <Bookmarklet />
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="pick" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={spring.snappy}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] text-muted tabular">
                  {picked.year ? `${picked.year} · ` : ""}{picked.kind ? `${picked.kind} · ` : ""}{items.length} 个资源{subject && <span className="text-faint"> · 已对上 TMDB「{subject.title}」</span>}
                </p>
                {items.some(item => item.tags.includes("中字")) && items.some(item => !item.tags.includes("中字")) && (
                  <button className={`shrink-0 rounded-full px-3 py-1 text-[12.5px] transition-colors ${onlySubs ? "bg-accent text-accent-ink" : "text-muted hairline hover:text-ink"}`} onClick={() => setOnlySubs(on => !on)} aria-pressed={onlySubs}>只看中字</button>
                )}
              </div>
              <ul className="mt-2 max-h-[52dvh] overflow-y-auto">
                {shown.map(item => (
                  <SeedRow key={item.hash} item={item} on={ticked.has(item.hash)}
                    onToggle={() => setTicked(current => { const next = new Set(current); if (next.has(item.hash)) next.delete(item.hash); else next.add(item.hash); return next; })} />
                ))}
              </ul>

              <AnimatePresence initial={false}>
                {where && (
                  <motion.div className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.soft}>
                    <div className="mt-3 rounded-[14px] p-3 hairline">
                      <FolderPicker start={base || library.paths[0] || "/"} value={base || "/"} onChange={setBase} />
                      {!library.has(base) && base && <p className="mt-2 text-[12px] text-faint">这个文件夹不在影视库的生效目录里，下载后不会配海报。</p>}
                      <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[13.5px]">
                        <button type="button" role="switch" aria-checked={isCollection} className="switch" onClick={() => setCollection(!isCollection)} aria-label="放进单独的文件夹" />
                        放进单独的文件夹
                      </label>
                      {isCollection && <input className="field mt-2" value={folder} onChange={event => setName(event.target.value)} aria-label="文件夹名" placeholder="比如：潜伏 (2009)" />}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Sheet>
  );
}
