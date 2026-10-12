import { ArrowClockwiseIcon, BroomIcon, CheckIcon, RecycleIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { useMemo, useState } from "react";
import { storages, tgvio } from "../../api/admin";
import { NumberRoll } from "../../components/NumberRoll";
import { Sheet } from "../../components/Sheet";
import { formatBytes, formatDate, formatDuration } from "../../lib/format";
import { spring } from "../../lib/motion";
import type { RecycleItem } from "../../lib/types";
import { toast } from "../../stores/toast";
import { PageHeader } from "./Form";
import { ErrorState } from "../../components/ErrorState";
import { rawMessage, reason } from "../../lib/errors";

function Quota({ used, total }: { used: number; total: number }) {
  const fraction = total ? used / total : 0;
  const size = 168;
  const stroke = 12;
  const r = (size - stroke) / 2;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke} strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: fraction }} transition={{ type: "spring", stiffness: 40, damping: 16, delay: 0.2 }} />
      </svg>
      <div className="absolute text-center">
        <p className="text-[30px] font-semibold tracking-[-0.03em]"><NumberRoll value={fraction * 100} format={n => n.toFixed(1)} />%</p>
        <p className="text-[12px] text-muted">已用</p>
      </div>
    </div>
  );
}

function Stat({ label, value, index }: { label: string; value: React.ReactNode; index: number }) {
  return (
    <motion.div className="border-t border-line pt-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { ...spring.snappy, delay: 0.1 + index * 0.04 } }}>
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className="mt-0.5 text-[20px] font-semibold tracking-tight tabular">{value}</p>
    </motion.div>
  );
}

function Recycle() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["recycle"], queryFn: () => tgvio.recycle(0, 200), retry: false, staleTime: 60_000 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const chosen = items.filter(item => selected.has(item.id));
  const bytes = chosen.reduce((sum, item) => sum + item.size, 0);
  const toggle = (item: RecycleItem): void => setSelected(state => { const next = new Set(state); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; });
  if (query.isError) return <ErrorState compact error={query.error} title="回收站暂时打不开" onRetry={() => query.refetch()} />;
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight"><RecycleIcon size={18} />115 回收站</h3>
          <p className="text-[12.5px] text-muted">{query.data ? `本页 ${items.length} 项，${formatBytes(query.data.page_bytes)}${query.data.has_more ? "，还有更多" : ""}` : "读取中"}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-line" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map(item => item.id)))} disabled={!items.length}>
            {selected.size === items.length && items.length ? "全不选" : "全选本页"}
          </button>
          <button className="btn btn-danger" disabled={!chosen.length || busy} onClick={() => setConfirm(true)}>
            <BroomIcon size={16} />清理{chosen.length ? ` ${chosen.length} 项` : ""}
          </button>
        </div>
      </div>
      {query.isPending && <div className="space-y-1.5">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-11 rounded-xl" />)}</div>}
      {query.data && !items.length && <p className="py-6 text-muted">回收站是空的。</p>}
      <ul className="max-h-[420px] overflow-y-auto rounded-[var(--radius-tile)] hairline">
        <AnimatePresence initial={false}>
          {items.map((item, index) => {
            const on = selected.has(item.id);
            return (
              <motion.li key={item.id} layout exit={{ opacity: 0, x: 60, transition: { duration: 0.2 } }}>
                <button className={`flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-0 ${on ? "bg-accent-soft" : "hover:bg-[var(--hover)]"} ${index < 30 ? "enter" : ""}`}
                  style={{ "--i": index } as React.CSSProperties} onClick={() => toggle(item)}>
                  <span className={`grid size-5 shrink-0 place-items-center rounded-md transition-colors ${on ? "bg-accent text-accent-ink" : "hairline"}`}>{on && <CheckIcon size={12} weight="bold" />}</span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{item.name}</span>
                  <span className="shrink-0 text-[12px] text-muted tabular">{formatBytes(item.size)}</span>
                  <span className="hidden w-28 shrink-0 text-right text-[12px] text-faint tabular sm:block">{formatDate(item.deleted_at * 1000)}</span>
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      <AnimatePresence>
        {confirm && (
          <CleanSheet key="confirm" count={chosen.length} bytes={bytes} onClose={() => setConfirm(false)}
            onClean={async password => {
              setBusy(true);
              try {
                await tgvio.clean(chosen.map(item => item.id), password);
                toast.success("已清理", formatBytes(bytes));
                setSelected(new Set());
                setConfirm(false);
              } finally {
                setBusy(false);
                void client.invalidateQueries({ queryKey: ["recycle"] });
                void client.invalidateQueries({ queryKey: ["tgvio-stats"] });
              }
            }} />
        )}
      </AnimatePresence>
    </section>
  );
}

const KEY_STORE = "tgvio-web:115-key";

/**
 * 115 only empties its recycle bin with the account's six-digit security key
 * (安全密钥) when one is set. It is asked for here, kept for this browser
 * session only, and sent straight through to the drive.
 */
function CleanSheet({ count, bytes, onClose, onClean }: { count: number; bytes: number; onClose: () => void; onClean: (password: string) => Promise<void> }) {
  const [key, setKey] = useState(() => sessionStorage.getItem(KEY_STORE) ?? "");
  const [problem, setProblem] = useState("");
  const [working, setWorking] = useState(false);
  const [scope, animateField] = useAnimate<HTMLLabelElement>();
  const submit = async (): Promise<void> => {
    setWorking(true);
    setProblem("");
    try {
      await onClean(key.trim());
      if (key.trim()) sessionStorage.setItem(KEY_STORE, key.trim());
    } catch (error) {
      const wrongKey = /密钥|key/i.test(rawMessage(error));
      setProblem(wrongKey ? (key ? "安全密钥不对，再输入一次" : "这个 115 账户设了安全密钥，请先输入") : reason(error));
      if (wrongKey) sessionStorage.removeItem(KEY_STORE);
      if (scope.current) void animateField(scope.current, { x: [0, -10, 9, -6, 3, 0] }, { duration: 0.45 });
    }
    setWorking(false);
  };
  return (
    <Sheet open onClose={onClose} title={`永久删除 ${count} 项？`}
      footer={<><button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-danger" disabled={working} onClick={() => void submit()}>{working ? "正在清理…" : "永久删除"}</button></>}>
      <p className="text-muted">从 115 回收站彻底删除，共 {formatBytes(bytes)}，无法恢复。</p>
      <label ref={scope} className="mt-5 block">
        <span className="label">115 安全密钥</span>
        <input className="field font-mono tracking-[0.4em]" type="password" inputMode="numeric" autoComplete="off" maxLength={6} placeholder="6 位数字，没设置就留空"
          value={key} onChange={event => setKey(event.target.value.replace(/\D/g, ""))} onKeyDown={event => { if (event.key === "Enter") void submit(); }} aria-invalid={!!problem} />
        <AnimatePresence>
          {problem && <motion.span className="mt-2 block text-[12.5px] text-danger" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{problem}</motion.span>}
        </AnimatePresence>
        <span className="mt-1.5 block text-[12.5px] text-faint">在 115 的 账号安全 里设置的那个，只在本次浏览中记住。</span>
      </label>
    </Sheet>
  );
}

export default function Overview() {
  const stats = useQuery({ queryKey: ["tgvio-stats"], queryFn: tgvio.stats, refetchInterval: 15_000, retry: false });
  const mounts = useQuery({ queryKey: ["storages"], queryFn: storages.list });
  const client = useQueryClient();
  const list = mounts.data?.content ?? [];
  const broken = list.filter(item => !item.disabled && item.status !== "work").length;
  const space = stats.data?.space;
  const counters = Object.entries(stats.data?.counters ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const state = Object.entries(stats.data?.state ?? {});
  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="概览" detail={stats.data ? `运行 ${formatDuration(stats.data.uptime_seconds)}` : " "}>
        <button className="btn btn-line" onClick={() => void client.invalidateQueries({ queryKey: ["tgvio-stats"] })}><ArrowClockwiseIcon size={16} />刷新</button>
      </PageHeader>

      <section className="grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)]">
        {space?.total_bytes ? <Quota used={space.used_bytes ?? 0} total={space.total_bytes} /> : (
          <div className="grid size-[168px] place-items-center rounded-full text-center text-[12.5px] text-muted hairline">{space?.error ?? (stats.isError ? "统计接口不可用" : "读取中")}</div>
        )}
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
          <Stat index={0} label="网盘总量" value={space?.total_bytes ? formatBytes(space.total_bytes) : "-"} />
          <Stat index={1} label="已用" value={space?.used_bytes ? formatBytes(space.used_bytes) : "-"} />
          <Stat index={2} label="剩余" value={space?.free_bytes ? formatBytes(space.free_bytes) : "-"} />
          <Stat index={3} label="存储挂载" value={<>{list.length}{broken ? <span className="ml-2 text-[13px] font-medium text-danger">{broken} 异常</span> : null}</>} />
        </div>
      </section>

      {(counters.length > 0 || state.length > 0) && (
        <section>
          <h3 className="mb-3 text-[17px] font-semibold tracking-tight">115 访问统计</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
            {counters.map(([key, value], index) => <Stat key={key} index={index} label={key} value={<NumberRoll value={value} format={n => Math.round(n).toLocaleString()} />} />)}
            {state.map(([key, value], index) => (
              <Stat key={key} index={counters.length + index} label={key} value={<span className="text-[14px] font-medium">{typeof value === "object" ? JSON.stringify(value) : String(value)}</span>} />
            ))}
          </div>
        </section>
      )}

      <Recycle />
    </div>
  );
}
