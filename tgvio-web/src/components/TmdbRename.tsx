import { CheckIcon, FileIcon, FilmSlateIcon, SealCheckIcon, SubtitlesIcon, FolderSimpleIcon, FilmStripIcon, WarningIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { posters, posterSrc } from "../api/posters";
import { doable, tmdbRename, type RenameInherit, type RenameItem, type RenamePlan } from "../api/rename";
import { passwordFor } from "../hooks/useDir";
import * as actions from "../lib/actions";
import { queryClient } from "../lib/query";
import { reason } from "../lib/errors";
import { formatBytes } from "../lib/format";
import { spring } from "../lib/motion";
import { basename, encodePath, join, parent } from "../lib/path";
import { toast, useToasts } from "../stores/toast";
import { useUi } from "../stores/ui";
import { ErrorState } from "./ErrorState";
import { Sheet } from "./Sheet";
import { organize } from "../api/organize";

/**
 * Rename a folder's videos after TMDB. The plan arrives as a departures board:
 * each row shows the name on the drive and the name it would get. People keep
 * or drop rows; applying renames one row at a time and each new name flips into
 * place as the drive confirms it. Nothing changes before "整理". Several folders
 * (a multi-selection) are planned one after another, each under its own poster.
 * A folder brings its subfolders along (a series' seasons, a "Subs" folder):
 * they are planned after it and, when they name nothing themselves, after it.
 * A season nothing pins down waits for the person to pick it.
 */
const WHY: Record<NonNullable<RenameItem["reason"]>, string> = {
  same: "已经是规整的名字",
  "no-episode": "认不出是第几集",
  several: "文件夹里有好几部，分不清",
  conflict: "会和别的文件重名",
  unknown: "TMDB 上没认出来",
  "pick-season": "先在上面选是第几季",
  inner: "子文件夹，名字保留",
  version: "同一部有好几个文件：最大的用标准名，其余加上版本，确认后勾上",
  spill: "要拆开的话勾上",
};

type RowState = { status: "busy" } | { status: "done" } | { status: "error"; message: string };

/** Puts a 整理 run back and reloads what it touched. */
export async function undoRun(id: string): Promise<void> {
  try {
    const { changes } = await tmdbRename.undo(id);
    toast.success("已撤销", `改回了 ${changes} 项`);
  } catch (error) {
    toast.error("没能全部撤销", error);
  }
  void queryClient.invalidateQueries();
}

/** A folder to plan; `only` limits it to chosen files (and their subtitles), leaving the folder's name alone. */
export interface RenameTarget { path: string; only?: string[] }

/** A folder of the sheet: a target, or a subfolder found below one (depth > 0). */
interface Entry extends RenameTarget { depth: number }

type Loaded = { status: "loading" } | { status: "ok"; plan: RenamePlan } | { status: "error"; error: unknown };

const rowKey = (path: string, name: string): string => `${path}\n${name}`;

/** The rows of one plan this sheet shows: chosen files and the subtitles that follow them. */
function filesOf(plan: RenamePlan, only?: string[]): RenameItem[] {
  const files = plan.items.filter(item => item.kind !== "folder");
  if (!only) return files;
  const picked = new Set(only);
  const bases = only.map(name => name.replace(/\.[^.]+$/, "") + ".");
  return files.filter(item => picked.has(item.old) || (item.kind === "subtitle" && bases.some(base => item.old.startsWith(base))));
}

/** The nearest folder above `path` in the sheet that found a film or series. */
function inheritFor(path: string, list: Entry[], plans: Record<string, Loaded>): RenameInherit | undefined {
  let best: { at: string; plan: RenamePlan } | undefined;
  for (const entry of list) {
    const state = plans[entry.path];
    if (entry.only || !path.startsWith(entry.path + "/") || state?.status !== "ok") continue;
    if (!state.plan.subject || state.plan.reason) continue;
    if (!best || entry.path.length > best.at.length) best = { at: entry.path, plan: state.plan };
  }
  return best?.plan.subject ? { kind: best.plan.subject.kind, id: best.plan.subject.id, season: best.plan.season || undefined, film: best.plan.film || undefined } : undefined;
}

export function TmdbRename({ targets: chosen, onClose }: { targets: RenameTarget[]; onClose: () => void }) {
  const client = useQueryClient();
  const [location, navigate] = useLocation();
  const [targets, setTargets] = useState<Entry[]>([]);
  const [expanding, setExpanding] = useState(true);
  const [loaded, setLoadedState] = useState<Record<string, Loaded>>({});
  const plansRef = useRef<Record<string, Loaded>>({});
  const setLoaded = useCallback((update: (prev: Record<string, Loaded>) => Record<string, Loaded>): void => {
    plansRef.current = update(plansRef.current);
    setLoadedState(plansRef.current);
  }, []);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const multi = targets.length > 1 || chosen.length > 1;
  const folderCount = targets.filter(target => !target.only).length;
  const fileCount = targets.reduce((sum, target) => sum + (target.only?.length ?? 0), 0);
  const title = !multi && folderCount ? "整理"
    : `整理${[folderCount ? ` ${folderCount} 个文件夹` : "", fileCount ? ` ${fileCount} 个文件` : ""].filter(Boolean).join(" 和")}`;

  // Plans load one folder after another, parents before their subfolders:
  // TMDB is asked a few times per folder, and a subfolder goes by its parent.
  const load = useCallback(async (list: Entry[], all: Entry[], alive: () => boolean, season?: number): Promise<void> => {
    // Folders the planner finds nothing to do in ("这里的名字已经很规整了": a folder of several films keeps
    // its name) count as organized, so 整理模式 stops showing them. The planner has read them already.
    const tidy: string[] = [];
    for (const target of list) {
      if (!alive()) return;
      setLoaded(prev => ({ ...prev, [target.path]: { status: "loading" } }));
      try {
        const inherit = target.depth > 0 ? inheritFor(target.path, all, plansRef.current) : undefined;
        const plan = await tmdbRename.plan(target.path, passwordFor(target.path), target.only, season, inherit);
        if (alive()) {
          setLoaded(prev => ({ ...prev, [target.path]: { status: "ok", plan } }));
          // Versions of one episode wait for the person: they come unticked.
          const versions = plan.items.filter(item => (item.reason === "version" && item.new) || item.action === "spill").map(item => rowKey(target.path, item.old));
          if (versions.length) setOff(prev => new Set([...prev, ...versions]));
          const folderNew = plan.items.some(item => item.kind === "folder" && item.new);
          if (!target.only && !plan.reason && plan.subject && plan.need !== "season" && !folderNew && !filesOf(plan, undefined).some(doable)) tidy.push(target.path);
        }
      } catch (error) {
        if (alive()) setLoaded(prev => ({ ...prev, [target.path]: { status: "error", error } }));
      }
    }
    if (tidy.length) void organize.mark(tidy, false).then(() => client.invalidateQueries({ queryKey: ["organize"] })).catch(() => undefined);
  }, [setLoaded, client]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const all: Entry[] = [];
      for (const target of chosen) {
        if (target.only) { all.push({ ...target, depth: 0 }); continue; }
        try {
          const { folders } = await tmdbRename.tree(target.path, passwordFor(target.path));
          const seen = new Set(all.map(entry => entry.path));
          for (const folder of folders) if (!seen.has(folder.path)) all.push({ path: folder.path, depth: folder.depth });
        } catch {
          all.push({ ...target, depth: 0 });
        }
      }
      if (!alive) return;
      setTargets(all);
      setExpanding(false);
      await load(all, all, () => alive);
    })();
    return () => { alive = false; };
  }, [chosen, load]);

  const sections = targets.map(target => {
    const state = loaded[target.path];
    const plan = state?.status === "ok" ? state.plan : null;
    const files = plan ? filesOf(plan, target.only) : [];
    // A folder the one above opens up (多一层) keeps its name: it goes away.
    const above = loaded[parent(target.path)];
    const unwrapped = above?.status === "ok" && above.plan.items.some(item => item.action === "unwrap" && item.old === basename(target.path));
    const folder = plan && !target.only && !unwrapped ? plan.items.find(item => item.kind === "folder" && item.new) : undefined;
    return { target, state, plan, files, folder };
  });
  const keys = sections.flatMap(({ target, files, folder }) => [
    ...(folder ? [rowKey(target.path, folder.old)] : []),
    ...files.filter(doable).map(item => rowKey(target.path, item.old)),
  ]);
  const count = keys.filter(key => !off.has(key)).length;
  const ready = expanding ? 0 : sections.filter(section => section.state && section.state.status !== "loading").length;
  const waiting = sections.filter(section => section.plan?.need === "season").length;
  const anything = keys.length > 0;

  const toggle = (key: string): void => setOff(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const apply = async (): Promise<void> => {
    setRunning(true);
    const batch = crypto.randomUUID(); // this run, to put it back (撤销)
    let done = 0;
    let failed = 0;
    let here = decodeURIComponent(location);
    const touched = new Set<string>();
    // Deepest folders first: renaming a folder moves everything below it.
    const order = [...sections].sort((a, b) => b.target.depth - a.target.depth);
    const organized: string[] = [];
    for (const { target, files, folder, plan } of order) {
      const password = passwordFor(target.path);
      const failedBefore = failed;
      let finalPath = target.path;
      // Renames first, then ads go, then wrapper folders open (their contents already renamed, deepest first).
      const rank = (item: RenameItem): number => item.action === "spill" ? 3 : item.action === "unwrap" ? 2 : item.action === "delete" ? 1 : 0;
      for (const item of [...files].sort((a, b) => rank(a) - rank(b))) {
        const key = rowKey(target.path, item.old);
        if (!doable(item) || off.has(key)) continue;
        setRows(prev => ({ ...prev, [key]: { status: "busy" } }));
        try {
          const { results } = item.action === "delete" ? await tmdbRename.apply(target.path, password, [], "", undefined, { remove: [item.old], batch })
            : item.action === "unwrap" ? await tmdbRename.apply(target.path, password, [], "", undefined, { unwrap: [item.old], batch })
            // The whole folder opens up into the one above, and goes.
            : item.action === "spill" ? await tmdbRename.apply(parent(target.path), passwordFor(parent(target.path)), [], "", undefined, { unwrap: [basename(target.path)], batch })
            : await tmdbRename.apply(target.path, password, [{ old: item.old, new: item.new ?? item.old, into: item.into }], "", undefined, { batch });
          if (item.action === "spill") touched.add(parent(target.path));
          if (results[0]?.error) throw new Error(results[0].error);
          done++;
          touched.add(target.path);
          setRows(prev => ({ ...prev, [key]: { status: "done" } }));
        } catch (error) {
          failed++;
          setRows(prev => ({ ...prev, [key]: { status: "error", message: reason(error) } }));
        }
      }
      const folderKey = folder ? rowKey(target.path, folder.old) : "";
      if (folder?.new && !off.has(folderKey)) {
        setRows(prev => ({ ...prev, [folderKey]: { status: "busy" } }));
        try {
          const subject = plan?.series_first ? { kind: "movie", id: plan.series_first }
            : plan?.subject ? { kind: plan.subject.kind, id: plan.subject.id, season: plan.season || undefined } : undefined;
          const out = await tmdbRename.apply(target.path, password, [], folder.new, subject, { batch });
          if (out.results[0]?.error) throw new Error(out.results[0].error);
          done++;
          const moved = out.path || join(parent(target.path), folder.new);
          finalPath = moved;
          touched.delete(target.path);
          touched.add(moved);
          touched.add(parent(target.path));
          if (here === target.path || here.startsWith(target.path + "/")) {
            here = moved + here.slice(target.path.length);
            navigate(encodePath(here), { replace: true });
          }
          setRows(prev => ({ ...prev, [folderKey]: { status: "done" } }));
        } catch (error) {
          failed++;
          setRows(prev => ({ ...prev, [folderKey]: { status: "error", message: reason(error) } }));
        }
      }
      // Gone through without a failure: no longer waiting to be organized (整理模式, the download nudge).
      if (failed === failedBefore && !target.only) organized.push(target.path, finalPath);
    }
    if (organized.length) void organize.mark([...new Set(organized)], false).then(() => client.invalidateQueries({ queryKey: ["organize"] })).catch(() => undefined);
    void client.invalidateQueries({ queryKey: ["organize-check"] });
    setRunning(false);
    setFinished(true);
    for (const path of touched) void actions.reload(path, false);
    void client.invalidateQueries({ queryKey: ["posters"] });
    if (failed === 0 && done > 0) useToasts.getState().push({ tone: "success", title: "整理好了", detail: `完成 ${done} 项`, action: { label: "撤销", run: () => void undoRun(batch) } }, 8000);
    else if (failed === 0) toast.success("整理好了", `完成 ${done} 项`);
    else toast.error(`有 ${failed} 个没改成`, new Error(`${done} renamed, ${failed} failed`));
  };

  // Closing while renaming does not stop it: the renames go on in the
  // background and the toast at the end reports how they went.
  const close = (): void => {
    if (running) toast.info("在后台继续整理", "改完会告诉你结果，可以接着做别的");
    onClose();
  };

  const single = !multi ? sections[0] : null;
  const rootOf = (path: string): string => chosen.find(target => path === target.path || path.startsWith(target.path + "/"))?.path ?? path;
  const label = (target: Entry): string => target.depth > 0 ? basename(rootOf(target.path)) + target.path.slice(rootOf(target.path).length) : basename(target.path);
  const replan = (target: Entry, season: number): void => {
    const below = targets.filter(entry => entry.path.startsWith(target.path + "/") && plansRef.current[entry.path]?.status === "ok"
      && (plansRef.current[entry.path] as { plan: RenamePlan }).plan.inherited);
    const prefixes = [target, ...below].map(entry => entry.path + "\n");
    setOff(prev => new Set([...prev].filter(key => !prefixes.some(prefix => key.startsWith(prefix)))));
    void load([target], targets, () => true, season).then(() => load(below, targets, () => true));
  };
  // Which film a folder is: its cover, and what it is named after. Back here afterwards, planned again.
  const changeFilm = (target: Entry): void => useUi.getState().openDialog({ kind: "poster", name: basename(target.path), dir: parent(target.path), then: { kind: "tmdb-rename", targets: chosen } });
  // Nothing to do here (a shelf of one's own, not a film): 整理模式 stops showing it.
  const settle = (): void => {
    const paths = chosen.filter(target => !target.only).map(target => target.path);
    void organize.mark(paths, false).then(() => {
      void client.invalidateQueries({ queryKey: ["organize"] });
      toast.success("不再提示整理", paths.length > 1 ? `${paths.length} 项` : basename(paths[0] ?? ""));
    }).catch(error => toast.error("没有标记成功", error));
    onClose();
  };
  const unsettled = !finished && !running && chosen.some(target => !target.only);
  const footer = (multi ? ready > 0 : single?.plan && !single.plan.reason) && (anything || finished) ? (
    <>
      {!finished && keys.length > 1 && (
        <button className="btn btn-ghost mr-auto" disabled={running}
          onClick={() => setOff(off.size ? new Set() : new Set(keys))}>
          {off.size ? "全选" : "全不选"}
        </button>
      )}
      {unsettled && <button className="btn btn-ghost text-muted" onClick={settle} title="以后整理模式不再显示">不用整理</button>}
      <button className="btn btn-ghost" onClick={close}>{finished ? "完成" : running ? "后台继续" : "取消"}</button>
      {!finished && (
        <button className="btn btn-primary" disabled={running || count === 0 || ready < targets.length} onClick={() => void apply()}>
          {running ? "正在改名…" : ready < targets.length ? `查询中 ${ready}/${targets.length}` : `整理 ${count} 项`}
        </button>
      )}
    </>
  ) : unsettled && !expanding && ready === targets.length ? (
    <>
      <button className="btn btn-ghost text-muted" onClick={settle} title="以后整理模式不再显示">不用整理</button>
      <button className="btn btn-ghost" onClick={close}>关闭</button>
    </>
  ) : undefined;

  return (
    <Sheet open onClose={close} title={title} width={640} footer={footer}>
      {expanding && !multi && <PlanSkeleton />}
      {multi && (
        <p className="mb-4 flex items-center gap-2 text-[12.5px] text-faint">
          {ready < targets.length && <span className="loader-bars -my-2 scale-50" aria-hidden><i /><i /><i /><i /></span>}
          {expanding ? "正在看有哪些子文件夹…"
            : ready < targets.length ? `正在向 TMDB 查询，${ready}/${targets.length}`
            : waiting ? `有 ${waiting} 个文件夹要先选是第几季，其余的可以直接整理`
            : "名字来自 TMDB。逐条看一眼，不要的点掉。"}
        </p>
      )}
      <div className={multi ? "flex flex-col gap-7" : ""}>
        {sections.map(({ target, state, plan, files, folder }, sectionIndex) => (
          <section key={target.path}>
            {(!state || state.status === "loading") && <PlanSkeleton compact={multi} />}
            {state?.status === "error" && (
              <ErrorState compact error={state.error} onRetry={() => void load([target], targets, () => true)} />
            )}
            {plan?.reason === "no-match" && (multi ? (
              <div className="flex items-center gap-3 rounded-[14px] bg-surface px-4 py-3 hairline">
                <FilmSlateIcon size={20} className="shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{label(target)}</p>
                  <p className="text-[12.5px] text-faint">TMDB 上没认出来，先「更换封面」选对再整理</p>
                </div>
              </div>
            ) : (
              <div className="grid place-items-center py-10 text-center">
                <FilmSlateIcon size={36} className="text-faint" />
                <p className="mt-3 text-[15px] font-medium">TMDB 上没认出这部片子</p>
                <p className="mt-1 max-w-[34ch] text-[13px] text-muted">先用「更换封面」选对它是哪一部，再回来整理，名字就有据可依了。</p>
                <button className="btn btn-line mt-5" onClick={() => changeFilm(target)}>
                  <FilmSlateIcon size={15} />更换封面
                </button>
              </div>
            ))}
            {plan && !plan.reason && plan.subject?.kind === "tv" && files.some(item => item.kind === "video") && (
              <SeasonPicker id={plan.subject.id} current={plan.season ?? 0} disabled={running || finished}
                ask={plan.need === "season"} onPick={season => replan(target, season)} />
            )}
            {plan && !plan.reason && (!plan.subject || target.only) && (
              <>
                <motion.p className="flex items-center gap-2 text-[13.5px] font-medium" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
                  <FilmStripIcon size={16} className="text-muted" />{target.only ? <>「{basename(target.path)}」里选中的文件</> : <>「{basename(target.path)}」是合集</>}
                  <span className="text-[12.5px] font-normal text-faint">{target.only ? "每个文件按自己的片名或集数" : "每部片按自己的名字，各放进自己的文件夹"}</span>
                </motion.p>
                <ul className="mt-2 divide-y divide-line">
                  {folder && (
                    <Row item={folder} on={!off.has(rowKey(target.path, folder.old))} state={rows[rowKey(target.path, folder.old)]} index={0}
                      locked={running || finished} onToggle={() => toggle(rowKey(target.path, folder.old))} />
                  )}
                  {files.map((item, index) => {
                    const key = rowKey(target.path, item.old);
                    return (
                      <Row key={item.old} item={item} on={doable(item) && !off.has(key)} state={rows[key]} index={index}
                        locked={running || finished || !doable(item)} onToggle={() => toggle(key)} />
                    );
                  })}
                </ul>
              </>
            )}
            {plan && !plan.reason && plan.subject && !target.only && (
              <>
                <motion.div className="flex items-center gap-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ ...spring.soft, delay: multi ? Math.min(sectionIndex, 6) * 0.04 : 0 }}>
                  <div className={`relative shrink-0 overflow-hidden rounded-[10px] bg-surface hairline ${multi ? "h-[54px] w-[36px]" : "h-[84px] w-[56px]"}`}>
                    {plan.subject.poster && <img src={posterSrc(plan.subject.poster, "w185")} alt="" className="size-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate font-semibold tracking-tight ${multi ? "text-[14.5px]" : "text-[16px]"}`}>{plan.subject.title}</p>
                    <p className="mt-0.5 truncate text-[12.5px] text-muted">
                      {plan.subject.kind === "tv" ? "剧集" : "电影"}{plan.subject.year ? ` · ${plan.subject.year}` : ""}{plan.subject.season ? ` · 第 ${plan.subject.season} 季` : ""}
                      {multi && <span className="text-faint"> · {label(target)}</span>}
                      {plan.inherited && <span className="text-faint"> · 跟随上级</span>}
                    </p>
                    {!multi && <p className="mt-1.5 text-[12.5px] text-faint">名字来自 TMDB。逐条看一眼，不要的点掉。</p>}
                  </div>
                  {!plan.inherited && !running && !finished && (
                    <button className="btn btn-ghost h-8 shrink-0 px-2.5 text-[12.5px]" onClick={() => changeFilm(target)} title="认错了？换成别的片，封面和名字一起改">
                      <FilmSlateIcon size={14} />换一部
                    </button>
                  )}
                </motion.div>
                {!files.some(doable) && !folder && plan.need !== "season" ? (
                  <div className={`${multi ? "mt-3" : "mt-6"} flex items-center gap-2.5 rounded-[14px] bg-surface px-4 py-3 text-[13.5px] hairline`}>
                    <SealCheckIcon size={18} className="text-accent-text" weight="fill" />这里的名字已经很规整了
                  </div>
                ) : (
                  <ul className={`${multi ? "mt-2" : "mt-5"} divide-y divide-line`}>
                    {folder && (
                      <Row item={folder} on={!off.has(rowKey(target.path, folder.old))} state={rows[rowKey(target.path, folder.old)]} index={0}
                        locked={running || finished} onToggle={() => toggle(rowKey(target.path, folder.old))} />
                    )}
                    {files.map((item, index) => {
                      const key = rowKey(target.path, item.old);
                      return (
                        <Row key={item.old} item={item} on={doable(item) && !off.has(key)} state={rows[key]} index={index + 1}
                          locked={running || finished || !doable(item)} onToggle={() => toggle(key)} />
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </section>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * Which season the episodes belong to. Read from the folder (its poster or its
 * name) by default; a wrong guess, or names given under a wrong season before,
 * are put right by choosing another one here, which plans the folder again.
 */
function SeasonPicker({ id, current, disabled, ask, onPick }: { id: number; current: number; disabled: boolean; ask?: boolean; onPick: (season: number) => void }) {
  const seasons = useQuery({ queryKey: ["poster-seasons", id], queryFn: () => posters.seasons(id), staleTime: 10 * 60_000, retry: false });
  const list = (seasons.data ?? []).filter(item => item.season > 0);
  if (list.length < 2) return null;
  return (
    <motion.div className={`order-first mb-3 flex flex-wrap items-center gap-1.5 text-[12.5px] ${ask ? "rounded-[14px] bg-surface px-3 py-2.5 hairline" : ""}`}
      initial={ask ? { opacity: 0, y: -6 } : false} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
      <span className={`mr-1 ${ask ? "w-full pb-1 font-medium text-ink" : "text-faint"}`}>
        {ask ? "这部剧有好几季，这个文件夹是第几季？选好就给出名字" : "按哪一季命名"}
      </span>
      {list.map(item => {
        const on = item.season === current;
        return (
          <motion.button key={item.season} type="button" disabled={disabled || on} onClick={() => onPick(item.season)}
            whileTap={{ scale: 0.94 }} transition={spring.snappy}
            className={`tabular rounded-full px-2.5 py-1 transition-colors ${on ? "bg-accent font-medium text-accent-ink" : "text-muted hairline hover:text-ink"}`}>
            第 {item.season} 季{item.episodes ? <span className={on ? "opacity-70" : "text-faint"}> · {item.episodes}</span> : null}
          </motion.button>
        );
      })}
    </motion.div>
  );
}

function Row({ item, on, state, index, locked, onToggle }: { item: RenameItem; on: boolean; state?: RowState; index: number; locked: boolean; onToggle: () => void }) {
  const done = state?.status === "done";
  const tag = item.kind === "folder" ? "文件夹" : item.kind === "subtitle" ? "字幕" : item.kind === "extra" ? "附属"
    : item.action === "delete" ? "广告" : item.action === "unwrap" ? "多一层" : item.action === "spill" ? "拆开" : item.into ? "单独文件夹"
    : item.episode ? `S${String(item.season ?? 1).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}` : "";
  const Icon = item.kind === "folder" || item.action === "unwrap" || item.action === "spill" ? FolderSimpleIcon : item.action === "delete" ? TrashIcon : item.kind === "subtitle" ? SubtitlesIcon : item.kind === "extra" ? FileIcon : FilmStripIcon;
  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.soft, delay: Math.min(index, 14) * 0.03 }}
    >
      <button type="button" disabled={locked} onClick={onToggle} aria-pressed={on}
        className={`flex w-full items-start gap-3 py-3 text-left ${doable(item) ? "" : "opacity-55"}`}>
        <span className={`mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full transition-colors ${on || done ? "bg-accent text-accent-ink" : "hairline"}`}>
          <AnimatePresence>
            {(on || done) && (
              <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={spring.pop}>
                <CheckIcon size={11} weight="bold" />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <span className="min-w-0 flex-1">
          {item.action ? (
            <>
              <span className={`block truncate text-[14px] font-medium ${done ? "text-faint line-through" : ""}`}>
                {item.action === "delete" ? "删除" : item.action === "spill" ? "拆开这个合集" : "拆开这一层"}
              </span>
              <span className="mt-0.5 block truncate text-[12.5px] text-faint">
                {item.action === "delete" ? item.old : item.action === "spill" ? `里面的系列和电影移到上一层，和其他片并列` : `「${item.old}」里的内容移到上一层`}
              </span>
            </>
          ) : item.new ? (
            <span className="block [perspective:600px]">
              <motion.span key={done ? "done" : "plan"} className="block origin-bottom truncate text-[14px] font-medium"
                initial={done ? { rotateX: 90, opacity: 0 } : false} animate={{ rotateX: 0, opacity: 1 }} transition={spring.pop}>
                {item.into && <span className="text-muted">{item.into} / </span>}{item.new}
              </motion.span>
            </span>
          ) : (
            <span className="block truncate text-[14px]">{item.old}</span>
          )}
          {item.new && (
            <span className={`mt-0.5 block truncate text-[12.5px] text-faint transition-opacity ${done ? "line-through opacity-60" : ""}`}>{item.old}</span>
          )}
          {item.reason && (!item.new || item.reason === "version") && (
            <span className={`mt-0.5 block text-[12.5px] ${item.reason === "version" ? "text-muted" : "text-faint"}`}>
              {item.reason === "version" && item.size ? <span className="tabular font-medium text-ink">{formatBytes(item.size)} · </span> : null}{WHY[item.reason]}
            </span>
          )}
          {state?.status === "error" && (
            <motion.span className="mt-1 flex items-center gap-1 text-[12.5px] text-danger" initial={{ x: -6 }} animate={{ x: [6, -4, 2, 0] }} transition={{ duration: 0.4 }}>
              <WarningIcon size={13} />{state.message}
            </motion.span>
          )}
        </span>
        <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted">
          {state?.status === "busy" && <span className="loader-bars -my-2 scale-50" aria-label="正在改名"><i /><i /><i /><i /></span>}
          {tag && <span className="tabular rounded-[6px] bg-surface px-1.5 py-0.5 font-mono hairline">{tag}</span>}
          <Icon size={14} className="text-faint" />
        </span>
      </button>
    </motion.li>
  );
}

function PlanSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div aria-label="正在向 TMDB 查询">
      <div className="flex items-center gap-4">
        <div className={`skeleton rounded-[10px] ${compact ? "h-[54px] w-[36px]" : "h-[84px] w-[56px]"}`} />
        <div className="flex-1 space-y-2"><div className="skeleton h-4 w-40 rounded-[6px]" /><div className="skeleton h-3 w-24 rounded-[6px]" /></div>
      </div>
      <div className="mt-6 space-y-4">
        {Array.from({ length: compact ? 2 : 5 }, (_, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="skeleton size-[18px] rounded-full" />
            <div className="flex-1 space-y-1.5"><div className="skeleton h-3.5 rounded-[6px]" style={{ width: `${70 - i * 7}%` }} /><div className="skeleton h-3 w-1/2 rounded-[6px]" /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
