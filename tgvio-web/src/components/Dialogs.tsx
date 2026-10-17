import { CaretRightIcon, CopyIcon, FolderSimpleIcon, HouseIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import * as auth from "../api/auth";
import * as fs from "../api/fs";
import { passwordFor } from "../hooks/useDir";
import * as actions from "../lib/actions";
import { formatBytes } from "../lib/format";
import { kindOf } from "../lib/kind";
import { absolute, copyText, downloadUrl } from "../lib/links";
import { spring } from "../lib/motion";
import { extname, join, segments } from "../lib/path";
import { useSession } from "../stores/session";
import { toast, useToasts } from "../stores/toast";
import { useUi, type Dialog } from "../stores/ui";
import type { Obj } from "../lib/types";
import { KindIcon } from "./KindIcon";
import { DeviceList } from "./Devices";
import { PosterPicker } from "./PosterPicker";
import { Share115Dialog } from "./Share115";
import { SubtitleSearch } from "./SubtitleSearch";
import { TmdbRename } from "./TmdbRename";
import { ShareDialog, SharesDialog } from "./Share";
import { Sheet } from "./Sheet";
import { ErrorState } from "./ErrorState";

function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<boolean | void>): Promise<boolean> => {
    setBusy(true);
    try { return (await task()) !== false; } finally { setBusy(false); }
  };
  return [busy, run] as const;
}

function NameDialog({ title, initial, select, action, onSubmit, onClose }: {
  title: string;
  initial: string;
  select: [number, number];
  action: string;
  onSubmit: (name: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, run] = useBusy();
  const invalid = !name.trim() || /[/\\]/.test(name);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (invalid) return;
    if (await run(() => onSubmit(name.trim()))) onClose();
  };
  return (
    <Sheet open onClose={onClose} title={title}
      footer={<><button className="btn btn-ghost" onClick={onClose}>取消</button><button className="btn btn-primary" form="name-form" disabled={invalid || busy}>{busy ? "处理中…" : action}</button></>}>
      <form id="name-form" onSubmit={submit}>
        <label className="label" htmlFor="name-input">名称</label>
        <input id="name-input" className="field" value={name} autoFocus spellCheck={false}
          onFocus={event => event.currentTarget.setSelectionRange(...select)}
          onChange={event => setName(event.target.value)} />
        <p className={`mt-2 text-[12.5px] ${/[/\\]/.test(name) ? "text-danger" : "text-faint"}`}>名称里不能有 / 或 \</p>
      </form>
    </Sheet>
  );
}

function DeleteDialog({ dir, names, onClose }: { dir: string; names: string[]; onClose: () => void }) {
  const [busy, run] = useBusy();
  return (
    <Sheet open onClose={onClose} title={names.length === 1 ? "删除这一项？" : `删除这 ${names.length} 项？`}
      footer={<><button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-danger" autoFocus disabled={busy} onClick={async () => { onClose(); await run(() => actions.remove(dir, names)); }}>删除</button></>}>
      <ul className="flex flex-col gap-1.5">
        {names.slice(0, 6).map((name, index) => (
          <motion.li key={name} className="truncate rounded-lg bg-surface px-3 py-2 text-[13.5px]" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.snappy, delay: index * 0.03 }}>{name}</motion.li>
        ))}
        {names.length > 6 && <li className="px-3 text-muted">以及另外 {names.length - 6} 项</li>}
      </ul>
      <p className="mt-4 text-[13px] text-muted">网盘存储通常会把它们放进回收站；本地存储会直接删除。</p>
    </Sheet>
  );
}

export function FolderPicker({ start, value, onChange }: { start: string; value: string; onChange: (path: string) => void }) {
  const dirs = useQuery({ queryKey: ["dirs", value], queryFn: () => fs.dirs(value, passwordFor(value)), staleTime: 20_000 });
  const parts = segments(value);
  useEffect(() => { onChange(start); }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="overflow-hidden rounded-[var(--radius-tile)] hairline">
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2 py-1.5 text-[13px] [scrollbar-width:none]">
        <button className="icon-btn size-7 shrink-0" onClick={() => onChange("/")} aria-label="根目录"><HouseIcon size={14} /></button>
        {parts.map((part, index) => (
          <span key={index} className="flex shrink-0 items-center">
            <CaretRightIcon size={10} className="text-faint" />
            <button className={`rounded-md px-1.5 py-0.5 ${index === parts.length - 1 ? "font-medium" : "text-muted hover:text-ink"}`}
              onClick={() => onChange("/" + parts.slice(0, index + 1).join("/"))}>{part}</button>
          </span>
        ))}
      </div>
      <div className="relative h-[280px] overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.ul key={value} className="absolute inset-0 overflow-y-auto p-1.5"
            initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={spring.snappy}>
            {dirs.isPending && Array.from({ length: 5 }, (_, i) => <li key={i} className="skeleton my-1 h-9 rounded-lg" />)}
            {dirs.isError && <li><ErrorState compact error={dirs.error} onRetry={() => dirs.refetch()} /></li>}
            {dirs.data?.length === 0 && <li className="p-3 text-muted">没有子文件夹</li>}
            {dirs.data?.map((dir, index) => (
              <li key={dir.name}>
                <button className="enter flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left hover:bg-[var(--hover)]" style={{ "--i": index } as React.CSSProperties}
                  onClick={() => onChange(join(value, dir.name))}>
                  <FolderSimpleIcon size={17} weight="duotone" className="shrink-0 text-accent-text" />
                  <span className="truncate">{dir.name}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        </AnimatePresence>
      </div>
    </div>
  );
}

function TransferDialog({ mode, dir, names, onClose }: { mode: "move" | "copy"; dir: string; names: string[]; onClose: () => void }) {
  const [target, setTarget] = useState(dir);
  const [conflict, setConflict] = useState<"skip" | "overwrite">("skip");
  const [busy, run] = useBusy();
  const same = target === dir;
  const label = mode === "move" ? "移动" : "复制";
  return (
    <Sheet open onClose={onClose} width={520} title={`${label} ${names.length === 1 ? names[0] : `${names.length} 项`}`}
      footer={<><button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={same || busy} onClick={() => void run(async () => {
          const ok = await actions.transfer(mode, dir, target, names, conflict === "overwrite" ? { overwrite: true } : { skip_existing: true });
          if (ok) onClose();
          return ok;
        })}>{same ? "选择其他文件夹" : `${label}到这里`}</button></>}>
      <FolderPicker start={dir} value={target} onChange={setTarget} />
      <div className="mt-4 flex items-center gap-3 text-[13px]">
        <span className="text-muted">遇到同名</span>
        {(["skip", "overwrite"] as const).map(option => (
          <button key={option} className={`relative rounded-lg px-2.5 py-1 ${conflict === option ? "text-ink" : "text-muted"}`} onClick={() => setConflict(option)}>
            {conflict === option && <motion.span layoutId="conflict" className="absolute inset-0 rounded-lg bg-surface hairline" transition={spring.snappy} />}
            <span className="relative">{option === "skip" ? "跳过" : "覆盖"}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function DecompressDialog({ dir, obj, innerPath, archivePass, onClose }: { dir: string; obj: Obj; innerPath: string; archivePass: string; onClose: () => void }) {
  const [target, setTarget] = useState(dir);
  const [intoNewDir, setIntoNewDir] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, run] = useBusy();
  return (
    <Sheet open onClose={onClose} width={520} title={`解压 ${innerPath === "/" ? obj.name : `${obj.name} 里的 ${innerPath}`}`}
      footer={<><button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void run(async () => {
          try {
            await fs.decompress(dir, target, [obj.name], { archivePass, innerPath, intoNewDir, overwrite });
            useToasts.getState().push({ tone: "success", title: "已开始解压", detail: `解压到 ${target}，在服务器任务里看进度`, action: { label: "查看", run: () => useUi.getState().setUploads(true) } });
            onClose();
          } catch (error) { toast.error("解压失败", error); return false; }
        })}>解压到这里</button></>}>
      <FolderPicker start={dir} value={target} onChange={setTarget} />
      <div className="mt-4 flex flex-col gap-1">
        {([["放进以压缩包命名的新文件夹", intoNewDir, setIntoNewDir], ["覆盖同名文件", overwrite, setOverwrite]] as const).map(([label, on, set]) => (
          <button key={label} type="button" className="flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-[13.5px] hover:bg-[var(--hover)]" onClick={() => set(!on)}>
            {label}<span role="switch" aria-checked={on} className="switch" />
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function Row({ label, children, copy }: { label: string; children: ReactNode; copy?: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-start gap-3 border-b border-line py-2.5 last:border-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="break-all text-[13.5px] tabular">{children}</dd>
      {copy ? <button className="icon-btn size-7" aria-label={`复制${label}`} onClick={() => void copyText(copy).then(() => toast.success("已复制"))}><CopyIcon size={14} /></button> : <span />}
    </div>
  );
}

function InfoDialog({ dir, obj, onClose }: { dir: string; obj: import("../lib/types").Obj; onClose: () => void }) {
  const path = join(dir, obj.name);
  const detail = useQuery({ queryKey: ["get", path], queryFn: () => fs.getObj(path, passwordFor(dir)), staleTime: 30_000 });
  const data = detail.data ?? obj;
  const link = obj.is_dir ? "" : absolute(downloadUrl(path, data));
  const hashes = useMemo(() => {
    try { return Object.entries(JSON.parse(data.hashinfo || "{}") as Record<string, string>); } catch { return []; }
  }, [data.hashinfo]);
  return (
    <Sheet open onClose={onClose} width={560} title={
      <span className="flex items-center gap-2"><KindIcon kind={kindOf(obj)} size={18} weight="duotone" className="text-accent-text" />属性</span>
    }>
      <dl>
        <Row label="名称" copy={obj.name}>{obj.name}</Row>
        <Row label="路径" copy={path}>{path}</Row>
        {!obj.is_dir && <Row label="大小">{formatBytes(obj.size, 2)} <span className="text-faint">({obj.size.toLocaleString()} B)</span></Row>}
        <Row label="修改时间">{new Date(obj.modified).toLocaleString()}</Row>
        {obj.created && new Date(obj.created).getFullYear() > 1980 && <Row label="创建时间">{new Date(obj.created).toLocaleString()}</Row>}
        {detail.data?.provider && <Row label="存储">{detail.data.provider}</Row>}
        {hashes.map(([name, value]) => <Row key={name} label={name.toUpperCase()} copy={value}><span className="font-mono text-[12px]">{value}</span></Row>)}
        {link && <Row label="下载链接" copy={link}><span className="font-mono text-[12px]">{link}</span></Row>}
        {detail.data?.raw_url && <Row label="直链" copy={detail.data.raw_url}><span className="line-clamp-3 font-mono text-[12px]">{detail.data.raw_url}</span></Row>}
      </dl>
    </Sheet>
  );
}

function OfflineDialog({ dir, onClose }: { dir: string; onClose: () => void }) {
  const tools = useQuery({ queryKey: ["offline-tools", dir], queryFn: () => fs.offlineTools(dir), staleTime: 300_000 });
  const [urls, setUrls] = useState("");
  const [tool, setTool] = useState("");
  const [policy, setPolicy] = useState("delete_on_upload_succeed");
  const [busy, run] = useBusy();
  useEffect(() => {
    if (!tool && tools.data?.length) setTool(tools.data.find(name => fs.nativeOfflineTools.includes(name)) ?? tools.data[0]);
  }, [tools.data, tool]);
  const native = fs.nativeOfflineTools.includes(tool);
  const list = urls.split("\n").map(line => line.trim()).filter(Boolean);
  return (
    <Sheet open onClose={onClose} width={540} title="离线下载"
      footer={<><button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={!list.length || !tool || busy} onClick={() => void run(async () => {
          try {
            await fs.offlineDownload(dir, list, tool, policy);
            toast.success("已添加离线任务", `${list.length} 个链接`);
            onClose();
          } catch (error) { toast.error("添加失败", error); return false; }
        })}>添加</button></>}>
      <label className="label" htmlFor="offline-urls">链接，每行一个</label>
      <textarea id="offline-urls" className="field font-mono text-[12.5px]" rows={5} value={urls} onChange={event => setUrls(event.target.value)} autoFocus placeholder="magnet:?xt=… 或 https://…" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label>
          <span className="label">工具</span>
          <select className="field" value={tool} onChange={event => setTool(event.target.value)}>
            {(tools.data ?? []).map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className={native ? "opacity-50" : ""}>
          <span className="label">临时文件</span>
          <select className="field" value={policy} disabled={native} onChange={event => setPolicy(event.target.value)}>
            <option value="delete_on_upload_succeed">上传成功后删除</option>
            <option value="delete_on_upload_failed">上传失败后删除</option>
            <option value="delete_never">保留</option>
            <option value="delete_always">总是删除</option>
          </select>
        </label>
      </div>
      <p className="mt-3 text-[12.5px] text-faint">保存到 {dir}{native && `，由 ${tool} 在网盘里直接下载，不经过服务器`}</p>
    </Sheet>
  );
}

function AccountDialog({ onClose }: { onClose: () => void }) {
  const me = useSession(state => state.me);
  const [username, setUsername] = useState(me?.username ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, run] = useBusy();
  const mismatch = password !== confirm;
  return (
    <Sheet open onClose={onClose} title="账户资料" width={560}
      footer={<><button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={busy || mismatch || !username.trim()} onClick={() => void run(async () => {
          try {
            await auth.updateMe({ username: username.trim(), password });
            toast.success("已保存", password ? "请用新密码重新登录" : undefined);
            onClose();
            if (password) await useSession.getState().signOut();
            else await useSession.getState().boot();
          } catch (error) { toast.error("保存失败", error); return false; }
        })}>保存</button></>}>
      <div className="flex flex-col gap-4">
        <label><span className="label">用户名</span><input className="field" value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label><span className="label">新密码</span><input className="field" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
          <span className="mt-1.5 block text-[12.5px] text-faint">留空则不修改密码</span></label>
        {password && <label><span className="label">确认新密码</span><input className="field" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} />
          {mismatch && confirm && <span className="mt-1.5 block text-[12.5px] text-danger">两次输入不一致</span>}</label>}
        <div className="mt-2 border-t border-line pt-5"><DeviceList /></div>
      </div>
    </Sheet>
  );
}

export function Dialogs() {
  const dialog = useUi(state => state.dialog);
  const close = useUi(state => state.closeDialog);
  return <AnimatePresence>{dialog && <DialogFor key={dialog.kind} dialog={dialog} onClose={close} />}</AnimatePresence>;
}

function DialogFor({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  switch (dialog.kind) {
    case "mkdir":
      return <NameDialog title="新建文件夹" initial="新建文件夹" select={[0, 5]} action="新建" onClose={onClose} onSubmit={name => actions.mkdir(dialog.dir, name)} />;
    case "rename": {
      const name = dialog.obj.name;
      const ext = dialog.obj.is_dir ? "" : extname(name);
      return <NameDialog title="重命名" initial={name} select={[0, ext ? name.length - ext.length - 1 : name.length]} action="重命名" onClose={onClose}
        onSubmit={next => next === name ? Promise.resolve(true) : actions.rename(dialog.dir, dialog.obj, next)} />;
    }
    case "delete":
      return <DeleteDialog dir={dialog.dir} names={dialog.names} onClose={onClose} />;
    case "transfer":
      return <TransferDialog mode={dialog.mode} dir={dialog.dir} names={dialog.names} onClose={onClose} />;
    case "info":
      return <InfoDialog dir={dialog.dir} obj={dialog.obj} onClose={onClose} />;
    case "offline":
      return <OfflineDialog dir={dialog.dir} onClose={onClose} />;
    case "share115":
      return <Share115Dialog dir={dialog.dir} onClose={onClose} />;
    case "subtitle-search":
      return <SubtitleSearch path={dialog.path} onClose={onClose} />;
    case "share":
      return <ShareDialog dir={dialog.dir} names={dialog.names} onClose={onClose} />;
    case "poster":
      return <PosterPicker name={dialog.name} onClose={onClose} />;
    case "tmdb-rename":
      return <TmdbRename targets={dialog.targets} onClose={onClose} />;
    case "shares":
      return <SharesDialog onClose={onClose} />;
    case "account":
      return <AccountDialog onClose={onClose} />;
    case "decompress":
      return <DecompressDialog dir={dialog.dir} obj={dialog.obj} innerPath={dialog.innerPath} archivePass={dialog.archivePass} onClose={onClose} />;
  }
}

