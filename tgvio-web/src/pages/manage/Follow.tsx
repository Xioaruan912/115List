import { ArrowsClockwiseIcon, FolderOpenIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { follow } from "../../api/follow";
import { encodePath } from "../../lib/path";
import { toast } from "../../stores/toast";

const day = (at: number): string => {
  const d = new Date(at * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function Follow() {
  const [, navigate] = useLocation();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["follow"], queryFn: follow.list, staleTime: 30_000 });
  const [busy, setBusy] = useState("");
  const items = query.data?.items ?? [];

  const check = async (): Promise<void> => {
    setBusy("check");
    try {
      const r = await follow.check();
      if (r.parts.length) toast.success("已开始下载", r.parts.join("、"));
      else toast.info("没有新集", "资源站上还没有库里缺的集");
      await client.invalidateQueries({ queryKey: ["follow"] });
    } catch (e) {
      toast.error("检查失败", e);
    } finally { setBusy(""); }
  };

  const remove = async (path: string, title: string): Promise<void> => {
    setBusy(path);
    try {
      await follow.remove(path);
      await client.invalidateQueries({ queryKey: ["follow"] });
      toast.success("已取消追番", title);
    } catch (e) {
      toast.error("取消失败", e);
    } finally { setBusy(""); }
  };

  return (
    <div className="space-y-4">
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">追番</h2>
            <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-muted">
              在剧集页点「追番」加入这里。服务端每 6 小时检查一次资源站，缺的集会自己下载并整理进对应的季。
            </p>
          </div>
          <button className="btn btn-line h-10 px-3" disabled={!!busy || items.length === 0} onClick={check}>
            <ArrowsClockwiseIcon size={15} className={busy === "check" ? "animate-spin" : ""} />立即检查
          </button>
        </div>
      </section>

      {items.length === 0 ? (
        <section className="panel p-5 text-[13px] text-muted">还没有追的季。打开一部剧的季页面，点「追番」即可。</section>
      ) : (
        <section className="panel divide-y divide-line">
          {items.map(item => (
            <div key={item.path} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{item.title}{item.season > 0 ? ` 第 ${item.season} 季` : ""}</p>
                <p className="mt-0.5 truncate text-[12px] text-muted">{item.path}</p>
                <p className="mt-1 text-[12px] text-faint">
                  {item.site} · 条目 {item.seed_title} · 加入于 {day(item.at)}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-ghost h-9 px-2.5 text-[13px]" onClick={() => navigate(encodePath(item.path))}>
                  <FolderOpenIcon size={15} />打开
                </button>
                <button className="btn btn-ghost h-9 px-2.5 text-[13px] text-danger" disabled={!!busy} onClick={() => remove(item.path, item.title)}>
                  <TrashIcon size={15} />取消
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
