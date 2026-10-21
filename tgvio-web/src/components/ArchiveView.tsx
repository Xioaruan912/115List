import { ArrowSquareOutIcon, CaretRightIcon, DownloadSimpleIcon, FileArchiveIcon, HouseIcon, LockIcon, PackageIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, type FormEvent } from "react";
import { archiveList, archiveMeta, type ArchiveNode } from "../api/fs";
import { passwordFor } from "../hooks/useDir";
import { ApiError } from "../lib/api";
import { formatBytes } from "../lib/format";
import { kindOf } from "../lib/kind";
import { spring } from "../lib/motion";
import { join, segments } from "../lib/path";
import { can, Perm } from "../lib/perm";
import { sortObjs } from "../lib/sort";
import type { Obj } from "../lib/types";
import { useSession } from "../stores/session";
import { useUi } from "../stores/ui";
import { KindIcon } from "./KindIcon";
import { ErrorState } from "./ErrorState";

/** Walk the tree the server returned (when it can read the whole index at once). */
function childrenAt(tree: ArchiveNode[] | null, inner: string): ArchiveNode[] | null {
  if (!tree) return null;
  let level: ArchiveNode[] = tree;
  for (const part of segments(inner)) {
    const next = level.find(node => node.is_dir && node.name === part);
    if (!next) return [];
    level = next.children ?? [];
  }
  return level;
}

/**
 * Inside an archive without extracting it: the server reads the archive's index
 * (by range requests where the format allows), so even a big zip on the drive
 * opens fast. Files inside open or download one by one; the whole archive, or the
 * folder you are in, can be extracted into the drive as a server task.
 */
export function ArchiveView({ dir, obj }: { dir: string; obj: Obj }) {
  const me = useSession(state => state.me);
  const path = join(dir, obj.name);
  const [archivePass, setArchivePass] = useState("");
  const [typed, setTyped] = useState("");
  const [inner, setInner] = useState("/");
  const [direction, setDirection] = useState(1);

  const meta = useQuery({
    queryKey: ["archive-meta", path, archivePass],
    queryFn: () => archiveMeta(path, passwordFor(dir), archivePass),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const wrongPass = meta.error instanceof ApiError && meta.error.code === 202;
  const needPass = wrongPass || (meta.data?.encrypted && !meta.data.content?.length);
  const fromTree = childrenAt(meta.data?.content ?? null, inner);
  const listing = useQuery({
    queryKey: ["archive-list", path, archivePass, inner],
    queryFn: () => archiveList(path, passwordFor(dir), archivePass, inner),
    enabled: !!meta.data && !needPass && fromTree === null,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const items = useMemo(() => sortObjs((fromTree ?? listing.data?.content ?? []) as Obj[], "name", false), [fromTree, listing.data]);
  const loading = meta.isPending || (fromTree === null && listing.isPending && !needPass);
  const error = (!wrongPass && meta.error) || listing.error;

  const fileUrl = (name: string): string => {
    const params = new URLSearchParams({ inner: join(inner, name) });
    if (archivePass) params.set("pass", archivePass);
    if (meta.data?.sign) params.set("sign", meta.data.sign);
    return `${meta.data?.raw_url ?? ""}?${params}`;
  };
  const go = (next: string, forward: boolean): void => { setDirection(forward ? 1 : -1); setInner(next); };
  const unlock = (event: FormEvent): void => { event.preventDefault(); setArchivePass(typed); };
  const parts = segments(inner);

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden rounded-[22px] bg-raised hairline" onPointerDown={event => event.stopPropagation()}>
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <motion.span initial={{ rotate: -14, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={spring.pop}
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text"><FileArchiveIcon size={22} weight="duotone" /></motion.span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{obj.name}</p>
          <p className="text-[12.5px] text-muted tabular">{formatBytes(obj.size)}{meta.data?.encrypted ? "，已加密" : ""}</p>
        </div>
        {can(me, Perm.Decompress) && meta.data && !needPass && (
          <button className="btn btn-primary" onClick={() => useUi.getState().openDialog({ kind: "decompress", dir, obj, innerPath: inner, archivePass })}>
            <PackageIcon size={16} />{inner === "/" ? "解压" : "解压此文件夹"}
          </button>
        )}
      </header>

      {needPass ? (
        <form onSubmit={unlock} className="m-auto flex w-full max-w-xs flex-col gap-3 p-6">
          <LockIcon size={26} weight="duotone" className="text-accent-text" />
          <p className="font-medium">这个压缩包有密码</p>
          <input className="field" type="password" autoFocus value={typed} onChange={event => setTyped(event.target.value)} aria-label="压缩包密码" />
          {wrongPass && archivePass && <p className="text-[13px] text-danger">密码不对</p>}
          <button className="btn btn-primary" type="submit" disabled={!typed}>打开</button>
        </form>
      ) : (
        <>
          <nav className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-3 py-2 text-[13px] [scrollbar-width:none]" aria-label="压缩包内路径">
            <button className="icon-btn size-7 shrink-0" onClick={() => go("/", false)} aria-label="压缩包根目录"><HouseIcon size={14} /></button>
            {parts.map((part, index) => (
              <span key={index} className="flex shrink-0 items-center">
                <CaretRightIcon size={10} className="text-faint" />
                <button className={`rounded-md px-1.5 py-0.5 ${index === parts.length - 1 ? "font-medium" : "text-muted hover:text-ink"}`}
                  onClick={() => go("/" + parts.slice(0, index + 1).join("/"), false)}>{part}</button>
              </span>
            ))}
          </nav>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout" custom={direction}>
              <motion.ul key={inner} custom={direction} className="absolute inset-0 overflow-y-auto p-2"
                variants={{ enter: (d: number) => ({ opacity: 0, x: d * 40 }), center: { opacity: 1, x: 0 }, exit: (d: number) => ({ opacity: 0, x: -d * 40 }) }}
                initial="enter" animate="center" exit="exit" transition={spring.snappy}>
                {loading && Array.from({ length: 8 }, (_, i) => <li key={i} className="skeleton my-1 h-10 rounded-lg" />)}
                {error && <li><ErrorState className="m-4" error={error} icon={FileArchiveIcon} /></li>}
                {!loading && !error && items.length === 0 && <li className="p-4 text-muted">这里是空的</li>}
                {items.map((item, index) => (
                  <li key={item.name} className="enter group flex h-11 items-center gap-3 rounded-lg px-2.5 hover:bg-[var(--hover)]" style={{ "--i": Math.min(index, 24) } as React.CSSProperties}>
                    <KindIcon kind={kindOf(item)} size={18} weight={item.is_dir ? "duotone" : "regular"} className={item.is_dir ? "shrink-0 text-accent-text" : "shrink-0 text-muted"} />
                    {item.is_dir ? (
                      <button className="min-w-0 flex-1 truncate text-left" onClick={() => go(join(inner, item.name), true)}>{item.name}</button>
                    ) : (
                      <a className="min-w-0 flex-1 truncate" href={fileUrl(item.name)} target="_blank" rel="noreferrer">{item.name}</a>
                    )}
                    {!item.is_dir && <span className="shrink-0 text-[12px] text-muted tabular">{formatBytes(item.size)}</span>}
                    {!item.is_dir && (
                      <span className="flex shrink-0 opacity-60 transition-opacity group-hover:opacity-100">
                        <a className="icon-btn size-8" href={fileUrl(item.name)} target="_blank" rel="noreferrer" aria-label="打开"><ArrowSquareOutIcon size={15} /></a>
                        <a className="icon-btn size-8" href={fileUrl(item.name)} download={item.name} aria-label="下载"><DownloadSimpleIcon size={15} /></a>
                      </span>
                    )}
                  </li>
                ))}
              </motion.ul>
            </AnimatePresence>
          </div>
          {meta.data?.comment && <p className="border-t border-line px-5 py-3 text-[12.5px] text-muted whitespace-pre-wrap">{meta.data.comment}</p>}
        </>
      )}
    </div>
  );
}
