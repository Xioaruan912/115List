import { PencilSimpleIcon, PlusIcon, ShieldCheckIcon, TrashIcon, UserIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { users } from "../../api/admin";
import { Sheet } from "../../components/Sheet";
import { spring } from "../../lib/motion";
import { hasBit, PERM_LABELS } from "../../lib/perm";
import { Role, type User } from "../../lib/types";
import { toast } from "../../stores/toast";
import { PageHeader } from "./Form";

const ROLE_LABEL: Record<number, string> = { [Role.General]: "普通用户", [Role.Guest]: "访客", [Role.Admin]: "管理员" };

function Editor({ user, onClose }: { user: User | null; onClose: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState<Partial<User>>(user ?? { username: "", password: "", base_path: "/", role: Role.General, permission: 0, disabled: false, allow_ldap: true });
  const [busy, setBusy] = useState(false);
  const special = user?.role === Role.Admin || user?.role === Role.Guest;
  const set = (patch: Partial<User>): void => setForm(state => ({ ...state, ...patch }));
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      if (user) await users.update({ ...user, ...form });
      else await users.create(form);
      toast.success(user ? "已保存用户" : "已创建用户", form.username);
      await client.invalidateQueries({ queryKey: ["users"] });
      onClose();
    } catch (error) { toast.error("保存失败", error); }
    setBusy(false);
  };
  return (
    <Sheet open onClose={onClose} width={640} title={user ? `编辑 ${user.username}` : "新建用户"}
      footer={<><button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={busy || !form.username?.trim() || (!user && !form.password)} onClick={() => void save()}>保存</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className="label">用户名</span><input className="field" value={form.username ?? ""} disabled={user?.role === Role.Guest} onChange={event => set({ username: event.target.value })} /></label>
        <label><span className="label">{user ? "新密码" : "密码"}</span><input className="field" type="password" autoComplete="new-password" value={form.password ?? ""} onChange={event => set({ password: event.target.value })} />
          {user && <span className="mt-1.5 block text-[12.5px] text-faint">留空则不修改</span>}</label>
        <label className="sm:col-span-2"><span className="label">根目录</span><input className="field" value={form.base_path ?? "/"} onChange={event => set({ base_path: event.target.value })} />
          <span className="mt-1.5 block text-[12.5px] text-faint">用户只能看到这个路径以下的内容</span></label>
      </div>
      {form.role !== Role.Admin && (
        <section className="mt-6">
          <h3 className="mb-2 text-[13px] font-semibold text-muted">权限</h3>
          <div className="grid gap-1 sm:grid-cols-2">
            {PERM_LABELS.map(([bit, label]) => {
              const on = hasBit(form.permission ?? 0, bit);
              return (
                <button key={bit} type="button" className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] hover:bg-[var(--hover)]"
                  onClick={() => set({ permission: (form.permission ?? 0) ^ (1 << bit) })}>
                  {label}
                  <span role="switch" aria-checked={on} className="switch" />
                </button>
              );
            })}
          </div>
        </section>
      )}
      {!special && (
        <div className="mt-4 flex items-center justify-between rounded-xl px-3 py-2.5 hairline">
          <span className="text-[13.5px]">停用这个账户</span>
          <button type="button" role="switch" aria-checked={!!form.disabled} className="switch" onClick={() => set({ disabled: !form.disabled })} />
        </div>
      )}
    </Sheet>
  );
}

export default function Users() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["users"], queryFn: users.list });
  const [editing, setEditing] = useState<User | null | "new">(null);
  const [confirm, setConfirm] = useState<User | null>(null);
  const list = query.data?.content ?? [];
  return (
    <div>
      <PageHeader title="用户" detail={query.data ? `${list.length} 个账户` : " "}>
        <button className="btn btn-primary" onClick={() => setEditing("new")}><PlusIcon size={16} weight="bold" />新建</button>
      </PageHeader>
      {query.isPending && <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16 rounded-[var(--radius-tile)]" />)}</div>}
      {query.isError && <p className="text-danger">{query.error.message}</p>}
      <ul className="grid gap-2 sm:grid-cols-2">
        <AnimatePresence initial={false}>
          {list.map((user, index) => (
            <motion.li key={user.id} layout className="flex items-center gap-3 rounded-[var(--radius-tile)] bg-surface px-4 py-3 hairline"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: user.disabled ? 0.55 : 1, y: 0, transition: { ...spring.snappy, delay: index * 0.035 } }} exit={{ opacity: 0, scale: 0.95 }}>
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${user.role === Role.Admin ? "bg-accent text-accent-ink" : "bg-raised text-muted hairline"}`}>
                {user.role === Role.Admin ? <ShieldCheckIcon size={19} weight="fill" /> : <UserIcon size={19} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{user.username}</p>
                <p className="truncate text-[12.5px] text-muted">{ROLE_LABEL[user.role] ?? user.role}，{user.base_path}{user.disabled ? "，已停用" : ""}</p>
              </div>
              <button className="icon-btn" aria-label="编辑" onClick={() => setEditing(user)}><PencilSimpleIcon size={17} /></button>
              {user.role === Role.General && <button className="icon-btn hover:text-danger" aria-label="删除" onClick={() => setConfirm(user)}><TrashIcon size={17} /></button>}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <AnimatePresence>
        {editing && <Editor key="editor" user={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
        {confirm && (
          <Sheet key="confirm" open onClose={() => setConfirm(null)} title={`删除用户 ${confirm.username}？`}
            footer={<><button className="btn btn-ghost" onClick={() => setConfirm(null)}>取消</button>
              <button className="btn btn-danger" onClick={async () => {
                const target = confirm;
                setConfirm(null);
                try { await users.remove(target.id); toast.success("已删除用户", target.username); } catch (error) { toast.error("删除失败", error); }
                void client.invalidateQueries({ queryKey: ["users"] });
              }}>删除</button></>}>
            <p className="text-muted">账户会被移除，它上传的文件不受影响。</p>
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  );
}
