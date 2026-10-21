import { DesktopIcon, DeviceMobileIcon, DeviceTabletIcon, LaptopIcon, QuestionIcon, SignOutIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { devices, type Device } from "../api/devices";
import { formatDate } from "../lib/format";
import { spring } from "../lib/motion";
import { toast } from "../stores/toast";
import { ErrorState } from "./ErrorState";

/**
 * Signed-in devices. Each sign-in is one device; it stays signed in while it is
 * used and drops off after the idle limit. The current one is marked and cannot
 * be signed out from here (that is 退出登录). userId set: an admin's view of
 * someone else's devices.
 */

function DeviceIcon({ device }: { device: string }) {
  const Icon = /iPhone|手机/.test(device) ? DeviceMobileIcon : /iPad|平板/.test(device) ? DeviceTabletIcon
    : /Mac|Chromebook/.test(device) ? LaptopIcon : /Windows|Linux/.test(device) ? DesktopIcon : QuestionIcon;
  return <Icon size={20} weight="duotone" />;
}

function Row({ item, index, onRevoke }: { item: Device; index: number; onRevoke?: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <motion.li layout className={`flex items-center gap-3 rounded-[var(--radius-tile)] px-3 py-2.5 ${item.current ? "bg-accent-soft" : "bg-surface hairline"}`}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { ...spring.snappy, delay: Math.min(index, 10) * 0.04 } }}
      exit={{ opacity: 0, x: 40, scale: 0.95, transition: { duration: 0.22 } }}>
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${item.current ? "bg-accent text-accent-ink" : "bg-raised text-muted hairline"}`}>
        <DeviceIcon device={item.device} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">
          {item.device} · {item.browser}
          {item.current && <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 align-[1px] text-[10.5px] font-semibold text-accent-ink">这台</span>}
        </p>
        <p className="truncate text-[12px] text-muted tabular">{item.current ? "正在使用" : `${formatDate(item.last_seen)}用过`}，{item.ip || "未知地址"}，{formatDate(item.created)}登录</p>
      </div>
      {onRevoke && !item.current && (
        <button className={`btn h-8 shrink-0 px-3 text-[12.5px] ${armed ? "btn-danger" : "btn-line"}`} disabled={busy} onBlur={() => setArmed(false)}
          onClick={async () => {
            if (!armed) { setArmed(true); return; }
            setBusy(true);
            try { await onRevoke(); } finally { setBusy(false); setArmed(false); }
          }}>
          <SignOutIcon size={14} />{armed ? "确定退出" : "退出"}
        </button>
      )}
    </motion.li>
  );
}

export function DeviceList({ userId }: { userId?: number }) {
  const client = useQueryClient();
  const key = ["devices", userId ?? "me"];
  const query = useQuery({ queryKey: key, queryFn: () => userId === undefined ? devices.mine() : devices.ofUser(userId), staleTime: 15_000 });
  const refresh = (): Promise<void> => client.invalidateQueries({ queryKey: key });
  const list = query.data?.devices ?? [];
  const others = list.filter(item => !item.current).length;
  const revoke = async (item: Device): Promise<void> => {
    try {
      await (userId === undefined ? devices.revoke(item.id) : devices.adminRevoke(item.id));
      toast.success("已退出", `${item.device} · ${item.browser}`);
    } catch (error) { toast.error("没有退出", error); }
    await refresh();
  };
  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-medium">登录的设备{list.length ? <span className="ml-1.5 text-muted tabular">{list.length}</span> : null}</h3>
          {query.data && <p className="mt-0.5 text-[12px] text-muted">一直在用就一直有效，{query.data.idle_days} 天没用的设备要重新登录。</p>}
        </div>
        {others > 0 && (
          <button className="btn btn-ghost h-8 shrink-0 px-2.5 text-[12.5px] text-danger" onClick={async () => {
            try {
              const r = await (userId === undefined ? devices.revokeOthers() : devices.adminRevokeAll(userId));
              toast.success(userId === undefined ? "其他设备都已退出" : "这个用户的设备都已退出", `${r.revoked} 台`);
            } catch (error) { toast.error("没有退出", error); }
            await refresh();
          }}><SignOutIcon size={14} />{userId === undefined ? "退出其他设备" : "全部退出"}</button>
        )}
      </div>
      {query.isPending && <div className="space-y-2">{[0, 1].map(i => <div key={i} className="skeleton h-[60px] rounded-[var(--radius-tile)]" />)}</div>}
      {query.isError && <ErrorState compact error={query.error} onRetry={() => query.refetch()} />}
      {query.data && !list.length && <p className="py-3 text-[13px] text-muted">没有登录中的设备。</p>}
      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {list.map((item, index) => <Row key={item.id} item={item} index={index} onRevoke={() => revoke(item)} />)}
        </AnimatePresence>
      </ul>
    </section>
  );
}

const IDLE: [number, string][] = [[30, "30 天"], [90, "90 天"], [180, "半年"], [365, "一年"], [3650, "不过期"]];

/** Admin: how long an unused device stays signed in. */
export function SessionSettings() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["session-config"], queryFn: devices.config });
  const current = query.data?.idle_days ?? 90;
  return (
    <section className="rounded-[var(--radius-sheet)] bg-surface px-5 py-5 hairline">
      <p className="text-[14px] font-medium">设备多久不用要重新登录</p>
      <p className="mt-0.5 max-w-[56ch] text-[12.5px] leading-relaxed text-muted">每台设备只要还在用就一直保持登录，重启服务器也不会掉。只有超过这个时间没打开过，才需要重新输入密码。改密码会让所有设备退出。</p>
      <div className="mt-4 grid grid-cols-5 rounded-[12px] bg-bg p-1 hairline sm:max-w-md" role="radiogroup">
        {IDLE.map(([days, label]) => {
          const active = current === days;
          return (
            <button key={days} type="button" role="radio" aria-checked={active} className={`relative h-8 rounded-[9px] text-[12.5px] font-medium transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}
              onClick={async () => {
                if (active) return;
                try { client.setQueryData(["session-config"], await devices.setConfig(days)); toast.success("已保存", `不用超过 ${label === "不过期" ? "十年" : label}才要重新登录`); }
                catch (error) { toast.error("没有保存", error); }
              }}>
              {active && <motion.span layoutId="idle-days" className="absolute inset-0 rounded-[9px] bg-raised" style={{ boxShadow: "var(--shadow-lift)" }} transition={spring.pop} />}
              <span className="relative">{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
