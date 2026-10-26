import { ArrowClockwiseIcon, CheckCircleIcon, PauseIcon, PlayIcon, TrashIcon, WarningCircleIcon, XIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tasks, TASK_TYPES, type TaskType } from "../api/admin";
import { useIsMobile } from "../hooks/useMedia";
import { formatBytes, formatDate, formatDuration, formatRate } from "../lib/format";
import type { StagedSnapshot } from "../lib/upload";
import { kindOf } from "../lib/kind";
import { spring } from "../lib/motion";
import type { TaskInfo } from "../lib/types";
import { toast } from "../stores/toast";
import { useUi } from "../stores/ui";
import { useUploads, type UploadJob } from "../stores/uploads";
import { KindIcon } from "./KindIcon";
import { reason } from "../lib/errors";
import { taskName } from "../lib/taskName";
import { needText, organize } from "../api/organize";
import { undoRun } from "../lib/undo";
import { encodePath } from "../lib/path";
import { navigate } from "wouter/use-browser-location";

function Bar({ value, tone = "accent" }: { value: number; tone?: "accent" | "danger" | "muted" }) {
  const color = tone === "danger" ? "var(--danger)" : tone === "muted" ? "var(--faint)" : "var(--accent)";
  return (
    <div className="h-1 overflow-hidden rounded-full bg-line">
      <motion.div className="h-full origin-left rounded-full" style={{ background: color }}
        initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0, Math.min(1, value)) }} transition={spring.soft} />
    </div>
  );
}

function JobRow({ job }: { job: UploadJob }) {
  const { cancel, retry } = useUploads.getState();
  const fraction = job.phase === "storing" ? job.storage / 100 : job.size ? job.sent / job.size : 1;
  const name = job.name.split("/").pop() ?? job.name;
  let status: React.ReactNode;
  if (job.state === "queued") status = "等待中";
  else if (job.state === "running") status = job.phase === "storing" ? `写入网盘 ${Math.round(job.storage)}%` : `${formatBytes(job.sent)} / ${formatBytes(job.size)}${job.rate ? `，${formatRate(job.rate)}` : ""}`;
  else if (job.state === "done") status = <span className="text-accent-text">已完成，{formatBytes(job.size)}</span>;
  else if (job.state === "canceled") status = "已取消";
  else status = <span className="text-danger" title={job.error}>{job.exists ? "已有同名文件" : reason(job.error)}</span>;
  return (
    <motion.li layout className="flex items-center gap-3 rounded-xl px-2 py-2.5" initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }} transition={spring.snappy}>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-muted hairline">
        {job.state === "done" ? <motion.span initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={spring.pop}><CheckCircleIcon size={18} weight="fill" className="text-accent-text" /></motion.span>
          : job.state === "error" ? <WarningCircleIcon size={18} weight="fill" className="text-danger" />
          : <KindIcon kind={kindOf({ name, is_dir: false, type: 0 })} size={17} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium" title={job.name}>{name}</p>
        <p className="mb-1.5 truncate text-[12px] text-muted tabular">{status}</p>
        {(job.state === "running" || job.state === "queued") && <Bar value={fraction} tone={job.state === "queued" ? "muted" : "accent"} />}
      </div>
      {(job.state === "running" || job.state === "queued") && <button className="icon-btn size-8" onClick={() => cancel(job.id)} aria-label="取消"><XIcon size={15} /></button>}
      {(job.state === "error" || job.state === "canceled") && (
        job.exists
          ? <button className="btn btn-line h-8 px-2.5 text-[12.5px]" onClick={() => retry(job.id, true)}>覆盖</button>
          : <button className="icon-btn size-8" onClick={() => retry(job.id)} aria-label="重试"><ArrowClockwiseIcon size={15} /></button>
      )}
    </motion.li>
  );
}

const STATE_LABEL: Record<number, string> = { 0: "等待", 1: "运行中", 2: "已完成", 3: "取消中", 4: "已取消", 5: "出错，将重试", 6: "失败中", 7: "失败", 8: "等待重试", 9: "准备重试" };
const RUNNING = new Set([0, 1, 3, 5, 6, 8, 9]);

/**
 * Server tasks, live: the unfinished ones every 2 s (they move), the finished
 * ones every 15 s and right after something finishes. Shared by the transfer
 * panel and 管理 › 任务, so the tab can count what is running.
 */
export function useServerTasks() {
  const client = useQueryClient();
  const undone = useQueries({
    queries: TASK_TYPES.map(([type]) => ({ queryKey: ["tasks", type, "undone"], queryFn: async () => (await tasks.undone(type)) ?? [], refetchInterval: 2000, retry: false })),
  });
  const done = useQueries({
    queries: TASK_TYPES.map(([type]) => ({ queryKey: ["tasks", type, "done"], queryFn: async () => (await tasks.done(type)) ?? [], refetchInterval: 15_000, retry: false })),
  });
  // Something left the running list: fetch the finished ones now instead of in up to 15 s.
  const running = undone.reduce((sum, result) => sum + (result.data?.length ?? 0), 0);
  const last = useRef(running);
  useEffect(() => {
    if (running < last.current) void client.invalidateQueries({ queryKey: ["tasks"] });
    last.current = running;
  }, [running, client]);
  const groups = TASK_TYPES.map(([type, label], index) => ({
    type, label,
    list: [...(undone[index].data ?? []), ...(done[index].data ?? [])],
  })).filter(group => group.list.length);
  return {
    pending: undone.every(result => result.isPending) && done.every(result => result.isPending),
    groups,
    running,
    finished: groups.some(group => group.list.some(task => !RUNNING.has(task.state))),
    refresh: () => client.invalidateQueries({ queryKey: ["tasks"] }),
    clearFinished: async () => {
      await Promise.all(groups.filter(group => group.list.some(task => !RUNNING.has(task.state))).map(group => tasks.clearDone(group.type)));
      await client.invalidateQueries({ queryKey: ["tasks"] });
    },
  };
}

function since(start: string | null): number {
  const at = start ? Date.parse(start) : NaN;
  return Number.isFinite(at) && at > 0 ? (Date.now() - at) / 1000 : 0;
}

function TaskRow({ type, task, onChange }: { type: TaskType; task: TaskInfo; onChange: () => void }) {
  const failed = task.state === 7 || (task.state >= 5 && !!task.error);
  const done = task.state === 2;
  const live = RUNNING.has(task.state) && !failed;
  const progress = Math.max(0, Math.min(100, task.progress || 0));
  const bytes = task.total_bytes ? task.total_bytes * progress / 100 : 0;
  // Speed from the last two looks at this task, smoothed.
  const sample = useRef<{ bytes: number; at: number; rate: number }>({ bytes, at: Date.now(), rate: 0 });
  const [rate, setRate] = useState(0);
  useEffect(() => {
    const s = sample.current;
    const now = Date.now();
    const dt = (now - s.at) / 1000;
    if (dt > 0.5 && bytes >= s.bytes) {
      const next = s.rate ? s.rate * 0.5 + ((bytes - s.bytes) / dt) * 0.5 : (bytes - s.bytes) / dt;
      sample.current = { bytes, at: now, rate: next };
      setRate(next);
    }
  }, [bytes]);
  const act = (fn: () => Promise<unknown>) => () => void fn().then(onChange).catch(error => toast.error("操作失败", error));
  const elapsed = since(task.start_time);
  const detail = live
    ? [
        `${Math.floor(progress)}%`,
        task.total_bytes ? `${formatBytes(bytes)} / ${formatBytes(task.total_bytes)}` : "",
        rate > 1024 ? formatRate(rate) : "",
        elapsed > 1 ? `已用 ${formatDuration(elapsed)}` : "",
      ].filter(Boolean).join("，")
    : [STATE_LABEL[task.state] ?? String(task.state), task.total_bytes ? formatBytes(task.total_bytes) : "", task.end_time ? formatDate(task.end_time) : ""].filter(Boolean).join("，");
  return (
    <motion.li layout className="rounded-xl px-2 py-2.5" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }} transition={spring.snappy}>
      <div className="flex items-start gap-2.5">
        <span className="mt-[5px] grid size-2.5 shrink-0 place-items-center" aria-hidden>
          {live ? <span className="relative flex size-2"><span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" /><span className="relative size-2 rounded-full bg-accent" /></span>
            : done ? <CheckCircleIcon size={12} weight="fill" className="text-accent-text" />
            : failed ? <WarningCircleIcon size={12} weight="fill" className="text-danger" />
            : <span className="size-2 rounded-full bg-faint" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-all text-[13px] leading-snug">{taskName(task.name)}</p>
          <p className={`mt-0.5 text-[12px] tabular ${failed ? "text-danger" : live ? "text-ink/80" : "text-muted"}`}>
            {live && task.state !== 1 ? `${STATE_LABEL[task.state]}，` : ""}{detail}{task.error ? <span title={task.error}>：{reason(task.error)}</span> : ""}
          </p>
          {live && task.status && <p className="mt-0.5 truncate text-[11.5px] text-faint" title={task.status}>{task.status}</p>}
          {live && <div className="mt-1.5"><Bar value={progress / 100} tone={task.state === 1 ? "accent" : "muted"} /></div>}
        </div>
        {live && <button className="icon-btn size-7" onClick={act(() => tasks.cancel(type, task.id))} aria-label="取消" title="取消"><XIcon size={14} /></button>}
        {failed && <button className="icon-btn size-7" onClick={act(() => tasks.retry(type, task.id))} aria-label="重试" title="重试"><ArrowClockwiseIcon size={14} /></button>}
        {!live && <button className="icon-btn size-7" onClick={act(() => tasks.remove(type, task.id))} aria-label="删除" title="删除"><TrashIcon size={14} /></button>}
      </div>
    </motion.li>
  );
}

type TasksState = ReturnType<typeof useServerTasks>;

/** The list; given the panel's state, or polling on its own (管理 › 任务). */
export function ServerTasks({ state }: { state?: TasksState }) {
  return state ? <TaskList state={state} /> : <OwnTaskList />;
}

function OwnTaskList() {
  return <TaskList state={useServerTasks()} />;
}

/** Downloads 找资源 made, as the server's organizer left them: organized, or waiting for a person. */
function AutoOrganized() {
  const recent = useQuery({ queryKey: ["organize-recent"], queryFn: organize.recent, retry: false,
    refetchInterval: q => (q.state.data?.active.length ? 3000 : 15_000) });
  const items = recent.data?.items ?? [];
  const active = recent.data?.active ?? [];
  if (!items.length && !active.length) return null;
  const open = (path: string): void => { useUi.getState().setTasks(false); navigate(encodePath(path)); };
  return (
    <section>
      <h3 className="px-2 pb-1 text-[12px] font-medium text-muted">自动整理</h3>
      <ul>
        {active.map(item => (
          <li key={`now-${item.path}`}>
            <button className="flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--hover)]" onClick={() => open(item.path)}>
              <CircleNotchIcon size={18} weight="bold" className="spin shrink-0 text-accent-text" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px]">{item.path.slice(item.path.lastIndexOf("/") + 1)}</span>
                <span className="block text-[12px] text-faint">{item.state === "downloading" ? "下载中，完成后马上自动整理" : item.state === "waiting" ? "下载完了，等文件到齐" : "正在自动整理"}</span>
              </span>
            </button>
          </li>
        ))}
        {items.map(item => (
          <li key={item.path} className="flex items-center gap-1">
            <button className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--hover)]" onClick={() => open(item.path)}>
              {item.done ? <CheckCircleIcon size={18} weight="fill" className="shrink-0 text-accent-text" /> : <WarningCircleIcon size={18} weight="fill" className="shrink-0 text-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px]">{item.path.slice(item.path.lastIndexOf("/") + 1)}</span>
                <span className="block text-[12px] text-faint">
                  {item.done ? "已整理好" : needText(item)} · {formatDate(item.at)}
                </span>
              </span>
            </button>
            {item.done && item.batch && (
              <button className="h-8 shrink-0 rounded-lg px-2.5 text-[12.5px] text-muted transition-colors hover:bg-[var(--hover)] hover:text-ink"
                onClick={() => void undoRun(item.batch as string).then(() => recent.refetch())}>撤销</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TaskList({ state }: { state: TasksState }) {
  const { pending, groups, refresh } = state;
  if (pending) return <div className="space-y-2 p-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>;
  if (!groups.length) return <div className="space-y-4"><AutoOrganized /><p className="px-3 py-10 text-center text-muted">没有服务器任务。离线下载、复制、解压都会出现在这里。</p></div>;
  return (
    <div className="space-y-4">
      <AutoOrganized />
      {groups.map(group => (
        <section key={group.type}>
          <h3 className="px-2 pb-1 text-[12px] font-medium text-muted">{group.label}</h3>
          <ul><AnimatePresence initial={false}>{group.list.map(task => <TaskRow key={task.id} type={group.type} task={task} onChange={() => void refresh()} />)}</AnimatePresence></ul>
        </section>
      ))}
    </div>
  );
}

/** The one 清除已结束 style, for uploads and server tasks alike. */
function ClearButton({ onClick }: { onClick: () => void }) {
  return <button className="h-8 rounded-lg px-2.5 text-[12.5px] text-muted transition-colors hover:bg-[var(--hover)] hover:text-ink" onClick={onClick}>清除已结束</button>;
}

/**
 * Uploads left unfinished (the browser was closed, the network dropped): the
 * chunks already sent wait on the server. Picking the same file again sends
 * only what is missing.
 */
function Unfinished() {
  const list = useUploads(state => state.resumable);
  const resume = useUploads(state => state.resume);
  const discard = useUploads(state => state.discard);
  const [shake, setShake] = useState("");
  if (!list.length) return null;
  const pick = (item: StagedSnapshot): void => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (resume(item, file)) toast.success("接着传", `${item.name}，从 ${formatBytes(item.received_bytes)} 处继续`);
      else { setShake(item.upload_id); window.setTimeout(() => setShake(""), 500); toast.error("不是同一个文件", `要选「${item.name}」，${formatBytes(item.size)}`); }
    };
    input.click();
  };
  return (
    <section className="mb-2">
      <h3 className="px-2 pb-1 pt-1.5 text-[12px] font-medium text-muted">没传完的</h3>
      <ul>
        <AnimatePresence initial={false}>
          {list.map(item => {
            const fraction = item.size ? item.received_bytes / item.size : 0;
            return (
              <motion.li key={item.upload_id} layout className="flex items-center gap-3 rounded-xl px-2 py-2.5"
                initial={{ opacity: 0, y: 10 }} animate={shake === item.upload_id ? { x: [0, -8, 7, -4, 0] } : { opacity: 1, y: 0, x: 0 }}
                exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }} transition={spring.snappy}>
                <span className="relative grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text"><PauseIcon size={16} weight="fill" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium" title={item.path}>{item.name}</p>
                  <p className="text-[12px] text-muted tabular">{formatBytes(item.received_bytes)} / {formatBytes(item.size)}，{formatDate(item.updated)}</p>
                  <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-[var(--hover)]">
                    <motion.div className="h-full origin-left rounded-full bg-accent" initial={{ scaleX: 0 }} animate={{ scaleX: fraction }} transition={spring.soft} />
                  </div>
                </div>
                <button className="btn btn-primary h-8 shrink-0 px-3 text-[12.5px]" onClick={() => pick(item)}><PlayIcon size={13} weight="fill" />继续</button>
                <button className="icon-btn size-8 shrink-0" aria-label="放弃" title="放弃，删掉已传的部分" onClick={() => void discard(item.upload_id)}><XIcon size={14} /></button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      <p className="px-2 pb-2 text-[11.5px] text-faint">已传的部分在服务器上保留 3 天，选同一个文件就从断开处接着传。</p>
    </section>
  );
}

export function Transfers() {
  const open = useUi(state => state.uploads);
  const mobile = useIsMobile();
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.aside
          key="transfers"
          className="glass fixed z-40 flex flex-col overflow-hidden hairline max-sm:inset-x-2 max-sm:bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] max-sm:max-h-[60dvh] sm:bottom-24 sm:right-6 sm:max-h-[min(560px,70dvh)] sm:w-[380px]"
          style={{ borderRadius: 20, boxShadow: "var(--shadow-float)", transformOrigin: mobile ? "50% 100%" : "80% 100%" }}
          initial={{ opacity: 0, scale: 0.9, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 16, transition: { duration: 0.16 } }}
          transition={spring.sheet}
        >
          <Panel />
        </motion.aside>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** The open panel: server tasks poll only while it is open, once for the tab count, the clear button and the list. */
function Panel() {
  const setOpen = useUi(state => state.setUploads);
  const jobs = useUploads(state => state.jobs);
  const unfinished = useUploads(state => state.resumable.length);
  const clearFinished = useUploads(state => state.clearFinished);
  const server = useServerTasks();
  const [tab, setTab] = useState<"local" | "server">(() => !jobs.length && !unfinished ? "server" : "local");
  return (
    <>
      <header className="flex items-center gap-1 border-b border-line p-2">
        {(["local", "server"] as const).map(key => (
          <button key={key} className={`relative h-8 rounded-lg px-3 text-[13px] font-medium ${tab === key ? "text-ink" : "text-muted"}`} onClick={() => setTab(key)}>
            {tab === key && <motion.span layoutId="transfer-tab" className="absolute inset-0 rounded-lg bg-[var(--hover)]" transition={spring.snappy} />}
            <span className="relative">
              {key === "local"
                ? `上传${jobs.length + unfinished ? ` ${jobs.length + unfinished}` : ""}`
                : <>服务器任务{server.running ? <span className="ml-1 text-accent-text tabular">{server.running}</span> : null}</>}
            </span>
          </button>
        ))}
        <span className="flex-1" />
        {tab === "local" && jobs.some(job => job.state !== "running" && job.state !== "queued") && <ClearButton onClick={clearFinished} />}
        {tab === "server" && server.finished && <ClearButton onClick={() => void server.clearFinished().catch(error => toast.error("没有清除", error))} />}
        <button className="icon-btn size-8" onClick={() => setOpen(false)} aria-label="关闭"><XIcon size={15} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === "local" ? (
          <>
            <Unfinished />
            {jobs.length ? <ul><AnimatePresence initial={false}>{[...jobs].reverse().map(job => <JobRow key={job.id} job={job} />)}</AnimatePresence></ul>
              : !unfinished && <p className="px-3 py-10 text-center text-muted">还没有上传。把文件拖进窗口即可开始。</p>}
          </>
        ) : <ServerTasks state={server} />}
      </div>
    </>
  );
}
