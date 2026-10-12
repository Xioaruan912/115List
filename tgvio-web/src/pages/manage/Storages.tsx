import { ArrowClockwiseIcon, HardDrivesIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon, TrashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { drivers, storages } from "../../api/admin";
import { Sheet } from "../../components/Sheet";
import { formatDate } from "../../lib/format";
import { spring } from "../../lib/motion";
import type { DriverInfo, Storage } from "../../lib/types";
import { toast } from "../../stores/toast";
import { coerce, Field, PageHeader, type FieldSpec } from "./Form";

type Values = Record<string, unknown>;

function initialValues(info: DriverInfo, storage: Storage | null): { common: Values; addition: Values } {
  const common: Values = {};
  const addition: Values = {};
  let saved: Values = {};
  try { saved = storage?.addition ? JSON.parse(storage.addition) as Values : {}; } catch { saved = {}; }
  for (const item of info.common) common[item.name] = storage ? storage[item.name] ?? item.default : item.default;
  for (const item of info.additional) addition[item.name] = item.name in saved ? saved[item.name] : item.default;
  if (!storage && info.config.default_root && "root_folder_path" in addition && !addition.root_folder_path) addition.root_folder_path = info.config.default_root;
  return { common, addition };
}

function Editor({ storage, onClose }: { storage: Storage | null; onClose: () => void }) {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ["drivers"], queryFn: drivers.list, staleTime: Infinity });
  const [driver, setDriver] = useState(storage?.driver ?? "");
  const [filter, setFilter] = useState("");
  const info = driver ? list.data?.[driver] : undefined;
  const [values, setValues] = useState<{ common: Values; addition: Values } | null>(null);
  const [busy, setBusy] = useState(false);
  const current = values ?? (info ? initialValues(info, storage) : null);

  const pick = (name: string): void => {
    setDriver(name);
    const next = list.data?.[name];
    setValues(next ? initialValues(next, null) : null);
  };

  const missing = info && current ? [...info.common, ...info.additional].filter(item => item.required && item.type !== "bool"
    && String((item.name in current.common ? current.common : current.addition)[item.name] ?? "").trim() === "") : [];

  const save = async (): Promise<void> => {
    if (!info || !current) return;
    setBusy(true);
    try {
      const body: Partial<Storage> = { ...(storage ?? {}), driver };
      for (const item of info.common) (body as Values)[item.name] = coerce(item.type, current.common[item.name]);
      const addition: Values = {};
      for (const item of info.additional) addition[item.name] = coerce(item.type, current.addition[item.name]);
      body.addition = JSON.stringify(addition);
      if (storage) await storages.update(body);
      else await storages.create(body);
      toast.success(storage ? "已保存存储" : "已添加存储", String(body.mount_path));
      await client.invalidateQueries({ queryKey: ["storages"] });
      onClose();
    } catch (error) {
      toast.error("保存失败", error);
      await client.invalidateQueries({ queryKey: ["storages"] });
    } finally {
      setBusy(false);
    }
  };

  const names = useMemo(() => Object.keys(list.data ?? {}).sort((a, b) => a.localeCompare(b)).filter(name => name.toLowerCase().includes(filter.toLowerCase())), [list.data, filter]);

  return (
    <Sheet open onClose={onClose} width={720} title={storage ? `编辑 ${storage.mount_path}` : driver ? `添加 ${driver}` : "选择存储驱动"}
      footer={driver ? <>
        {!storage && <button className="btn btn-ghost mr-auto" onClick={() => { setDriver(""); setValues(null); }}>换驱动</button>}
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={busy || !!missing?.length} onClick={() => void save()}>{busy ? "保存中…" : "保存"}</button>
      </> : undefined}>
      <AnimatePresence mode="wait" initial={false}>
        {!driver ? (
          <motion.div key="pick" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={spring.snappy}>
            <div className="relative mb-3">
              <MagnifyingGlassIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input className="field pl-9" placeholder="搜索驱动" autoFocus value={filter} onChange={event => setFilter(event.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {list.isPending && Array.from({ length: 12 }, (_, i) => <div key={i} className="skeleton h-11 rounded-xl" />)}
              {names.map((name, index) => (
                <button key={name} className="enter flex h-11 items-center gap-2 rounded-xl px-3 text-left text-[13.5px] hairline hover:bg-[var(--hover)]"
                  style={{ "--i": Math.min(index, 24) } as React.CSSProperties} onClick={() => pick(name)}>
                  <HardDrivesIcon size={16} className="shrink-0 text-muted" /><span className="truncate">{name}</span>
                </button>
              ))}
            </div>
          </motion.div>
        ) : !info || !current ? (
          <div key="loading" className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
        ) : (
          <motion.div key="form" className="flex flex-col gap-6" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={spring.snappy}>
            {typeof info.config.alert === "string" && info.config.alert && (
              <p className="rounded-xl bg-surface px-4 py-3 text-[13px] text-muted hairline">{String(info.config.alert).replace(/^\w+\|/, "")}</p>
            )}
            <section className="grid gap-4">
              <h3 className="text-[13px] font-semibold text-muted">通用</h3>
              {info.common.map(item => (
                <Field key={item.name} spec={item as FieldSpec} value={current.common[item.name]}
                  onChange={value => setValues({ ...current, common: { ...current.common, [item.name]: value } })} />
              ))}
            </section>
            {info.additional.length > 0 && (
              <section className="grid gap-4 border-t border-line pt-5">
                <h3 className="text-[13px] font-semibold text-muted">{driver} 选项</h3>
                {info.additional.map(item => (
                  <Field key={item.name} spec={item as FieldSpec} value={current.addition[item.name]}
                    onChange={value => setValues({ ...current, addition: { ...current.addition, [item.name]: value } })} />
                ))}
              </section>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}

function StatusDot({ storage }: { storage: Storage }) {
  const ok = storage.status === "work";
  const tone = storage.disabled ? "bg-faint" : ok ? "bg-accent" : "bg-danger";
  return (
    <span className="relative grid size-2.5 place-items-center">
      {!storage.disabled && ok && <span className="absolute size-2.5 animate-ping rounded-full bg-accent opacity-40 [animation-duration:2.4s]" />}
      <span className={`relative size-2 rounded-full ${tone}`} />
    </span>
  );
}

export default function Storages() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["storages"], queryFn: storages.list });
  const [editing, setEditing] = useState<Storage | null | "new">(null);
  const [confirm, setConfirm] = useState<Storage | null>(null);
  const [reloading, setReloading] = useState(false);
  const list = useMemo(() => [...(query.data?.content ?? [])].sort((a, b) => a.order - b.order || a.mount_path.localeCompare(b.mount_path)), [query.data]);

  const toggle = async (storage: Storage): Promise<void> => {
    client.setQueryData(["storages"], { ...query.data, content: list.map(item => item.id === storage.id ? { ...item, disabled: !item.disabled } : item) });
    try {
      await (storage.disabled ? storages.enable(storage.id) : storages.disable(storage.id));
      toast.success(storage.disabled ? "已启用" : "已停用", storage.mount_path);
    } catch (error) { toast.error("操作失败", error); }
    await client.invalidateQueries({ queryKey: ["storages"] });
  };

  return (
    <div>
      <PageHeader title="存储" detail={query.data ? `${list.length} 个挂载，${list.filter(item => item.status !== "work" && !item.disabled).length} 个异常` : " "}>
        <button className="btn btn-line" disabled={reloading} onClick={async () => {
          setReloading(true);
          try { await storages.reloadAll(); toast.success("已重新加载全部存储"); } catch (error) { toast.error("重新加载失败", error); }
          setReloading(false);
          void client.invalidateQueries({ queryKey: ["storages"] });
        }}><ArrowClockwiseIcon size={16} className={reloading ? "spin" : ""} />重新加载</button>
        <button className="btn btn-primary" onClick={() => setEditing("new")}><PlusIcon size={16} weight="bold" />添加</button>
      </PageHeader>

      {query.isPending && <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-[72px] rounded-[var(--radius-tile)]" />)}</div>}
      {query.isError && <p className="text-danger">{query.error.message}</p>}
      <motion.ul layout className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {list.map((storage, index) => (
            <motion.li key={storage.id} layout className="spot group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-[var(--radius-tile)] bg-surface px-4 py-3.5 hairline"
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: storage.disabled ? 0.6 : 1, y: 0, transition: { ...spring.snappy, delay: Math.min(index, 12) * 0.03 } }}
              exit={{ opacity: 0, scale: 0.96 }} transition={spring.snappy}
              onPointerMove={event => { const r = event.currentTarget.getBoundingClientRect(); event.currentTarget.style.setProperty("--mx", `${event.clientX - r.left}px`); event.currentTarget.style.setProperty("--my", `${event.clientY - r.top}px`); }}>
              <StatusDot storage={storage} />
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate font-medium">
                  <span className="truncate">{storage.mount_path}</span>
                  <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] font-normal text-muted hairline">{storage.driver}</span>
                </p>
                <p className={`mt-0.5 truncate text-[12.5px] ${storage.status !== "work" && !storage.disabled ? "text-danger" : "text-muted"}`}>
                  {storage.disabled ? "已停用" : storage.status === "work" ? `正常，${formatDate(storage.modified)}更新` : <><WarningCircleIcon size={13} className="mr-1 inline" />{storage.status}</>}
                  {storage.remark ? `，${storage.remark}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button role="switch" aria-checked={!storage.disabled} aria-label={storage.disabled ? "启用" : "停用"} className="switch mr-2" onClick={() => void toggle(storage)} />
                <button className="icon-btn" aria-label="编辑" onClick={() => setEditing(storage)}><PencilSimpleIcon size={17} /></button>
                <button className="icon-btn hover:text-danger" aria-label="删除" onClick={() => setConfirm(storage)}><TrashIcon size={17} /></button>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ul>

      <AnimatePresence>
        {editing && <Editor key="editor" storage={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
        {confirm && (
          <Sheet key="confirm" open onClose={() => setConfirm(null)} title="删除这个存储？"
            footer={<><button className="btn btn-ghost" onClick={() => setConfirm(null)}>取消</button>
              <button className="btn btn-danger" onClick={async () => {
                const target = confirm;
                setConfirm(null);
                try { await storages.remove(target.id); toast.success("已删除存储", target.mount_path); } catch (error) { toast.error("删除失败", error); }
                void client.invalidateQueries({ queryKey: ["storages"] });
              }}>删除</button></>}>
            <p className="text-muted">只移除挂载 <span className="font-medium text-ink">{confirm.mount_path}</span>，不会删除存储里的文件。</p>
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  );
}
