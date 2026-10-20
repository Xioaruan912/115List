import {
  ArrowSquareOutIcon, BookmarkSimpleIcon, CheckIcon, ClipboardTextIcon, DownloadSimpleIcon, FolderSimpleIcon, MagnetIcon, StarIcon, XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import * as fs from "../api/fs";
import { posterSrc, posters, type Poster } from "../api/posters";
import { reachable, resources, searchURL, type ResourceSite, type ResourceTitle } from "../api/resources";
import { useLibraryScope } from "../hooks/useLibraryScope";
import { reason } from "../lib/errors";
import { formatBytes } from "../lib/format";
import { bookmarklet, folderName, fromHTML, fromSeed, fromText, rank, type Magnet } from "../lib/magnets";
import { join } from "../lib/path";
import { markPendingRename } from "../lib/pendingRename";
import { toast } from "../stores/toast";
import { FolderPicker } from "./Dialogs";
import { ErrorState } from "./ErrorState";
import { Sheet } from "./Sheet";

/**
 * 找资源: look a title up on the resource sites set in 设置 › 影视库. The site
 * opens in this browser (it may ask for a human check the server could not
 * pass); the magnets copied there are pasted back here, sorted Chinese
 * subtitles first, ticked, and sent to the 115 offline download of a library
 * folder. Several picked together can go into one collection folder named
 * after the TMDB title, which then offers 按 TMDB 整理命名.
 */

const BASE_KEY = "tgvio-web:resources-folder";

function SiteLink({ site, query }: { site: ResourceSite; query: string }) {
  const probe = useQuery({ queryKey: ["resource-reach", site.id], queryFn: () => reachable(site), staleTime: 5 * 60_000, retry: false });
  const dot = probe.isPending ? "bg-faint" : probe.data ? "bg-accent" : "bg-danger";
  return (
    <a className={`btn btn-line h-10 px-3.5 ${query.trim() ? "" : "pointer-events-none opacity-45"}`} href={searchURL(site, query)} target="_blank" rel="noreferrer noopener"
      title={probe.isPending ? "正在检测" : probe.data ? "这台设备能打开" : "这台设备打不开这个网站"}>
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />在 {site.name} 搜索<ArrowSquareOutIcon size={14} className="text-muted" />
    </a>
  );
}

/**
 * A site the server reads itself (set per site in 设置): its titles for the
 * query, and a title's releases straight into the list below.
 */
function ServerResults({ site, query, onSeeds }: { site: ResourceSite; query: string; onSeeds: (title: ResourceTitle, items: Magnet[]) => void }) {
  const titles = useQuery({ queryKey: ["resource-titles", site.id, query], queryFn: () => resources.titles(site.id, query), enabled: !!query, staleTime: 10 * 60_000, retry: false });
  const [loading, setLoading] = useState("");
  const open = async (title: ResourceTitle): Promise<void> => {
    setLoading(title.id);
    try {
      const { items } = await resources.seeds(site.id, title.id);
      onSeeds(title, items.map(seed => fromSeed(site.id, seed)));
    } catch (error) { toast.error(`没有读到 ${site.name} 的资源`, error); }
    finally { setLoading(""); }
  };
  if (titles.isPending) return <div className="mt-3 flex gap-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-[84px] w-[200px] shrink-0 rounded-[12px]" />)}</div>;
  if (titles.isError) return <ErrorState compact className="mt-3" error={titles.error} onRetry={() => titles.refetch()} />;
  if (!titles.data.items.length) return <p className="mt-3 text-[12.5px] text-muted">{site.name} 上没有找到「{query}」</p>;
  return (
    <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label={`${site.name} 的结果`}>
      {titles.data.items.map(title => (
        <button key={title.id} onClick={() => void open(title)} disabled={!!loading}
          className="flex w-[220px] shrink-0 items-center gap-2.5 rounded-[12px] p-1.5 pr-3 text-left transition-colors hover:bg-[var(--hover)] disabled:opacity-60" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
          <span className="h-[72px] w-12 shrink-0 overflow-hidden rounded-[6px] bg-surface">{title.image && <img src={title.image} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" />}</span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium">{title.title}</span>
            {title.info && <span className="block truncate text-[11.5px] text-faint">{title.info}</span>}
            <span className="flex items-center gap-1.5 text-[11.5px] text-muted tabular">
              {title.year}{title.kind && <span>{title.kind}</span>}
              {title.rating ? <span className="inline-flex items-center gap-0.5"><StarIcon size={10} weight="fill" className="text-accent-text" />{title.rating.toFixed(1)}</span> : null}
            </span>
            {loading === title.id && <span className="text-[11.5px] text-accent-text">读取中…</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** A bookmark that sends a site page's magnets back here. React refuses javascript: links, so the href is set by hand. */
function Bookmarklet() {
  const ref = useRef<HTMLAnchorElement>(null);
  const code = useMemo(() => bookmarklet(location.origin), []);
  useEffect(() => { ref.current?.setAttribute("href", code); }, [code]);
  return (
    <details className="mt-3 rounded-[12px] px-3.5 py-2.5 text-[12.5px] text-muted hairline">
      <summary className="cursor-pointer select-none text-ink">更快：装一个「送回影视库」书签</summary>
      <p className="mt-2 leading-relaxed">在资源站的页面上点这个书签，整页的磁力会直接送回这里，不用一条条复制。</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a ref={ref} className="btn btn-primary h-9 px-3 text-[13px]" onClick={event => event.preventDefault()} draggable>
          <BookmarkSimpleIcon size={15} />送回影视库
        </a>
        <button className="btn btn-line h-9 px-3 text-[13px]" onClick={() => void navigator.clipboard.writeText(decodeURIComponent(code)).then(() => toast.success("书签代码已复制"), () => toast.error("没能复制"))}>
          复制书签代码
        </button>
      </div>
      <p className="mt-2 leading-relaxed">电脑：把绿色按钮拖到书签栏。iPhone、iPad：随便收藏一个网页，编辑这个书签，把网址换成复制的代码。</p>
    </details>
  );
}

function Row({ item, on, onToggle }: { item: Magnet; on: boolean; onToggle: () => void }) {
  return (
    <li>
      <button className={`flex w-full items-start gap-3 rounded-[10px] px-2.5 py-2.5 text-left transition-colors hover:bg-[var(--hover)] ${on ? "bg-accent-soft" : ""}`} onClick={onToggle} aria-pressed={on}>
        <span className={`mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[6px] ${on ? "bg-accent text-accent-ink" : "hairline"}`} style={on ? undefined : { boxShadow: "inset 0 0 0 1.5px var(--line-strong)" }}>
          {on && <CheckIcon size={12} weight="bold" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-all text-[13.5px] leading-snug">{item.title}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            {item.tags.map(tag => (
              <span key={tag} className={`rounded-[6px] px-1.5 py-px text-[11px] ${tag === "中字" ? "bg-accent text-accent-ink" : tag === "合集" ? "text-accent-text hairline" : "text-muted hairline"}`}>{tag}</span>
            ))}
          </span>
        </span>
        <span className="shrink-0 pt-0.5 text-[12px] text-faint tabular">{item.size ? formatBytes(item.size) : ""}</span>
      </button>
    </li>
  );
}

export function ResourceFinder({ initialQuery = "", initialItems, onClose }: { initialQuery?: string; initialItems?: Magnet[]; onClose: () => void }) {
  const library = useLibraryScope();
  const sites = useQuery({ queryKey: ["resources"], queryFn: resources.list, staleTime: 5 * 60_000 });
  const [query, setQuery] = useState(initialQuery);
  const [subject, setSubject] = useState<Poster | null>(null);
  const matches = useQuery({
    queryKey: ["resource-tmdb", query.trim()],
    queryFn: () => posters.search(query.trim()),
    enabled: query.trim().length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const [items, setItems] = useState<Magnet[]>(() => rank(initialItems ?? []));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [onlySubs, setOnlySubs] = useState(false);
  const [base, setBase] = useState(() => localStorage.getItem(BASE_KEY) ?? "");
  const [choosing, setChoosing] = useState(false);
  const [collection, setCollection] = useState(false);
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [lookup, setLookup] = useState<{ site: string; query: string } | null>(null);
  const [series, setSeries] = useState(false);

  // The first library folder until the person picks one.
  useEffect(() => { if (!base && library.paths.length) setBase(library.paths[0]); }, [base, library.paths]);
  useEffect(() => { if (!nameEdited) setName(subject ? folderName(subject.title, subject.year) : folderName(query)); }, [subject, query, nameEdited]);
  // A TV series or a season pack is a collection by nature.
  useEffect(() => { setCollection(picked.size > 1 || subject?.kind === "tv" || series); }, [picked.size, subject, series]);

  const add = (found: Magnet[]): void => {
    if (!found.length) { toast.error("没有找到磁力链接", "复制的内容里要有 magnet:? 开头的链接"); return; }
    const next = rank([...items, ...found]);
    setItems(next);
    // Tick the best one when nothing is ticked yet: Chinese subtitles first.
    setPicked(current => current.size ? current : new Set([next[0].hash]));
    toast.success(`找到 ${found.length} 个磁力`, found.filter(item => item.tags.includes("中字")).length ? "带中文字幕的排在前面" : undefined);
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const found = html ? fromHTML(html) : fromText(text);
    event.preventDefault();
    add(found.length ? found : fromText(text));
  };
  const readClipboard = async (): Promise<void> => {
    try { add(fromText(await navigator.clipboard.readText())); }
    catch { toast.error("读不到剪贴板", "在下面的框里长按粘贴也可以"); }
  };

  const shown = onlySubs ? items.filter(item => item.tags.includes("中字")) : items;
  const chosen = items.filter(item => picked.has(item.hash));
  const target = collection && name.trim() ? join(base, name.trim()) : base;

  const submit = async (): Promise<void> => {
    if (!chosen.length || !base) return;
    setBusy(true);
    try {
      if (collection && name.trim()) {
        await fs.mkdir(target).catch((error: unknown) => { if (!/exist/i.test(reason(error))) throw error; });
        if (subject) await posters.set(name.trim(), { kind: subject.kind, id: subject.id }).catch(() => undefined);
      }
      // Seeds read by the server get their magnets now, only for what was picked.
      const urls: string[] = chosen.filter(item => item.url).map(item => item.url);
      const bySite = new Map<string, string[]>();
      for (const item of chosen) if (item.seed) bySite.set(item.seed.site, [...(bySite.get(item.seed.site) ?? []), item.seed.id]);
      let failed = 0;
      for (const [site, seeds] of bySite) {
        const { items: found } = await resources.magnets(site, seeds);
        for (const one of found) { if (one.url) urls.push(one.url); else failed++; }
      }
      if (!urls.length) throw new Error("没能取到磁力链接，换一个资源试试");
      const tools = await fs.offlineTools(target);
      const tool = tools.find(item => fs.nativeOfflineTools.includes(item)) ?? tools[0];
      if (!tool) throw new Error("这个文件夹所在的网盘不支持离线下载");
      await fs.offlineDownload(target, urls, tool, "delete_on_upload_succeed");
      try { localStorage.setItem(BASE_KEY, base); } catch { /* ignore */ }
      if (collection && name.trim()) markPendingRename(target);
      if (failed) toast.error(`${failed} 个资源没取到磁力`, "其余的已经开始下载");
      toast.success(`已添加 ${urls.length} 个离线任务`, collection ? `下载好后打开「${name.trim()}」，可以一键按 TMDB 整理命名` : `保存到 ${target}`);
      onClose();
    } catch (error) {
      toast.error("没有添加成功", error);
    } finally {
      setBusy(false);
    }
  };

  const enabledSites = sites.data?.sites ?? [];
  return (
    <Sheet open onClose={onClose} width={720} title="找资源"
      footer={<>
        <p className="mr-auto min-w-0 truncate text-[12.5px] text-faint" title={target}>{chosen.length ? `保存到 ${target || "（先选文件夹）"}` : "勾选要下载的磁力"}</p>
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={!chosen.length || !base || busy} onClick={() => void submit()}>
          <DownloadSimpleIcon size={16} />{busy ? "添加中…" : chosen.length ? `下载 ${chosen.length} 个` : "下载"}
        </button>
      </>}>
      {/* 1. What to look for */}
      <label className="label" htmlFor="resource-q">片名</label>
      <input id="resource-q" className="field" value={query} onChange={event => { setQuery(event.target.value); setSubject(null); }} placeholder="比如：潜伏" autoFocus={!initialItems?.length} />
      {matches.data && matches.data.results.length > 0 && (
        <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label="TMDB 匹配">
          {matches.data.results.slice(0, 8).map(result => {
            const on = subject?.id === result.id && subject.kind === result.kind;
            return (
              <button key={`${result.kind}-${result.id}`} onClick={() => setSubject(on ? null : result)} aria-pressed={on}
                className={`flex w-[220px] shrink-0 items-center gap-2.5 rounded-[12px] p-1.5 pr-3 text-left transition-colors ${on ? "bg-accent-soft" : "hover:bg-[var(--hover)]"}`}
                style={{ boxShadow: on ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 1px var(--line)" }}>
                <span className="h-[54px] w-9 shrink-0 overflow-hidden rounded-[6px] bg-surface">{result.poster && <img src={posterSrc(result.poster, "w185")} alt="" className="size-full object-cover" />}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{result.title}</span>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-muted tabular">
                    {result.year}<span>{result.kind === "tv" ? "剧集" : "电影"}</span>
                    {result.rating ? <span className="inline-flex items-center gap-0.5"><StarIcon size={10} weight="fill" className="text-accent-text" />{result.rating.toFixed(1)}</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 2. Look it up on the sites, in this browser */}
      <div className="mt-4 flex flex-wrap gap-2">
        {enabledSites.map(site => <SiteLink key={site.id} site={site} query={subject?.title ?? query} />)}
        {enabledSites.filter(site => site.reader).map(site => (
          <button key={`read-${site.id}`} className="btn btn-primary h-10 px-3.5" disabled={!(subject?.title ?? query).trim()}
            onClick={() => setLookup({ site: site.id, query: (subject?.title ?? query).trim() })}>
            <MagnetIcon size={15} />直接列出 {site.name} 的资源
          </button>
        ))}
        {sites.data && !enabledSites.length && <p className="text-[12.5px] text-muted">还没有可用的资源站，请管理员在 设置 › 影视库 › 资源搜索 里添加。</p>}
      </div>
      {lookup && enabledSites.find(site => site.id === lookup.site) && (
        <ServerResults site={enabledSites.find(site => site.id === lookup.site)!} query={lookup.query}
          onSeeds={(title, found) => {
            if (!found.length) { toast.error(`「${title.title}」还没有磁力资源`); return; }
            const tv = /剧|动漫|综艺/.test(title.kind ?? "");
            setSeries(tv);
            // The TMDB entry of the same name and year (±1: sites and TMDB disagree on first airing).
            const match = !subject && matches.data?.results.find(result => result.title === title.title && (result.kind === "tv") === tv && (!title.year || !result.year || Math.abs(result.year - title.year) <= 1));
            if (match) setSubject(match);
            else if (!nameEdited && !subject) setName(folderName(title.title, title.year));
            add(found);
          }} />
      )}
      <Bookmarklet />

      {/* 3. Paste the magnets back */}
      <div className="mt-5 flex items-center justify-between gap-3">
        <label className="label mb-0" htmlFor="resource-paste">把复制的磁力粘贴到这里</label>
        <button className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink" onClick={() => void readClipboard()}><ClipboardTextIcon size={14} />读取剪贴板</button>
      </div>
      <textarea id="resource-paste" className="field mt-1.5 font-mono text-[12.5px]" rows={2} onPaste={onPaste} value={draft}
        onChange={event => {
          const found = fromText(event.target.value);
          if (found.length) { add(found); setDraft(""); } else setDraft(event.target.value);
        }}
        placeholder="可以直接框选网页上的整个列表复制过来，也可以一条条粘贴 magnet:?xt=…" />

      {items.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted tabular">{items.length} 个磁力，已选 {chosen.length}</p>
            <div className="flex items-center gap-3 text-[12.5px]">
              <button className={onlySubs ? "text-accent-text" : "text-muted hover:text-ink"} onClick={() => setOnlySubs(on => !on)} aria-pressed={onlySubs}>只看中字</button>
              <button className="text-muted hover:text-ink" onClick={() => setPicked(new Set(shown.map(item => item.hash)))}>全选</button>
              <button className="text-muted hover:text-ink" onClick={() => setPicked(new Set())}>不选</button>
              <button className="inline-flex items-center gap-0.5 text-muted hover:text-danger" onClick={() => { setItems([]); setPicked(new Set()); }}><XIcon size={12} />清空</button>
            </div>
          </div>
          <ul className="mt-1.5 max-h-[38dvh] overflow-y-auto">
            {shown.map(item => (
              <Row key={item.hash} item={item} on={picked.has(item.hash)}
                onToggle={() => setPicked(current => { const next = new Set(current); if (next.has(item.hash)) next.delete(item.hash); else next.add(item.hash); return next; })} />
            ))}
            {!shown.length && <li className="py-6 text-center text-[13px] text-muted">没有带中文字幕的，关掉「只看中字」看看全部</li>}
          </ul>
        </div>
      )}

      {/* 4. Where it goes */}
      {chosen.length > 0 && (
        <div className="mt-4 rounded-[14px] p-3.5 hairline">
          <div className="flex items-center gap-2.5">
            <FolderSimpleIcon size={18} weight="duotone" className="shrink-0 text-accent-text" />
            <span className="min-w-0 flex-1 truncate text-[13.5px]" title={base}>{base || "选一个文件夹"}</span>
            <button className="btn btn-line h-8 px-3 text-[12.5px]" onClick={() => setChoosing(open => !open)}>{choosing ? "收起" : "更改"}</button>
          </div>
          {choosing && <div className="mt-3"><FolderPicker start={base || library.paths[0] || "/"} value={base || "/"} onChange={setBase} /></div>}
          {!library.has(base) && base && <p className="mt-2 text-[12px] text-faint">这个文件夹不在影视库的生效目录里，下载后不会配海报，也不能按 TMDB 整理命名。</p>}
          <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[13.5px]">
            <button type="button" role="switch" aria-checked={collection} className="switch" onClick={() => setCollection(on => !on)} aria-label="建为合集" />
            建为合集文件夹
            <span className="text-[12px] text-faint">{picked.size > 1 ? "选了多个，放进同一个文件夹" : "剧集放进自己的文件夹"}</span>
          </label>
          {collection && (
            <input className="field mt-2" value={name} onChange={event => { setName(event.target.value); setNameEdited(true); }} aria-label="合集文件夹名"
              placeholder="合集文件夹名，比如：潜伏 (2009)" />
          )}
          {collection && subject && <p className="mt-2 text-[12px] text-muted">文件夹会直接配上「{subject.title}」的 TMDB 信息，下载好后打开它就能一键整理命名。</p>}
        </div>
      )}
      {!items.length && (
        <p className="mt-4 flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
          <MagnetIcon size={15} className="mt-0.5 shrink-0" />
          资源站在你的浏览器里打开，可能先要过一个人机验证。找到想要的版本后复制磁力，回到这里粘贴。带中文字幕的会排在最前面。
        </p>
      )}
    </Sheet>
  );
}
