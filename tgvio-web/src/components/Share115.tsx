import { ArrowDownIcon, CaretRightIcon, CheckIcon, FolderSimpleIcon, LinkIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { share115, type ShareItem, type SharePeek } from "../api/share115";
import * as actions from "../lib/actions";
import { formatBytes } from "../lib/format";
import { kindOf } from "../lib/kind";
import { reason } from "../lib/errors";
import { toast } from "../stores/toast";
import { ErrorState } from "./ErrorState";
import { KindIcon } from "./KindIcon";
import { Sheet } from "./Sheet";

/**
 * 转存 115 分享: paste a share link (with its 提取码), see what it holds,
 * walk into its folders, tick what to keep and save it into the open folder.
 * 115 copies the files on its side; nothing passes through the server.
 */

type Crumb = { id: string; name: string };

export function Share115Dialog({ dir, onClose }: { dir: string; onClose: () => void }) {
  const [link, setLink] = useState("");
  const [peek, setPeek] = useState<SharePeek | null>(null);
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const read = async (inside?: Crumb, path: Crumb[] = []): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const out = await share115.peek(link, dir, inside?.id ?? "");
      setPeek(out);
      setTrail(inside ? [...path, inside] : []);
      setPicked(new Set(out.items.map(item => item.id)));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await share115.save(link, dir, [...picked]);
      toast.success("已转存", `${picked.size} 项存到了当前文件夹`);
      void actions.reload(dir, true);
      onClose();
    } catch (err) {
      toast.error("转存失败", err);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string): void => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const items = peek?.items ?? [];

  return (
    <Sheet open onClose={onClose} width={580} title="转存 115 分享"
      footer={peek ? (
        <>
          {items.length > 1 && (
            <button className="btn btn-ghost mr-auto" onClick={() => setPicked(picked.size ? new Set() : new Set(items.map(item => item.id)))}>
              {picked.size ? "全不选" : "全选"}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={!picked.size || saving} onClick={() => void save()}>
            <ArrowDownIcon size={15} />{saving ? "转存中…" : `转存 ${picked.size} 项`}
          </button>
        </>
      ) : (
        <>
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={!link.trim() || loading} onClick={() => void read()}>{loading ? "读取中…" : "读取分享"}</button>
        </>
      )}>
      {!peek && (
        <>
          <label className="label" htmlFor="share115-link">分享链接</label>
          <textarea id="share115-link" className="field text-[13px]" rows={3} value={link} autoFocus spellCheck={false}
            onChange={event => setLink(event.target.value)}
            placeholder={"https://115.com/s/sw…?password=abcd\n也可以直接粘贴「链接 + 提取码」整段文字"} />
          <p className="mt-2 text-[12.5px] text-muted">由 115 在网盘里直接复制，存到「{dir.split("/").pop() || "/"}」。</p>
          {!!error && <ErrorState compact className="mt-4" error={error} onRetry={() => void read()} />}
        </>
      )}
      {peek && (
        <>
          <div className="flex items-center gap-2 text-[13px]">
            <LinkIcon size={15} className="shrink-0 text-muted" />
            <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" aria-label="分享里的位置">
              <button className={`shrink-0 rounded-[8px] px-1.5 py-1 ${trail.length ? "text-muted hover:bg-[var(--hover)] hover:text-ink" : "font-medium"}`}
                disabled={!trail.length || loading} onClick={() => void read()}>{peek.title || "分享"}</button>
              {trail.map((crumb, index) => (
                <span key={crumb.id} className="flex shrink-0 items-center">
                  <CaretRightIcon size={12} className="mx-0.5 text-faint" />
                  <button className={`rounded-[8px] px-1.5 py-1 ${index === trail.length - 1 ? "font-medium" : "text-muted hover:bg-[var(--hover)] hover:text-ink"}`}
                    disabled={index === trail.length - 1 || loading} onClick={() => void read(crumb, trail.slice(0, index))}>{crumb.name}</button>
                </span>
              ))}
            </nav>
            {loading && <span className="spin size-4 rounded-full border-2 border-line-strong border-t-accent" />}
          </div>
          {!!error && <p className="mt-2 text-[12.5px] text-danger">{reason(error)}</p>}
          {!items.length && <p className="py-10 text-center text-[13px] text-muted">这里是空的</p>}
          <ul className="mt-2 max-h-[min(52dvh,420px)] divide-y divide-line overflow-y-auto">
            {items.map((item: ShareItem) => {
              const on = picked.has(item.id);
              return (
                <li key={item.id} className="flex items-center gap-3 py-2.5">
                  <button type="button" aria-pressed={on} aria-label={`选择 ${item.name}`} onClick={() => toggle(item.id)}
                    className={`grid size-[18px] shrink-0 place-items-center rounded-full transition-colors ${on ? "bg-accent text-accent-ink" : "hairline"}`}>
                    {on && <CheckIcon size={11} weight="bold" />}
                  </button>
                  <span className="shrink-0 text-muted">
                    {item.is_dir ? <FolderSimpleIcon size={17} weight="fill" className="text-accent-text opacity-80" /> : <KindIcon kind={kindOf({ name: item.name, is_dir: false, type: 0 })} size={17} />}
                  </span>
                  {item.is_dir ? (
                    <button className="min-w-0 flex-1 truncate text-left text-[14px] hover:underline" disabled={loading} onClick={() => void read({ id: item.id, name: item.name }, trail)}>{item.name}</button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[14px]">{item.name}</span>
                  )}
                  <span className="shrink-0 text-[12px] text-faint tabular">{item.size ? formatBytes(item.size) : ""}</span>
                </li>
              );
            })}
          </ul>
          {peek.count > items.length && <p className="mt-2 text-[12px] text-faint">只列出了前 {items.length} 项（共 {peek.count} 项），可以进子文件夹分开转存。</p>}
        </>
      )}
    </Sheet>
  );
}
