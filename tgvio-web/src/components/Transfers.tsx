import { ArrowClockwiseIcon, CheckCircleIcon, PauseIcon, TrashIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { tasks, TASK_TYPES, type TaskType } from "../api/admin";
import { useIsMobile } from "../hooks/useMedia";
import { formatBytes, formatRate } from "../lib/format";
import { kindOf } from "../lib/kind";
import { spring } from "../lib/motion";
import type { TaskInfo } from "../lib/types";
import { toast } from "../stores/toast";
import { useUi } from "../stores/ui";
import { useUploads, type UploadJob } from "../stores/uploads";
import { KindIcon } from "./KindIcon";

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
  else status = <span className="text-danger">{job.error}</span>;
  return (
    <motion.li layout className="flex items-center gap-3 rounded-xl px-2 py-2.5" initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }} transition={spring.snappy}>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-muted hairline">
        {job.state === "done" ? <motion.span initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={spring.bouncy}><CheckCircleIcon size={18} weight="fill" className="text-accent-text" /></motion.span>
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

function TaskRow({ type, task }: { type: TaskType; task: TaskInfo }) {
  const client = useQueryClient();
  const refresh = (): void => void client.invalidateQueries({ queryKey: ["tasks"] });
  const failed = task.state === 7 || (task.state >= 5 && !!task.error);
  const done = task.state === 2;
  const act = (fn: () => Promise<unknown>) => () => void fn().then(refresh).catch(error => toast.error("操作失败", error));
  return (
    <motion.li layout className="rounded-xl px-2 py-2.5" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-all text-[13px] leading-snug">{task.name}</p>
        {!done && !failed && <button className="icon-btn size-7" onClick={act(() => tasks.cancel(type, task.id))} aria-label="取消"><PauseIcon size={14} /></button>}
        {failed && <button className="icon-btn size-7" onClick={act(() => tasks.retry(type, task.id))} aria-label="重试"><ArrowClockwiseIcon size={14} /></button>}
        {(done || failed || task.state === 4) && <button className="icon-btn size-7" onClick={act(() => tasks.remove(type, task.id))} aria-label="删除"><TrashIcon size={14} /></button>}
      </div>
      <p className={`mt-0.5 text-[12px] tabular ${failed ? "text-danger" : "text-muted"}`}>
        {STATE_LABEL[task.state] ?? task.state}{task.total_bytes ? `，${formatBytes(task.total_bytes)}` : ""}{task.status ? `，${task.status}` : ""}{task.error ? `：${task.error}` : ""}
      </p>
      {!done && !failed && <div className="mt-1.5"><Bar value={task.progress / 100} /></div>}
    </motion.li>
  );
}

export function ServerTasks() {
  const results = useQueries({
    queries: TASK_TYPES.map(([type]) => ({
      queryKey: ["tasks", type],
      queryFn: async () => [...(await tasks.undone(type) ?? []), ...(await tasks.done(type) ?? [])],
      refetchInterval: 2500,
      retry: false,
    })),
  });
  const client = useQueryClient();
  const groups = TASK_TYPES.map(([type, label], index) => ({ type, label, list: results[index].data ?? [] })).filter(group => group.list.length);
  if (results.every(result => result.isPending)) return <div className="space-y-2 p-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>;
  if (!groups.length) return <p className="px-3 py-10 text-center text-muted">没有服务器任务</p>;
  return (
    <div className="space-y-4">
      {groups.map(group => (
        <section key={group.type}>
          <div className="flex items-center justify-between px-2 pb-1">
            <h3 className="text-[12.5px] font-medium text-muted">{group.label}</h3>
            <button className="text-[12px] text-faint hover:text-ink" onClick={() => void tasks.clearDone(group.type).then(() => client.invalidateQueries({ queryKey: ["tasks"] }))}>清除已结束</button>
          </div>
          <ul><AnimatePresence initial={false}>{group.list.map(task => <TaskRow key={task.id} type={group.type} task={task} />)}</AnimatePresence></ul>
        </section>
      ))}
    </div>
  );
}

export function Transfers() {
  const open = useUi(state => state.uploads);
  const setOpen = useUi(state => state.setUploads);
  const jobs = useUploads(state => state.jobs);
  const clearFinished = useUploads(state => state.clearFinished);
  const mobile = useIsMobile();
  const [tab, setTab] = useState<"local" | "server">("local");
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
          <header className="flex items-center gap-1 border-b border-line p-2">
            {(["local", "server"] as const).map(key => (
              <button key={key} className={`relative h-8 rounded-lg px-3 text-[13px] font-medium ${tab === key ? "text-ink" : "text-muted"}`} onClick={() => setTab(key)}>
                {tab === key && <motion.span layoutId="transfer-tab" className="absolute inset-0 rounded-lg bg-[var(--hover)]" transition={spring.snappy} />}
                <span className="relative">{key === "local" ? `上传${jobs.length ? ` ${jobs.length}` : ""}` : "服务器任务"}</span>
              </button>
            ))}
            <span className="flex-1" />
            {tab === "local" && jobs.some(job => job.state !== "running" && job.state !== "queued") && (
              <button className="h-8 rounded-lg px-2 text-[12.5px] text-muted hover:text-ink" onClick={clearFinished}>清除已结束</button>
            )}
            <button className="icon-btn size-8" onClick={() => setOpen(false)} aria-label="关闭"><XIcon size={15} /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {tab === "local" ? (
              jobs.length ? <ul><AnimatePresence initial={false}>{[...jobs].reverse().map(job => <JobRow key={job.id} job={job} />)}</AnimatePresence></ul>
                : <p className="px-3 py-10 text-center text-muted">还没有上传。把文件拖进窗口即可开始。</p>
            ) : <ServerTasks />}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>,
    document.body,
  );
}
