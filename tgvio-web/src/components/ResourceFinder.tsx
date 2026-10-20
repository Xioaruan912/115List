import {
  ArrowSquareOutIcon, BookmarkSimpleIcon, CaretDownIcon, CaretLeftIcon, CheckIcon, ClipboardTextIcon, DownloadSimpleIcon, FolderSimpleIcon, MagnetIcon, StarIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import * as fs from "../api/fs";
import { posters, type Poster } from "../api/posters";
import { resources, searchURL, type ResourceSite, type ResourceTitle } from "../api/resources";
import { useLibraryScope } from "../hooks/useLibraryScope";
import { reason } from "../lib/errors";
import { formatBytes } from "../lib/format";
import { bookmarklet, folderName, fromHTML, fromSeed, fromText, rank, seriesName, type Magnet } from "../lib/magnets";
import { spring } from "../lib/motion";
import { join } from "../lib/path";
import { markPendingRename } from "../lib/pendingRename";
import { toast } from "../stores/toast";
import { FolderPicker } from "./Dialogs";
import { ErrorState } from "./ErrorState";
import { Sheet } from "./Sheet";

/**
 * 找资源, in two steps that follow on by themselves:
 *
 *   1. 搜：typing searches the sites the server reads (SeedHub) and lists
 *      their titles. Tap a title to see its releases, or tick several
 *      (潜伏, 潜伏2, 潜伏3) and look at them together. A site that only opens
 *      in the browser gets one button; magnets copied there can be pasted
 *      anywhere in this sheet.
 *   2. 选：the releases, one group per title, Chinese subtitles first and the
 *      best one of each already ticked; the folder is already chosen. 下载
 *      sends them to the drive's offline download.
 *
 * Downloads go to the default folder of 设置 › 影视库 › 资源搜索, each title
 * in a folder named the TMDB way ("我要看/瘴气营地的青春性事与死亡 (2026)"); several
 * titles go into a series folder with a folder per title inside
 * ("潜伏 系列/潜伏2"). TMDB is matched behind
 * the scenes for each title, so the folders get posters and 按 TMDB 整理命名
 * works once the files arrive.
 */

const PASTED = "粘贴的磁力";

/**
 * The TMDB entry of a site's title, scored: same name, the site's other name
 * matching TMDB's original title ("Insidious"), the same year (sites and TMDB
 * may differ by one on first airing), film or series. Nothing close: none.
 */
async function matchTMDB(title: string, year: number | undefined, tv: boolean | undefined, other = ""): Promise<Poster | null> {
  if (!title) return null;
  const norm = (text = "") => text.toLowerCase().replace(/[\s:：·.,!?'"-]+/g, "");
  try {
    const { results } = await posters.search(title);
    let best: Poster | null = null;
    let top = 0;
    for (const r of results) {
      if (tv !== undefined && (r.kind === "tv") !== tv) continue;
      if (year && r.year && Math.abs(r.year - year) > 1) continue;
      let score = 1;
      if (norm(r.title) === norm(title) || norm(r.original) === norm(title)) score += 2;
      if (other && r.original && norm(r.original) === norm(other)) score += 4;
      if (year && r.year === year) score += 3;
      if (score > top) { top = score; best = r; }
    }
    return best;
  } catch { return null; }
}

/** A readable title out of a release name: "潜伏.2009.1080p…" → "潜伏", "[字幕组] 名字 - 01 …" → "名字". */
function plainTitle(release: string): string {
  const cut = release.replace(/^\s*(\[[^\]]*\]\s*)+/, "").split(/[.\[(【_]|\s-\s|\s(?=S\d|\d{4}\b)/)[0].trim();
  return (cut || release).slice(0, 60);
}

/** A title and its releases, as shown in step 2. */
type Group = { key: string; title: string; other?: string; year?: number; kind?: string; tv?: boolean; items: Magnet[]; subject?: Poster | null };

function groupOf(title: ResourceTitle | null, items: Magnet[], fallback = PASTED): Group {
  return title
    ? { key: title.id, title: title.title, other: title.info, year: title.year, kind: title.kind, tv: /剧|动漫|综艺/.test(title.kind ?? ""), items: rank(items) }
    : { key: PASTED, title: fallback, items: rank(items) };
}

function TitleRow({ title, on, busy, onToggle, onOpen }: { title: ResourceTitle; on: boolean; busy: boolean; onToggle: () => void; onOpen: () => void }) {
  return (
    <li className={`flex items-center rounded-[12px] transition-colors ${on ? "bg-accent-soft" : "hover:bg-[var(--hover)]"}`}>
      <button className="grid size-12 shrink-0 place-items-center" onClick={onToggle} aria-pressed={on} aria-label={`选择 ${title.title}`}>
        <span className={`grid size-5 place-items-center rounded-[6px] ${on ? "bg-accent text-accent-ink" : ""}`} style={on ? undefined : { boxShadow: "inset 0 0 0 1.5px var(--line-strong)" }}>
          {on && <CheckIcon size={13} weight="bold" />}
        </span>
      </button>
      <button onClick={onOpen} disabled={busy} className="flex min-w-0 flex-1 items-center gap-3 py-2 pr-2 text-left disabled:opacity-60">
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
function SiteTitles({ site, query, opening, ticked, onToggle, onOpen, onTitles }: {
  site: ResourceSite; query: string; opening: string[]; ticked: Map<string, ResourceTitle>;
  onToggle: (title: ResourceTitle) => void; onOpen: (title: ResourceTitle) => void; onTitles: (titles: ResourceTitle[]) => void;
}) {
  const titles = useQuery({ queryKey: ["resource-titles", site.id, query], queryFn: () => resources.titles(site.id, query), enabled: !!query, staleTime: 10 * 60_000, retry: false });
  useEffect(() => { if (titles.data) onTitles(titles.data.items); }, [titles.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!query) return null;
  if (titles.isPending) return <ul className="mt-3 space-y-1">{Array.from({ length: 3 }, (_, i) => <li key={i} className="skeleton h-[88px] rounded-[12px]" style={{ opacity: 1 - i * 0.2 }} />)}</ul>;
  if (titles.isError) return <ErrorState compact className="mt-3" error={titles.error} onRetry={() => titles.refetch()} />;
  if (!titles.data.items.length) return <p className="mt-6 text-center text-[13px] text-muted">{site.name} 上没有「{query}」，换个叫法试试</p>;
  return (
    <ul className="mt-2 space-y-0.5">
      {titles.data.items.map(title => (
        <TitleRow key={title.id} title={title} on={ticked.has(`${site.id}:${title.id}`)} busy={opening.includes(`${site.id}:${title.id}`)}
          onToggle={() => onToggle(title)} onOpen={() => onOpen(title)} />
      ))}
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

export function ResourceFinder({ initialQuery = "", initialItems, onClose }: { initialQuery?: string; initialItems?: Magnet[]; onClose: () => void }) {
  const library = useLibraryScope();
  const sites = useQuery({ queryKey: ["resources"], queryFn: resources.list, staleTime: 5 * 60_000 });
  const [query, setQuery] = useState(initialQuery);
  // Search once typing settles, not on every key.
  const [searched, setSearched] = useState(initialQuery.trim());
  useEffect(() => { const timer = window.setTimeout(() => setSearched(query.trim()), 450); return () => clearTimeout(timer); }, [query]);

  // Step 1: titles ticked for looking at together ("site:id" → title).
  const [chosenTitles, setChosenTitles] = useState<Map<string, ResourceTitle>>(new Map());
  const [listed, setListed] = useState<ResourceTitle[]>([]);
  const [opening, setOpening] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState("");

  // Step 2: the groups and the ticked releases (keys are unique across groups).
  const [groups, setGroups] = useState<Group[] | null>(() => initialItems?.length ? [groupOf(null, initialItems)] : null);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(initialItems?.length ? [rank(initialItems)[0].hash] : []));
  const [onlySubs, setOnlySubs] = useState(false);
  // Long lists show their best few until opened (74 releases of one film would bury the next one).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Where it goes: the default folder from 设置 (else the first library folder); changeable per download.
  const [base, setBase] = useState("");
  const defaultBase = sites.data?.folder || library.paths[0] || "";
  useEffect(() => { if (!base && defaultBase) setBase(defaultBase); }, [base, defaultBase]);
  const [where, setWhere] = useState(false);
  const [ownFolder, setOwnFolder] = useState<boolean | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enabledSites = sites.data?.sites ?? [];
  const readers = enabledSites.filter(site => site.reader);
  const browserSites = enabledSites.filter(site => !site.reader);

  /** Show step 2 for these groups: the best of each ticked, TMDB matched in the background. */
  const show = (next: Group[]): void => {
    setGroups(next);
    setTicked(new Set(next.flatMap(group => group.items.length ? [group.items[0].hash] : [])));
    setOnlySubs(false);
    setOwnFolder(null);
    setName(null);
    for (const group of next) {
      void matchTMDB(group.title === PASTED ? query.trim() : group.title, group.year, group.tv, group.other).then(subject =>
        setGroups(current => current?.map(g => g.key === group.key ? { ...g, subject } : g) ?? current));
    }
  };

  /** Read the releases of one or more titles of a site, all at once. */
  const openTitles = async (site: ResourceSite, titles: ResourceTitle[]): Promise<void> => {
    setOpening(titles.map(title => `${site.id}:${title.id}`));
    try {
      const results = await Promise.all(titles.map(async title => {
        try { return groupOf(title, (await resources.seeds(site.id, title.id)).items.map(seed => fromSeed(site.id, seed))); }
        catch (error) { toast.error(`没有读到「${title.title}」的资源`, error); return null; }
      }));
      const found = results.filter((group): group is Group => !!group && group.items.length > 0);
      const empty = results.filter(group => group && !group.items.length).map(group => group!.title);
      if (empty.length) toast.error(`${empty.map(title => `「${title}」`).join("")}暂时没有磁力资源`);
      if (found.length) show(found);
    } finally { setOpening([]); }
  };

  const toggleTitle = (site: ResourceSite, title: ResourceTitle): void => setChosenTitles(current => {
    const next = new Map(current);
    const key = `${site.id}:${title.id}`;
    if (next.has(key)) next.delete(key); else next.set(key, title);
    return next;
  });

  // Magnets pasted anywhere in the sheet go straight to step 2 (or join the pasted group there).
  const takePaste = (found: Magnet[]): boolean => {
    if (!found.length) return false;
    if (groups) {
      const pasted = groups.find(group => group.key === PASTED);
      const merged = rank([...(pasted?.items ?? []), ...found]);
      setGroups(pasted ? groups.map(group => group === pasted ? { ...group, items: merged } : group) : [...groups, groupOf(null, found, query.trim() || PASTED)]);
      setTicked(current => current.size ? current : new Set([merged[0].hash]));
    } else {
      show([groupOf(null, found, query.trim() || PASTED)]);
    }
    toast.success(`收到 ${found.length} 个磁力`, found.some(item => item.tags.includes("中字")) ? "带中文字幕的排在前面" : undefined);
    return true;
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const html = event.clipboardData.getData("text/html");
    const found = html ? fromHTML(html) : [];
    if (takePaste(found.length ? found : fromText(event.clipboardData.getData("text/plain")))) event.preventDefault();
  };
  const readClipboard = async (): Promise<void> => {
    try { if (!takePaste(fromText(await navigator.clipboard.readText()))) toast.error("剪贴板里没有磁力链接"); }
    catch { toast.error("读不到剪贴板", "在下面的框里粘贴也可以"); }
  };

  // Where each ticked group goes.
  const active = (groups ?? []).map(group => ({ group, chosen: group.items.filter(item => ticked.has(item.hash)) })).filter(entry => entry.chosen.length);
  const total = active.reduce((sum, entry) => sum + entry.chosen.length, 0);
  const several = active.length > 1;
  /** A title's folder, named the TMDB way: "瘴气营地的青春性事与死亡 (2026)" (TMDB's title and year when matched, else the site's). */
  const titleOf = (group: Group): string => group.subject?.title
    ?? (group.title === PASTED ? query.trim() || plainTitle(group.items.find(item => ticked.has(item.hash))?.title ?? group.items[0]?.title ?? "") : group.title);
  const nameOf = (group: Group): string => folderName(titleOf(group), group.subject ? group.subject.year : group.year);
  const one = active[0]?.group;
  // Every download gets a folder named after the title, inside the default folder.
  const wantsFolder = ownFolder ?? true;
  const folder = (name ?? (several ? seriesName(active.map(entry => entry.group.subject?.title ?? entry.group.title)) : one ? nameOf(one) : "")).trim();
  const parentDir = wantsFolder && folder ? join(base, folder) : base;
  /** Each group's folder: inside the series folder when there are several, else the one folder. */
  const targetOf = (group: Group): string => several ? join(parentDir, nameOf(group)) : parentDir;

  const submit = async (): Promise<void> => {
    if (!total || !base) return;
    setBusy(true);
    let sent = 0;
    let failed = 0;
    try {
      if (parentDir !== base) await fs.mkdir(parentDir).catch((error: unknown) => { if (!/exist/i.test(reason(error))) throw error; });
      for (const { group, chosen } of active) {
        // Seeds read by the server get their magnets now, only for what was ticked.
        const urls = chosen.filter(item => item.url).map(item => item.url);
        const bySite = new Map<string, string[]>();
        for (const item of chosen) if (item.seed) bySite.set(item.seed.site, [...(bySite.get(item.seed.site) ?? []), item.seed.id]);
        for (const [site, seeds] of bySite) {
          const { items: found } = await resources.magnets(site, seeds);
          for (const found1 of found) { if (found1.url) urls.push(found1.url); else failed++; }
        }
        if (!urls.length) continue;
        const target = targetOf(group);
        if (target !== parentDir) await fs.mkdir(target).catch((error: unknown) => { if (!/exist/i.test(reason(error))) throw error; });
        const own = target === base ? null : target.slice(target.lastIndexOf("/") + 1);
        if (own && group.subject) await posters.set(own, { kind: group.subject.kind, id: group.subject.id }).catch(() => undefined);
        const tools = await fs.offlineTools(target);
        const tool = tools.find(item => fs.nativeOfflineTools.includes(item)) ?? tools[0];
        if (!tool) throw new Error("这个文件夹所在的网盘不支持离线下载");
        await fs.offlineDownload(target, urls, tool, "delete_on_upload_succeed");
        if (own) markPendingRename(target);
        sent += urls.length;
      }
      if (!sent) throw new Error("没能取到磁力链接，换一个资源试试");
      if (failed) toast.error(`${failed} 个资源没取到磁力`, "其余的已经开始下载");
      toast.success(`已开始下载 ${sent} 个`, wantsFolder && folder ? `保存在「${folder}」，下好后打开可以一键整理命名` : `保存到 ${base}`);
      onClose();
    } catch (error) {
      toast.error(sent ? `已开始 ${sent} 个，其余没有添加成功` : "没有添加成功", error);
    } finally {
      setBusy(false);
    }
  };

  const toggleSeed = (hash: string): void => setTicked(current => { const next = new Set(current); if (next.has(hash)) next.delete(hash); else next.add(hash); return next; });
  const hasSubs = (groups ?? []).some(group => group.items.some(item => item.tags.includes("中字")));
  const hasOthers = (groups ?? []).some(group => group.items.some(item => !item.tags.includes("中字")));
  const step2 = !!groups;
  const ticks = [...chosenTitles.entries()];
  const shortPath = (path: string) => path.split("/").filter(Boolean).slice(-2).join(" / ") || "/";

  return (
    <Sheet open onClose={onClose} width={680}
      title={step2
        ? <button className="-ml-1.5 inline-flex items-center gap-1 rounded-[8px] py-0.5 pl-1 pr-2 hover:bg-[var(--hover)]" onClick={() => setGroups(null)} aria-label="返回搜索">
            <CaretLeftIcon size={16} className="shrink-0" /><span className="max-w-[50vw] truncate sm:max-w-[420px]">{groups.length > 1 ? `一起看 ${groups.length} 部` : groups[0].title}</span>
          </button>
        : "找资源"}
      footer={step2 ? <>
        <button className="mr-auto flex min-w-0 items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13px] hover:bg-[var(--hover)]" onClick={() => setWhere(open => !open)} aria-expanded={where} title={parentDir}>
          <FolderSimpleIcon size={17} weight="duotone" className="shrink-0 text-accent-text" />
          <span className="min-w-0 truncate"><span className="text-faint">保存到 </span>{parentDir ? shortPath(parentDir) : "（选个文件夹）"}</span>
          <CaretDownIcon size={12} className={`shrink-0 text-faint transition-transform ${where ? "rotate-180" : ""}`} />
        </button>
        <button className="btn btn-primary" disabled={!total || !base || busy} onClick={() => void submit()}>
          <DownloadSimpleIcon size={16} />{busy ? "添加中…" : total > 1 ? `下载 ${total} 个` : "下载"}
        </button>
      </> : ticks.length ? <>
        <p className="mr-auto min-w-0 truncate text-[13px] text-muted">已选 {ticks.length} 部：{ticks.map(([, title]) => title.title).join("、")}</p>
        <button className="btn btn-ghost" onClick={() => setChosenTitles(new Map())}>不选了</button>
        <button className="btn btn-primary" disabled={opening.length > 0} onClick={() => {
          // Ticked titles come from the reader sites; group them per site.
          for (const site of readers) {
            const titles = ticks.filter(([key]) => key.startsWith(`${site.id}:`)).map(([, title]) => title);
            if (titles.length) void openTitles(site, titles);
          }
        }}>{opening.length ? "读取中…" : `一起看 ${ticks.length} 部的资源`}</button>
      </> : undefined}>
      <div onPaste={onPaste}>
        <AnimatePresence mode="popLayout" initial={false}>
          {!step2 ? (
            <motion.div key="search" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={spring.snappy}>
              <input id="resource-q" className="field h-12 text-[16px]" value={query} onChange={event => setQuery(event.target.value)} placeholder="片名，比如：潜伏" autoFocus aria-label="片名"
                onKeyDown={event => { if (event.key === "Enter") setSearched(query.trim()); }} />

              {readers.map(site => (
                <SiteTitles key={site.id} site={site} query={searched} opening={opening} ticked={chosenTitles}
                  onToggle={title => toggleTitle(site, title)}
                  onOpen={title => void openTitles(site, [title])}
                  onTitles={titles => setListed(titles)} />
              ))}
              {readers.length > 0 && listed.length > 1 && !ticks.length && (
                <p className="mt-2 text-center text-[12px] text-faint">勾选左边的方框可以一次选好几部，比如一整个系列</p>
              )}

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
              {hasSubs && hasOthers && (
                <div className="mb-1 flex justify-end">
                  <button className={`rounded-full px-3 py-1 text-[12.5px] transition-colors ${onlySubs ? "bg-accent text-accent-ink" : "text-muted hairline hover:text-ink"}`} onClick={() => setOnlySubs(on => !on)} aria-pressed={onlySubs}>只看中字</button>
                </div>
              )}
              <div className="max-h-[56dvh] space-y-4 overflow-y-auto">
                {groups.map(group => {
                  const all = onlySubs ? group.items.filter(item => item.tags.includes("中字")) : group.items;
                  const limit = groups.length > 1 ? 5 : 12;
                  const open = expanded.has(group.key) || all.length <= limit + 2;
                  // The ticked ones always show, even beyond the first few.
                  const shown = open ? all : all.filter((item, index) => index < limit || ticked.has(item.hash));
                  return (
                    <section key={group.key} aria-label={group.title}>
                      <p className="sticky top-0 z-[1] bg-raised px-1 py-1.5 text-[13px] text-muted tabular">
                        {groups.length > 1 && <span className="mr-2 text-[14px] font-medium text-ink">{group.title}</span>}
                        {group.year ? `${group.year} · ` : ""}{group.kind ? `${group.kind} · ` : ""}{group.items.length} 个资源
                        {group.subject && <span className="text-faint"> · 已对上 TMDB「{group.subject.title}」</span>}
                      </p>
                      <ul>
                        {shown.map(item => <SeedRow key={item.hash} item={item} on={ticked.has(item.hash)} onToggle={() => toggleSeed(item.hash)} />)}
                        {!shown.length && <li className="px-3 py-3 text-[12.5px] text-faint">没有带中文字幕的</li>}
                      </ul>
                      {!open && (
                        <button className="ml-3 mt-1 text-[12.5px] text-accent-text hover:underline" onClick={() => setExpanded(current => new Set(current).add(group.key))}>
                          展开全部 {all.length} 个
                        </button>
                      )}
                    </section>
                  );
                })}
              </div>

              <AnimatePresence initial={false}>
                {where && (
                  <motion.div className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.soft}>
                    <div className="mt-3 rounded-[14px] p-3 hairline">
                      <FolderPicker start={base || library.paths[0] || "/"} value={base || "/"} onChange={setBase} />
                      {!library.has(base) && base && <p className="mt-2 text-[12px] text-faint">这个文件夹不在影视库的生效目录里，下载后不会配海报。</p>}
                      <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[13.5px]">
                        <button type="button" role="switch" aria-checked={wantsFolder} className="switch" onClick={() => setOwnFolder(!wantsFolder)} aria-label={several ? "放进系列文件夹" : "放进单独的文件夹"} />
                        {several ? "放进一个系列文件夹" : "放进单独的文件夹"}
                      </label>
                      {wantsFolder && <input className="field mt-2" value={folder} onChange={event => setName(event.target.value)} aria-label="文件夹名" placeholder="比如：潜伏 (2009)" />}
                      {several && (
                        <p className="mt-2 text-[12px] leading-relaxed text-faint">
                          每部片放在自己的子文件夹里：{active.map(entry => nameOf(entry.group)).join("、")}
                        </p>
                      )}
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
