import { LinkSimpleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { trakt as api } from "../../api/trakt";
import { toast } from "../../stores/toast";

const day = (sec?: number): string => {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function Trakt() {
  const query = useQuery({ queryKey: ["trakt"], queryFn: api.get, staleTime: 30_000 });
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState("");
  useEffect(() => { if (query.data?.client_id) setId(query.data.client_id); }, [query.data?.client_id]);
  const status = query.data;
  const connected = !!status?.connected;

  const save = async (): Promise<void> => {
    if (!id.trim()) { toast.error("先填 Client ID"); return; }
    setBusy(true);
    try {
      await api.setId(id.trim());
      await query.refetch();
      toast.success("已保存 Client ID");
    } catch (e) {
      toast.error("保存失败", e);
    } finally { setBusy(false); }
  };

  const connect = async (): Promise<void> => {
    setBusy(true);
    try {
      const { url } = await api.connect();
      window.location.href = url;
    } catch (e) {
      toast.error("连接失败", e);
      setBusy(false);
    }
  };

  const sync = async (direction: "push" | "pull"): Promise<void> => {
    setSyncing(true);
    try {
      const r = await api.sync(direction);
      setSyncResult(direction === "push"
        ? `已推送：电影 ${r.movies ?? 0} 部、剧集 ${r.episodes ?? 0} 集（${r.shows ?? 0} 部剧）`
        : `已从 Trakt 标记 ${r.marked ?? 0} 个文件为已看（电影 ${r.movies ?? 0} 部）`);
      toast.success("同步完成");
    } catch (e) {
      toast.error("同步失败", e);
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.disconnect();
      await query.refetch();
      toast.success("已断开 Trakt");
    } catch (e) {
      toast.error("断开失败", e);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <section className="panel p-5">
        <h2 className="text-[15px] font-semibold">Trakt</h2>
        <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-muted">
          在 Trakt 上建一个 <b>公开应用（PKCE）</b>，把 Client ID 填在这里。Trakt 不给这类应用 Client Secret，
          登录走浏览器授权：点「连接 Trakt」，在 Trakt 页面确认后会自动回到这里。
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-[260px] flex-1">
            <span className="mb-1 block text-[12px] text-muted">Client ID</span>
            <input className="input h-10 w-full" value={id} onChange={e => setId(e.target.value)} placeholder="Trakt Client ID" spellCheck={false} />
          </label>
          <button className="btn btn-line h-10 px-3" disabled={busy} onClick={save}>保存</button>
        </div>
        {status?.redirect && (
          <p className="mt-3 break-all text-[12px] text-faint">
            Trakt 应用里的 <b>Redirect URI</b> 必须填：<code className="select-all text-muted">{status.redirect}</code>
          </p>
        )}
      </section>

      <section className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">连接状态</h2>
            <p className="mt-1 text-[13px] text-muted">
              {connected ? `已连接${status?.expires_at ? `，令牌有效到 ${day(status.expires_at)}` : ""}。` : "尚未连接。"}
            </p>
          </div>
          {connected
            ? <button className="btn btn-line h-10 px-3" disabled={busy} onClick={disconnect}>断开</button>
            : <button className="btn btn-primary h-10 px-4" disabled={busy || !status?.client_id} onClick={connect}><LinkSimpleIcon size={15} />连接 Trakt</button>}
        </div>
        <p className="mt-3 max-w-[70ch] text-[12.5px] leading-relaxed text-faint">
          连接后，播放会同步到 Trakt：开始播放时记一次「开始观看」，看完或播放到 80% 时记为已看。
        </p>
      </section>

      <section className="panel p-5">
        <h2 className="text-[15px] font-semibold">观看记录同步</h2>
        <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-muted">
          推送：把本库「已看完」的电影和剧集写入 Trakt 历史。<br />
          拉取：读取 Trakt 的已看记录，把库里有对应文件的作品标记为已看。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-line h-10 px-3" disabled={!connected || syncing} onClick={() => sync("push")}>推送已看到 Trakt</button>
          <button className="btn btn-line h-10 px-3" disabled={!connected || syncing} onClick={() => sync("pull")}>从 Trakt 拉取已看</button>
        </div>
        {syncResult && <p className="mt-3 text-[12.5px] text-muted">{syncResult}</p>}
      </section>
    </div>
  );
}
