import { CheckIcon, FilmSlateIcon, SealCheckIcon, SubtitlesIcon, FolderSimpleIcon, FilmStripIcon, WarningIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { posterSrc } from "../api/posters";
import { tmdbRename, type RenameItem } from "../api/rename";
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
 * place as the drive confirms it. Nothing changes before "整理".
 */
const WHY: Record<NonNullable<RenameItem["reason"]>, string> = {
  same: "已经是规整的名字",
  "no-episode": "认不出是第几集",
  several: "文件夹里有好几部，分不清",
  conflict: "会和别的文件重名",
};

type RowState = { status: "busy" } | { status: "done" } | { status: "error"; message: string };

export function TmdbRename({ path, onClose }: { path: string; onClose: () => void }) {
  const password = passwordFor(path);
  const client = useQueryClient();
  const [location, navigate] = useLocation();
  const plan = useQuery({ queryKey: ["tmdb-rename", path], queryFn: () => tmdbRename.plan(path, password), retry: false, staleTime: 0, gcTime: 0 });
  const files = useMemo(() => (plan.data?.items ?? []).filter(item => item.kind !== "folder"), [plan.data]);
  const folder = plan.data?.items.find(item => item.kind === "folder");
  const proposals = files.filter(item => item.new);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [folderOn, setFolderOn] = useState(true);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const chosen = proposals.filter(item => !off.has(item.old));
  const renameFolder = !!folder?.new && folderOn;
  const count = chosen.length + (renameFolder ? 1 : 0);

  const toggle = (name: string): void => setOff(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const apply = async (): Promise<void> => {
    setRunning(true);
    let done = 0;
    let failed = 0;
    for (const item of chosen) {
      setRows(prev => ({ ...prev, [item.old]: { status: "busy" } }));
      try {
        const { results } = await tmdbRename.apply(path, password, [{ old: item.old, new: item.new! }]);
        const error = results[0]?.error;
        if (error) throw new Error(error);
        done++;
        setRows(prev => ({ ...prev, [item.old]: { status: "done" } }));
      } catch (error) {
        failed++;
        setRows(prev => ({ ...prev, [item.old]: { status: "error", message: reason(error) } }));
      }
    }
    let finalPath = path;
    if (renameFolder && folder?.new) {
      setRows(prev => ({ ...prev, [folder.old]: { status: "busy" } }));
      try {
        const out = await tmdbRename.apply(path, password, [], folder.new);
        const error = out.results[0]?.error;
        if (error) throw new Error(error);
        done++;
        finalPath = out.path || join(parent(path), folder.new);
        setRows(prev => ({ ...prev, [folder.old]: { status: "done" } }));
      } catch (error) {
        failed++;
        setRows(prev => ({ ...prev, [folder.old]: { status: "error", message: reason(error) } }));
      }
    }
    setRunning(false);
    setFinished(true);
    void actions.reload(finalPath, false);
    if (finalPath !== path) {
      void actions.reload(parent(path), false);
      const here = decodeURIComponent(location);
      if (here === path || here.startsWith(path + "/")) navigate(encodePath(finalPath + here.slice(path.length)), { replace: true });
    }
    void client.invalidateQueries({ queryKey: ["posters"] });
    if (failed === 0) toast.success("已按 TMDB 整理", `改好了 ${done} 个名字`);
    else toast.error(`有 ${failed} 个没改成`, new Error(`${done} renamed, ${failed} failed`));
  };

  const subject = plan.data?.subject;
  const footer = plan.data && !plan.data.reason && (proposals.length > 0 || folder?.new) ? (
    <>
      {!finished && proposals.length > 1 && (
        <button className="btn btn-ghost mr-auto" disabled={running}
          onClick={() => setOff(off.size ? new Set() : new Set(proposals.map(item => item.old)))}>
          {off.size ? "全选" : "全不选"}
        </button>
      )}
      <button className="btn btn-ghost" onClick={onClose}>{finished ? "完成" : "取消"}</button>
      {!finished && (
        <button className="btn btn-primary" disabled={running || count === 0} onClick={() => void apply()}>
          {running ? "正在改名…" : `整理 ${count} 项`}
        </button>
      )}
    </>
  ) : undefined;

  return (
    <Sheet open onClose={running ? () => undefined : onClose} title="按 TMDB 整理命名" width={640} footer={footer}>
      {plan.isPending && <PlanSkeleton />}
      {plan.isError && <ErrorState compact error={plan.error} onRetry={() => plan.refetch()} />}
      {plan.data?.reason === "no-match" && (
        <div className="grid place-items-center py-10 text-center">
          <FilmSlateIcon size={36} className="text-faint" />
          <p className="mt-3 text-[15px] font-medium">TMDB 上没认出这部片子</p>
          <p className="mt-1 max-w-[34ch] text-[13px] text-muted">先用「更换封面」选对它是哪一部，再回来整理，名字就有据可依了。</p>
          <button className="btn btn-line mt-5" onClick={() => useUi.getState().openDialog({ kind: "poster", name: basename(path) })}>
            <FilmSlateIcon size={15} />更换封面
          </button>
        </div>
      )}
      {plan.data && !plan.data.reason && subject && (
        <>
          <motion.div className="flex items-center gap-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
            <div className="relative h-[84px] w-[56px] shrink-0 overflow-hidden rounded-[10px] bg-surface hairline">
              {subject.poster && <img src={posterSrc(subject.poster, "w185")} alt="" className="size-full object-cover" />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[16px] font-semibold tracking-tight">{subject.title}</p>
              <p className="mt-0.5 text-[13px] text-muted">
                {subject.kind === "tv" ? "剧集" : "电影"}{subject.year ? ` · ${subject.year}` : ""}{subject.season ? ` · 第 ${subject.season} 季` : ""}
              </p>
              <p className="mt-1.5 text-[12.5px] text-faint">名字来自 TMDB。逐条看一眼，不要的点掉。</p>
            </div>
          </motion.div>
          {proposals.length === 0 && !folder?.new ? (
            <div className="mt-6 flex items-center gap-2.5 rounded-[14px] bg-surface px-4 py-3.5 text-[13.5px] hairline">
              <SealCheckIcon size={18} className="text-accent-text" weight="fill" />这里的名字已经很规整了
            </div>
          ) : (
            <ul className="mt-5 divide-y divide-line">
              {folder?.new && (
                <Row item={folder} on={folderOn} state={rows[folder.old]} index={0} locked={running || finished} onToggle={() => setFolderOn(on => !on)} />
              )}
              {files.map((item, index) => (
                <Row key={item.old} item={item} on={!!item.new && !off.has(item.old)} state={rows[item.old]} index={index + 1}
                  locked={running || finished || !item.new} onToggle={() => toggle(item.old)} />
              ))}
            </ul>
          )}
        </>
      )}
    </Sheet>
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

function PlanSkeleton() {
  return (
    <div aria-label="正在向 TMDB 查询">
      <div className="flex items-center gap-4">
        <div className="skeleton h-[84px] w-[56px] rounded-[10px]" />
        <div className="flex-1 space-y-2"><div className="skeleton h-4 w-40 rounded-[6px]" /><div className="skeleton h-3 w-24 rounded-[6px]" /></div>
      </div>
      <div className="mt-6 space-y-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="skeleton size-[18px] rounded-full" />
            <div className="flex-1 space-y-1.5"><div className="skeleton h-3.5 rounded-[6px]" style={{ width: `${70 - i * 7}%` }} /><div className="skeleton h-3 w-1/2 rounded-[6px]" /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
