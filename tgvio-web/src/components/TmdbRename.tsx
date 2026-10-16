import { CheckIcon, FilmSlateIcon, SealCheckIcon, SubtitlesIcon, FolderSimpleIcon, FilmStripIcon, WarningIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { posters, posterSrc } from "../api/posters";
import { tmdbRename, type RenameItem, type RenamePlan } from "../api/rename";
import { passwordFor } from "../hooks/useDir";
import * as actions from "../lib/actions";
import { reason } from "../lib/errors";
import { spring } from "../lib/motion";
import { basename, encodePath, join, parent } from "../lib/path";
import { toast } from "../stores/toast";
import { useUi } from "../stores/ui";
import { ErrorState } from "./ErrorState";
import { Sheet } from "./Sheet";

/**
 * Rename a folder's videos after TMDB. The plan arrives as a departures board:
 * each row shows the name on the drive and the name it would get. People keep
 * or drop rows; applying renames one row at a time and each new name flips into
 * place as the drive confirms it. Nothing changes before "整理". Several folders
 * (a multi-selection) are planned one after another, each under its own poster.
 */
const WHY: Record<NonNullable<RenameItem["reason"]>, string> = {
  same: "已经是规整的名字",
  "no-episode": "认不出是第几集",
  several: "文件夹里有好几部，分不清",
  conflict: "会和别的文件重名",
  unknown: "TMDB 上没认出来",
};

type RowState = { status: "busy" } | { status: "done" } | { status: "error"; message: string };

/** A folder to plan; `only` limits it to chosen files (and their subtitles), leaving the folder's name alone. */
export interface RenameTarget { path: string; only?: string[] }

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

export function TmdbRename({ targets, onClose }: { targets: RenameTarget[]; onClose: () => void }) {
  const client = useQueryClient();
  const [location, navigate] = useLocation();
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [off, setOff] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const multi = targets.length > 1;
  const folderCount = targets.filter(target => !target.only).length;
  const fileCount = targets.reduce((sum, target) => sum + (target.only?.length ?? 0), 0);
  const title = !multi && folderCount ? "按 TMDB 整理命名"
    : `按 TMDB 整理${[folderCount ? ` ${folderCount} 个文件夹` : "", fileCount ? ` ${fileCount} 个文件` : ""].filter(Boolean).join(" 和")}`;

  // Plans load one folder after another: TMDB is asked a few times per folder.
  const load = useCallback(async (list: RenameTarget[], alive: () => boolean, season?: number): Promise<void> => {
    for (const target of list) {
      if (!alive()) return;
      setLoaded(prev => ({ ...prev, [target.path]: { status: "loading" } }));
      try {
        const plan = await tmdbRename.plan(target.path, passwordFor(target.path), target.only, season);
        if (alive()) setLoaded(prev => ({ ...prev, [target.path]: { status: "ok", plan } }));
      } catch (error) {
        if (alive()) setLoaded(prev => ({ ...prev, [target.path]: { status: "error", error } }));
      }
    }
  }, []);
  useEffect(() => {
    let alive = true;
    void load(targets, () => alive);
    return () => { alive = false; };
  }, [targets, load]);

  const sections = targets.map(target => {
    const state = loaded[target.path];
    const plan = state?.status === "ok" ? state.plan : null;
    const files = plan ? filesOf(plan, target.only) : [];
    const folder = plan && !target.only ? plan.items.find(item => item.kind === "folder" && item.new) : undefined;
    return { target, state, plan, files, folder };
  });
  const keys = sections.flatMap(({ target, files, folder }) => [
    ...(folder ? [rowKey(target.path, folder.old)] : []),
    ...files.filter(item => item.new).map(item => rowKey(target.path, item.old)),
  ]);
  const count = keys.filter(key => !off.has(key)).length;
  const ready = sections.filter(section => section.state && section.state.status !== "loading").length;
  const anything = keys.length > 0;

  const toggle = (key: string): void => setOff(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const apply = async (): Promise<void> => {
    setRunning(true);
    let done = 0;
    let failed = 0;
    let here = decodeURIComponent(location);
    const touched = new Set<string>();
    for (const { target, files, folder } of sections) {
      const password = passwordFor(target.path);
      for (const item of files) {
        const key = rowKey(target.path, item.old);
        if (!item.new || off.has(key)) continue;
        setRows(prev => ({ ...prev, [key]: { status: "busy" } }));
        try {
          const { results } = await tmdbRename.apply(target.path, password, [{ old: item.old, new: item.new }]);
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
          const out = await tmdbRename.apply(target.path, password, [], folder.new);
          if (out.results[0]?.error) throw new Error(out.results[0].error);
          done++;
          const moved = out.path || join(parent(target.path), folder.new);
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
    }
    setRunning(false);
    setFinished(true);
    for (const path of touched) void actions.reload(path, false);
    void client.invalidateQueries({ queryKey: ["posters"] });
    if (failed === 0) toast.success("已按 TMDB 整理", `改好了 ${done} 个名字`);
    else toast.error(`有 ${failed} 个没改成`, new Error(`${done} renamed, ${failed} failed`));
  };

  const single = !multi ? sections[0] : null;
  const footer = (multi ? ready > 0 : single?.plan && !single.plan.reason) && (anything || finished) ? (
    <>
      {!finished && keys.length > 1 && (
        <button className="btn btn-ghost mr-auto" disabled={running}
          onClick={() => setOff(off.size ? new Set() : new Set(keys))}>
          {off.size ? "全选" : "全不选"}
        </button>
      )}
      <button className="btn btn-ghost" onClick={onClose}>{finished ? "完成" : "取消"}</button>
      {!finished && (
        <button className="btn btn-primary" disabled={running || count === 0 || ready < targets.length} onClick={() => void apply()}>
          {running ? "正在改名…" : ready < targets.length ? `查询中 ${ready}/${targets.length}` : `整理 ${count} 项`}
        </button>
      )}
    </>
  ) : undefined;

  return (
    <Sheet open onClose={running ? () => undefined : onClose} title={title} width={640} footer={footer}>
      {multi && (
        <p className="mb-4 flex items-center gap-2 text-[12.5px] text-faint">
          {ready < targets.length && <span className="loader-bars -my-2 scale-50" aria-hidden><i /><i /><i /><i /></span>}
          {ready < targets.length ? `正在向 TMDB 查询，${ready}/${targets.length}` : "名字来自 TMDB。逐条看一眼，不要的点掉。"}
        </p>
      )}
      <div className={multi ? "flex flex-col gap-7" : ""}>
        {sections.map(({ target, state, plan, files, folder }, sectionIndex) => (
          <section key={target.path}>
            {(!state || state.status === "loading") && <PlanSkeleton compact={multi} />}
            {state?.status === "error" && (
              <ErrorState compact error={state.error} onRetry={() => void load([target], () => true)} />
            )}
            {plan?.reason === "no-match" && (multi ? (
              <div className="flex items-center gap-3 rounded-[14px] bg-surface px-4 py-3 hairline">
                <FilmSlateIcon size={20} className="shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{basename(target.path)}</p>
                  <p className="text-[12.5px] text-faint">TMDB 上没认出来，先「更换封面」选对再整理</p>
                </div>
              </div>
            ) : (
              <div className="grid place-items-center py-10 text-center">
                <FilmSlateIcon size={36} className="text-faint" />
                <p className="mt-3 text-[15px] font-medium">TMDB 上没认出这部片子</p>
                <p className="mt-1 max-w-[34ch] text-[13px] text-muted">先用「更换封面」选对它是哪一部，再回来整理，名字就有据可依了。</p>
                <button className="btn btn-line mt-5" onClick={() => useUi.getState().openDialog({ kind: "poster", name: basename(target.path) })}>
                  <FilmSlateIcon size={15} />更换封面
                </button>
              </div>
            ))}
            {plan && !plan.reason && plan.subject?.kind === "tv" && (
              <SeasonPicker id={plan.subject.id} current={plan.season ?? 0} disabled={running || finished}
                onPick={season => {
                  setOff(prev => new Set([...prev].filter(key => !key.startsWith(target.path + "\n"))));
                  void load([target], () => true, season);
                }} />
            )}
            {plan && !plan.reason && (!plan.subject || target.only) && (
              <>
                <motion.p className="flex items-center gap-2 text-[13.5px] font-medium" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
                  <FilmStripIcon size={16} className="text-muted" />「{basename(target.path)}」里选中的文件
                  <span className="text-[12.5px] font-normal text-faint">每个文件按自己的片名或集数</span>
                </motion.p>
                <ul className="mt-2 divide-y divide-line">
                  {files.map((item, index) => {
                    const key = rowKey(target.path, item.old);
                    return (
                      <Row key={item.old} item={item} on={!!item.new && !off.has(key)} state={rows[key]} index={index}
                        locked={running || finished || !item.new} onToggle={() => toggle(key)} />
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
                  <div className="min-w-0">
                    <p className={`truncate font-semibold tracking-tight ${multi ? "text-[14.5px]" : "text-[16px]"}`}>{plan.subject.title}</p>
                    <p className="mt-0.5 truncate text-[12.5px] text-muted">
                      {plan.subject.kind === "tv" ? "剧集" : "电影"}{plan.subject.year ? ` · ${plan.subject.year}` : ""}{plan.subject.season ? ` · 第 ${plan.subject.season} 季` : ""}
                      {multi && <span className="text-faint"> · {basename(target.path)}</span>}
                    </p>
                    {!multi && <p className="mt-1.5 text-[12.5px] text-faint">名字来自 TMDB。逐条看一眼，不要的点掉。</p>}
                  </div>
                </motion.div>
                {!files.some(item => item.new) && !folder ? (
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
                        <Row key={item.old} item={item} on={!!item.new && !off.has(key)} state={rows[key]} index={index + 1}
                          locked={running || finished || !item.new} onToggle={() => toggle(key)} />
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
function SeasonPicker({ id, current, disabled, onPick }: { id: number; current: number; disabled: boolean; onPick: (season: number) => void }) {
  const seasons = useQuery({ queryKey: ["poster-seasons", id], queryFn: () => posters.seasons(id), staleTime: 10 * 60_000, retry: false });
  const list = (seasons.data ?? []).filter(item => item.season > 0);
  if (list.length < 2) return null;
  return (
    <div className="order-first mb-3 flex flex-wrap items-center gap-1.5 text-[12.5px]">
      <span className="mr-1 text-faint">按哪一季命名</span>
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
    </div>
  );
}

function Row({ item, on, state, index, locked, onToggle }: { item: RenameItem; on: boolean; state?: RowState; index: number; locked: boolean; onToggle: () => void }) {
  const done = state?.status === "done";
  const tag = item.kind === "folder" ? "文件夹" : item.kind === "subtitle" ? "字幕"
    : item.episode ? `S${String(item.season ?? 1).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}` : "";
  const Icon = item.kind === "folder" ? FolderSimpleIcon : item.kind === "subtitle" ? SubtitlesIcon : FilmStripIcon;
  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.soft, delay: Math.min(index, 14) * 0.03 }}
    >
      <button type="button" disabled={locked} onClick={onToggle} aria-pressed={on}
        className={`flex w-full items-start gap-3 py-3 text-left ${item.new ? "" : "opacity-55"}`}>
        <span className={`mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full transition-colors ${on || done ? "bg-accent text-accent-ink" : "hairline"}`}>
          <AnimatePresence>
            {(on || done) && (
              <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={spring.bouncy}>
                <CheckIcon size={11} weight="bold" />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <span className="min-w-0 flex-1">
          {item.new ? (
            <span className="block [perspective:600px]">
              <motion.span key={done ? "done" : "plan"} className="block origin-bottom truncate text-[14px] font-medium"
                initial={done ? { rotateX: 90, opacity: 0 } : false} animate={{ rotateX: 0, opacity: 1 }} transition={spring.bouncy}>
                {item.new}
              </motion.span>
            </span>
          ) : (
            <span className="block truncate text-[14px]">{item.old}</span>
          )}
          {item.new && (
            <span className={`mt-0.5 block truncate text-[12.5px] text-faint transition-opacity ${done ? "line-through opacity-60" : ""}`}>{item.old}</span>
          )}
          {!item.new && item.reason && <span className="mt-0.5 block text-[12.5px] text-faint">{WHY[item.reason]}</span>}
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
