import { ArrowClockwiseIcon, CaretRightIcon, CheckIcon, CloudIcon, FolderSimpleIcon, FolderSimplePlusIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { mount115, type DriveFolder, type MountSource } from "../../api/mount115";
import { ErrorState } from "../../components/ErrorState";
import { Sheet } from "../../components/Sheet";
import { spring } from "../../lib/motion";
import { toast } from "../../stores/toast";

/**
 * Pick a 115 folder by clicking through the drive, using the account of a 115
 * storage that is already signed in. Entering a folder slides the list in from
 * the right, going back slides it in from the left; folders that some storage
 * already mounts say where.
 */
type Crumb = { id: string; name: string };

export function FolderBrowser115({ source, onChange }: { source: number; onChange: (folder: Crumb) => void }) {
  const [trail, setTrail] = useState<Crumb[]>([{ id: "0", name: "115 网盘" }]);
  const [direction, setDirection] = useState(1);
  const client = useQueryClient();
  const here = trail[trail.length - 1];
  const query = useQuery({
    queryKey: ["115-folders", source, here.id],
    queryFn: () => mount115.folders(source, here.id),
    staleTime: 2 * 60_000,
    retry: false,
  });
  const mounted = new Map<string, string>((query.data?.sources ?? []).map(item => [item.root, item.mount_path]));

  const go = (next: Crumb[], dir: number): void => {
    setDirection(dir);
    setTrail(next);
    onChange(next[next.length - 1]);
  };

  const refresh = async (): Promise<void> => {
    const data = await mount115.folders(source, here.id, true).catch(error => { toast.error("没有读到文件夹", error); return null; });
    if (data) client.setQueryData(["115-folders", source, here.id], data);
  };

  return (
    <div className="overflow-hidden rounded-[14px] bg-surface hairline">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-[13px] [scrollbar-width:none]" aria-label="115 路径">
          {trail.map((crumb, index) => (
            <span key={crumb.id} className="flex shrink-0 items-center">
              {index > 0 && <CaretRightIcon size={12} className="mx-0.5 text-faint" />}
              <button type="button" disabled={index === trail.length - 1}
                className={`rounded-[8px] px-1.5 py-1 ${index === trail.length - 1 ? "font-medium" : "text-muted hover:bg-[var(--hover)] hover:text-ink"}`}
                onClick={() => go(trail.slice(0, index + 1), -1)}>
                {index === 0 ? <span className="flex items-center gap-1"><CloudIcon size={14} />{crumb.name}</span> : crumb.name}
              </button>
            </span>
          ))}
        </nav>
        <button type="button" className="icon-btn size-8" aria-label="重新读取" onClick={() => void refresh()}><ArrowClockwiseIcon size={15} /></button>
      </div>
      <div className="relative h-[min(46dvh,340px)] overflow-y-auto">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.ul key={here.id} custom={direction} className="p-1"
            variants={{ enter: (d: number) => ({ x: d * 36, opacity: 0 }), center: { x: 0, opacity: 1 }, leave: (d: number) => ({ x: d * -36, opacity: 0 }) }}
            initial="enter" animate="center" exit="leave" transition={spring.snappy}>
            {query.isPending && Array.from({ length: 6 }, (_, i) => <li key={i} className="skeleton mx-1 my-1.5 h-9 rounded-[10px]" style={{ opacity: 1 - i * 0.12 }} />)}
            {query.isError && <li className="p-3"><ErrorState compact error={query.error} onRetry={() => query.refetch()} /></li>}
            {query.data && query.data.folders.length === 0 && <li className="px-3 py-10 text-center text-[13px] text-muted">这里没有子文件夹，可以直接挂载它</li>}
            {query.data?.folders.map((folder: DriveFolder, index) => (
              <li key={folder.id} className="enter" style={{ "--i": Math.min(index, 16) } as React.CSSProperties}>
                <button type="button" className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[14px] hover:bg-[var(--hover)] active:scale-[0.99]"
                  onClick={() => go([...trail, { id: folder.id, name: folder.name }], 1)}>
                  <FolderSimpleIcon size={18} weight="fill" className="shrink-0 text-accent-text opacity-80" />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  {mounted.has(folder.id) && <span className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[11.5px] text-muted hairline">已挂载 {mounted.get(folder.id)}</span>}
                  <CaretRightIcon size={14} className="shrink-0 text-faint" />
                </button>
              </li>
            ))}
          </motion.ul>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Choose a working 115 storage to borrow the sign-in from (the first one by default). */
function useSources() {
  return useQuery({ queryKey: ["115-sources"], queryFn: mount115.sources, staleTime: 60_000, retry: false });
}

function defaultSource(sources: MountSource[] | undefined, prefer?: number): number {
  if (!sources?.length) return 0;
  return sources.find(item => item.id === prefer && item.status === "work")?.id ?? sources.find(item => item.status === "work")?.id ?? sources[0].id;
}

/** Mount a 115 folder as a new storage: borrow an account, click to the folder, name the path. */
export function Mount115Sheet({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const sources = useSources();
  const [chosenSource, setSource] = useState(0);
  const source = chosenSource || defaultSource(sources.data);
  const [folder, setFolder] = useState<Crumb>({ id: "0", name: "115 网盘" });
  const [path, setPath] = useState("");
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const suggested = folder.id === "0" ? "/115" : `/115/${folder.name}`;
  const mountPath = edited ? path : suggested;

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const out = await mount115.mount(source, folder.id, mountPath);
      toast.success("已挂载", out.mount_path);
      await client.invalidateQueries({ queryKey: ["storages"] });
      void client.invalidateQueries({ queryKey: ["115-sources"] });
      onClose();
    } catch (error) {
      toast.error("挂载失败", error);
      void client.invalidateQueries({ queryKey: ["storages"] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} width={560} title="挂载 115 文件夹"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={busy || !source || folder.id === "0" || !mountPath.trim()} onClick={() => void submit()}>
          <FolderSimplePlusIcon size={16} />{busy ? "挂载中…" : `挂载「${folder.id === "0" ? "…" : folder.name}」`}
        </button>
      </>}>
      {sources.isPending && <div className="skeleton h-[380px] rounded-[14px]" />}
      {sources.isError && <ErrorState compact error={sources.error} onRetry={() => sources.refetch()} />}
      {sources.data && sources.data.length === 0 && (
        <p className="rounded-[14px] bg-surface px-4 py-3.5 text-[13.5px] text-muted hairline">
          还没有已登录的 115 存储。先用「添加」选 115 Cloud 填一次 Cookie，之后的文件夹都能在这里点选挂载。
        </p>
      )}
      {sources.data && sources.data.length > 0 && (
        <div className="flex flex-col gap-4">
          {sources.data.length > 1 && (
            <div>
              <label className="label" htmlFor="m115-source">用哪个存储的登录</label>
              <select id="m115-source" className="field" value={source} onChange={event => { setSource(Number(event.target.value)); setFolder({ id: "0", name: "115 网盘" }); }}>
                {sources.data.map(item => <option key={item.id} value={item.id}>{item.mount_path}{item.status === "work" ? "" : "（异常）"}</option>)}
              </select>
              <p className="mt-1.5 text-[12.5px] text-faint">同一个账号的存储看到的是同一个网盘，选哪个都行；新存储会沿用它的登录和设置。</p>
            </div>
          )}
          <FolderBrowser115 key={source} source={source} onChange={setFolder} />
          <div>
            <label className="label" htmlFor="m115-path">挂载到</label>
            <input id="m115-path" className="field" value={mountPath} spellCheck={false} autoComplete="off"
              onChange={event => { setEdited(true); setPath(event.target.value); }} />
            <p className="mt-1.5 text-[12.5px] text-faint">
              {folder.id === "0" ? "点进要挂载的文件夹，停在它里面。" : <>挂载的是当前打开的「{folder.name}」，文件夹 ID {folder.id}。</>}
            </p>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** The folder picker inside the storage editor: fills in the root folder id. */
export function PickRoot115({ prefer, onPick, onClose }: { prefer?: number; onPick: (id: string) => void; onClose: () => void }) {
  const sources = useSources();
  const source = defaultSource(sources.data, prefer);
  const [folder, setFolder] = useState<Crumb>({ id: "0", name: "115 网盘" });
  return (
    <Sheet open onClose={onClose} width={540} title="选择根文件夹"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={!source} onClick={() => { onPick(folder.id); onClose(); }}>
          <CheckIcon size={16} />用「{folder.name}」
        </button>
      </>}>
      {sources.isPending && <div className="skeleton h-[380px] rounded-[14px]" />}
      {sources.isError && <ErrorState compact error={sources.error} onRetry={() => sources.refetch()} />}
      {sources.data && !source && <p className="text-[13.5px] text-muted">先保存一次这个存储（填好 Cookie），再回来点选文件夹。</p>}
      {source > 0 && <FolderBrowser115 source={source} onChange={setFolder} />}
    </Sheet>
  );
}
