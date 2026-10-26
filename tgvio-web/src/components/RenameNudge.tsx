import { CheckCircleIcon, CircleNotchIcon, SparkleIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AUTO_STATE, needText, organize } from "../api/organize";
import { resources } from "../api/resources";
import { dirKey } from "../hooks/useDir";
import { kindOf } from "../lib/kind";
import { isInside } from "../lib/path";
import type { Obj } from "../lib/types";
import { undoRun } from "../lib/undo";
import { useUi } from "../stores/ui";

/**
 * A folder 找资源 downloaded into, as the server's organizer sees it: still
 * downloading, being organized, organized just now (with undo), or left to a
 * person and why. Kept on the server, so any device sees the same. Folders
 * nobody organizes for the person (自动整理 turned off) get one tap to 整理.
 */
export function RenameNudge({ path, items }: { path: string; items: Obj[] }) {
  const client = useQueryClient();
  const self = useQuery({ queryKey: ["organize", path], queryFn: () => organize.pending(path), staleTime: 30_000, retry: false, enabled: path !== "/" });
  const settings = useQuery({ queryKey: ["resources"], queryFn: resources.list, staleTime: 5 * 60_000, enabled: path !== "/" });
  const recent = useQuery({
    queryKey: ["organize-recent"],
    queryFn: organize.recent,
    retry: false,
    enabled: path !== "/",
    // While something is downloading or being organized, every few seconds: the page follows it.
    refetchInterval: q => (q.state.data?.active.length ? 3000 : 15_000),
  });
  const mine = (p: string): boolean => p === path || isInside(path, p);
  const active = recent.data?.active.find(a => mine(a.path));
  const note = recent.data?.items.find(n => mine(n.path) && Date.now() - Date.parse(n.at) < 30 * 60_000);
  // Once the organizer is through, the folder's contents changed: show them as they are now.
  const was = useRef(active?.state);
  useEffect(() => {
    if (was.current && !active) {
      void client.invalidateQueries({ queryKey: dirKey(path) });
      void client.invalidateQueries({ queryKey: ["organize"] });
      void client.invalidateQueries({ queryKey: ["posters"] });
      void client.invalidateQueries({ queryKey: ["series"] });
    }
    was.current = active?.state;
  }, [active, client, path]);

  const box = "mb-6 flex flex-wrap items-center gap-3 rounded-[14px] px-4 py-3";
  const tinted = { boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent)" };
  const open = (): void => useUi.getState().openDialog({ kind: "tmdb-rename", targets: [{ path }] });

  if (active) {
    return (
      <div className={`${box} bg-accent-soft`} style={tinted} role="status" aria-live="polite">
        <CircleNotchIcon size={18} weight="bold" className="spin shrink-0 text-accent-text" />
        <p className="min-w-0 flex-1 text-[13.5px]">{AUTO_STATE[active.state]}</p>
      </div>
    );
  }
  if (note?.done) {
    return (
      <div className={`${box} bg-surface hairline`} role="status">
        <CheckCircleIcon size={18} weight="fill" className="shrink-0 text-accent-text" />
        <p className="min-w-0 flex-1 text-[13.5px]">已自动整理好：名字改成了规范的，广告和多余的一层文件夹已去掉。</p>
        {note.batch && (
          <button className="btn btn-line h-9 px-3.5 text-[13px]" onClick={() => void undoRun(note.batch as string).then(() => recent.refetch())}>撤销</button>
        )}
      </div>
    );
  }
  if (self.data?.self !== "pending") return null;
  if (note) {
    return (
      <div className={`${box} bg-accent-soft`} style={tinted} role="status">
        <WarningCircleIcon size={18} weight="fill" className="shrink-0 text-accent-text" />
        <p className="min-w-0 flex-1 text-[13.5px]">自动整理没做完：{needText(note)}。</p>
        <button className="btn btn-primary h-9 px-3.5 text-[13px]" onClick={open}>整理</button>
      </div>
    );
  }
  const arrived = items.some(item => item.is_dir || kindOf(item) === "video");
  if (settings.data?.auto_organize !== false) {
    // Waiting for the organizer's next look (a few seconds).
    return (
      <div className={`${box} bg-accent-soft`} style={tinted} role="status" aria-live="polite">
        <CircleNotchIcon size={18} weight="bold" className="spin shrink-0 text-accent-text" />
        <p className="min-w-0 flex-1 text-[13.5px]">{arrived ? "马上自动整理……" : AUTO_STATE.downloading}</p>
      </div>
    );
  }
  if (!arrived) return null;
  const dismiss = (): void => void organize.mark([path], false).then(() => client.invalidateQueries({ queryKey: ["organize"] }));
  return (
    <div className={`${box} bg-accent-soft`} style={tinted}>
      <SparkleIcon size={18} weight="fill" className="shrink-0 text-accent-text" />
      <p className="min-w-0 flex-1 text-[13.5px]">这里还没整理好：名字、广告文件、多余的文件夹。现在整理吗？</p>
      <button className="btn btn-primary h-9 px-3.5 text-[13px]" onClick={open}>整理</button>
      <button className="icon-btn size-8" aria-label="不用了" title="不用整理，不再提示" onClick={dismiss}><XIcon size={14} /></button>
    </div>
  );
}
