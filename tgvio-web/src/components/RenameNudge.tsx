import { SparkleIcon, XIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { organize } from "../api/organize";
import { kindOf } from "../lib/kind";
import type { Obj } from "../lib/types";
import { useUi } from "../stores/ui";

/**
 * A folder made by 找资源 that is still waiting to be organized (kept on the
 * server, so any device sees it), once videos have arrived in it: one tap to
 * 按 TMDB 整理命名.
 */
export function RenameNudge({ path, items }: { path: string; items: Obj[] }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["organize", path], queryFn: () => organize.pending(path), staleTime: 30_000, retry: false, enabled: path !== "/" });
  if (query.data?.self !== "pending") return null;
  const arrived = items.some(item => item.is_dir || kindOf(item) === "video");
  if (!arrived) return null;
  const dismiss = (): void => void organize.mark([path], false).then(() => client.invalidateQueries({ queryKey: ["organize"] }));
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-[14px] bg-accent-soft px-4 py-3" style={{ boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent)" }}>
      <SparkleIcon size={18} weight="fill" className="shrink-0 text-accent-text" />
      <p className="min-w-0 flex-1 text-[13.5px]">资源下载到了。要按 TMDB 把文件整理成规范的名字吗？</p>
      <button className="btn btn-primary h-9 px-3.5 text-[13px]" onClick={() => useUi.getState().openDialog({ kind: "tmdb-rename", targets: [{ path }] })}>整理命名</button>
      <button className="icon-btn size-8" aria-label="不用了" title="不用整理，不再提示" onClick={dismiss}><XIcon size={14} /></button>
    </div>
  );
}
