import { PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { LockKeyIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { metas } from "../../api/admin";
import { FolderLock } from "./Users";
import { hasBit, Perm } from "../../lib/perm";
import { useSession } from "../../stores/session";
import { Sheet } from "../../components/Sheet";
import { spring } from "../../lib/motion";
import type { Meta } from "../../lib/types";
import { toast } from "../../stores/toast";
import { PageHeader } from "./Form";

const EMPTY: Partial<Meta> = { path: "/", password: "", p_sub: true, write: false, w_sub: false, hide: "", h_sub: false, readme: "", r_sub: false, header: "", header_sub: false };

function Sub({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className="flex items-center gap-2 text-[12.5px] text-muted" onClick={() => onChange(!on)}>
      <span role="switch" aria-checked={on} className="switch scale-75" />应用到子文件夹
    </button>
  );
}

function Editor({ meta, onClose }: { meta: Meta | null; onClose: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState<Partial<Meta>>(meta ?? EMPTY);
  const set = (patch: Partial<Meta>): void => setForm(state => ({ ...state, ...patch }));
  const save = async (): Promise<void> => {
    try {
      if (meta) await metas.update(form); else await metas.create(form);
      toast.success("已保存元信息", form.path);
      await client.invalidateQueries({ queryKey: ["metas"] });
      onClose();
    } catch (error) { toast.error("保存失败", error); }
  };
  return (
    <Sheet open onClose={onClose} width={640} title={meta ? `编辑 ${meta.path}` : "新建元信息"}
      footer={<><button className="btn btn-ghost" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={!form.path?.startsWith("/")} onClick={() => void save()}>保存</button></>}>
      <div className="flex flex-col gap-5">
        <label><span className="label">路径</span><input className="field" value={form.path ?? ""} onChange={event => set({ path: event.target.value })} /></label>
        <div>
          <label className="label" htmlFor="m-pass">访问密码</label>
          <input id="m-pass" className="field" value={form.password ?? ""} onChange={event => set({ password: event.target.value })} />
          <div className="mt-2"><Sub on={!!form.p_sub} onChange={p_sub => set({ p_sub })} /></div>
          <AnimatePresence initial={false}>
            {!!form.password && !form.p_sub && (
              <motion.p key="sub" className="mt-2 text-[12.5px] text-muted" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                现在只锁这一层：打开它要密码，但直接进里面的子文件夹不用。想整个锁住，打开「应用到子文件夹」。
              </motion.p>
            )}
          </AnimatePresence>
          {!!form.password && <AdminBypass />}
        </div>
        <div className="flex items-center justify-between rounded-xl px-3 py-2.5 hairline">
          <span className="text-[13.5px]">允许所有人上传和新建</span>
          <div className="flex items-center gap-4"><Sub on={!!form.w_sub} onChange={w_sub => set({ w_sub })} /><button type="button" role="switch" aria-checked={!!form.write} className="switch" onClick={() => set({ write: !form.write })} /></div>
        </div>
        <div>
          <label className="label" htmlFor="m-hide">隐藏（每行一个正则）</label>
          <textarea id="m-hide" className="field font-mono text-[12.5px]" rows={3} value={form.hide ?? ""} onChange={event => set({ hide: event.target.value })} />
          <div className="mt-2"><Sub on={!!form.h_sub} onChange={h_sub => set({ h_sub })} /></div>
        </div>
        <div>
          <label className="label" htmlFor="m-readme">说明（Markdown，显示在列表下方）</label>
          <textarea id="m-readme" className="field font-mono text-[12.5px]" rows={4} value={form.readme ?? ""} onChange={event => set({ readme: event.target.value })} />
          <div className="mt-2"><Sub on={!!form.r_sub} onChange={r_sub => set({ r_sub })} /></div>
        </div>
      </div>
    </Sheet>
  );
}

/** Admins skip folder passwords (免密访问, which WebDAV clients rely on); offer the web-only lock. */
function AdminBypass() {
  const me = useSession(state => state.me);
  if (!me || !hasBit(me.permission, Perm.NoPassword)) return null;
  return (
    <motion.div className="mt-3 rounded-xl bg-accent-soft px-1 pb-1 pt-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
      <div className="flex items-start gap-3 px-2">
        <LockKeyIcon size={18} weight="duotone" className="mt-0.5 shrink-0 text-accent-text" />
        <p className="text-[12.5px] leading-relaxed text-muted"><span className="font-medium text-ink">管理员默认不被问密码</span>，密码只拦访客和其他账户。想自己打开时也要输密码，打开下面这个开关。</p>
      </div>
      <FolderLock />
    </motion.div>
  );
}

export default function Metas() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["metas"], queryFn: metas.list });
  const [editing, setEditing] = useState<Meta | null | "new">(null);
  const list = query.data?.content ?? [];
  return (
    <div>
      <PageHeader title="元信息" detail="为路径设置密码、隐藏规则和说明">
        <button className="btn btn-primary" onClick={() => setEditing("new")}><PlusIcon size={16} weight="bold" />新建</button>
      </PageHeader>
      {query.isPending && <div className="skeleton h-16 rounded-[var(--radius-tile)]" />}
      {query.data && !list.length && <p className="py-10 text-muted">还没有元信息。</p>}
      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {list.map((meta, index) => (
            <motion.li key={meta.id} layout className="flex items-center gap-3 rounded-[var(--radius-tile)] bg-surface px-4 py-3 hairline"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { ...spring.snappy, delay: index * 0.03 } }} exit={{ opacity: 0, scale: 0.95 }}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{meta.path}</p>
                <p className="truncate text-[12.5px] text-muted">
                  {[meta.password && (meta.p_sub ? "密码（含子文件夹）" : "密码（仅这一层）"), meta.write && "可写", meta.hide && "隐藏规则", meta.readme && "说明"].filter(Boolean).join("，") || "无设置"}
                </p>
              </div>
              <button className="icon-btn" aria-label="编辑" onClick={() => setEditing(meta)}><PencilSimpleIcon size={17} /></button>
              <button className="icon-btn hover:text-danger" aria-label="删除" onClick={async () => {
                try { await metas.remove(meta.id); toast.success("已删除", meta.path); } catch (error) { toast.error("删除失败", error); }
                void client.invalidateQueries({ queryKey: ["metas"] });
              }}><TrashIcon size={17} /></button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <AnimatePresence>{editing && <Editor key="editor" meta={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}</AnimatePresence>
    </div>
  );
}
