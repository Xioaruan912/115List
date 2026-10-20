import { ArrowCounterClockwiseIcon, ArrowsClockwiseIcon, FolderSimpleIcon, MagnetIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { resourceAdmin, type ProbeResult, type ResourceConfig, type ResourceSite } from "../../api/resources";
import { FolderPicker } from "../../components/Dialogs";
import { ErrorState } from "../../components/ErrorState";
import { Sheet } from "../../components/Sheet";
import { useLibraryScope } from "../../hooks/useLibraryScope";
import { toast } from "../../stores/toast";

/**
 * 资源搜索: on or off, the sites (a name and a search address with {q}), and
 * a check of how each site answers this server. Sites open in the person's own
 * browser, so a site behind a human check still works for them.
 */

const STATE: Record<ProbeResult["state"], { label: string; dot: string; hint: string }> = {
  ok: { label: "正常", dot: "bg-accent", hint: "服务器能直接访问" },
  challenge: { label: "有人机验证", dot: "bg-[#e8b04b]", hint: "网站在线，开着人机验证：浏览器打开可以用，服务器直接读取用不了" },
  down: { label: "打不开", dot: "bg-danger", hint: "网站没有响应，可能失效或换了域名" },
};

export function ResourceSettings() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["resource-admin"], queryFn: resourceAdmin.get });
  const [draft, setDraft] = useState<ResourceConfig | null>(null);
  const [probe, setProbe] = useState<{ busy: boolean; results: ProbeResult[] }>({ busy: false, results: [] });
  const library = useLibraryScope();
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState("/");
  useEffect(() => { if (query.data && !draft) setDraft(query.data.config); }, [query.data, draft]);

  const save = async (config: ResourceConfig, done: string): Promise<boolean> => {
    try {
      const saved = await resourceAdmin.save(config);
      setDraft(saved.config);
      client.setQueryData(["resource-admin"], saved);
      void client.invalidateQueries({ queryKey: ["resources"] });
      toast.success(done);
      return true;
    } catch (error) { toast.error("没有保存", error); return false; }
  };
  const runProbe = async (): Promise<void> => {
    setProbe(state => ({ ...state, busy: true }));
    try { setProbe({ busy: false, results: (await resourceAdmin.probe()).results }); }
    catch (error) { setProbe({ busy: false, results: [] }); toast.error("检测失败", error); }
  };

  if (query.isError) return <ErrorState compact className="mt-8" error={query.error} onRetry={() => query.refetch()} />;
  if (!draft || !query.data) return <div className="skeleton mt-8 h-40 rounded-[var(--radius-sheet)]" />;
  const saved = query.data.config;
  const dirty = JSON.stringify(draft.sites) !== JSON.stringify(saved.sites);
  const edit = (index: number, change: Partial<ResourceSite>): void =>
    setDraft({ ...draft, sites: draft.sites.map((site, i) => i === index ? { ...site, ...change } : site) });

  return (
    <section className="mt-10">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-accent-text hairline"><MagnetIcon size={20} weight="fill" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold">资源搜索</h3>
          <p className="mt-0.5 max-w-[60ch] text-[12.5px] leading-relaxed text-muted">
            片库里的「找资源」：一键在下面的网站搜片名，带中文字幕的磁力排在前面，勾选、选好文件夹就用 115 离线下载，多个可以放进一个合集。网站默认在用户自己的浏览器里打开，复制磁力回来粘贴；SeedHub 也可以改成由服务器直接读取、直接列出磁力。
          </p>
        </div>
        <button type="button" role="switch" aria-checked={draft.enabled} aria-label="启用资源搜索" className="switch mt-1 shrink-0"
          onClick={() => void save({ ...saved, enabled: !draft.enabled }, draft.enabled ? "已关闭资源搜索" : "已打开资源搜索")} />
      </div>

      {/* Where downloads go: each title gets a folder of its own name inside. */}
      <div className="mt-4 flex flex-col gap-3 rounded-[14px] p-3.5 hairline sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">默认保存位置</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            下载时在这里新建一个以片名命名的文件夹，内容放在里面，比如 <span className="font-mono text-[12px]">{(saved.folder || library.paths[0] || "/115/我要看").replace(/\/$/, "")}/瘴气营地的青春性事与死亡</span>。每次下载前也可以临时换。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex max-w-[16rem] items-center gap-1.5 truncate text-[13px]" title={saved.folder}>
            <FolderSimpleIcon size={16} weight="duotone" className="shrink-0 text-accent-text" />
            {saved.folder || <span className="text-faint">{library.paths[0] ? `影视库第一个目录（${library.paths[0]}）` : "未设置"}</span>}
          </span>
          <button className="btn btn-line h-9 px-3.5 text-[13px]" onClick={() => { setTarget(saved.folder || library.paths[0] || "/"); setPicking(true); }}>更改</button>
        </div>
      </div>
      <Sheet open={picking} onClose={() => setPicking(false)} width={520} title="默认保存位置"
        footer={<><button className="btn btn-ghost" onClick={() => setPicking(false)}>取消</button>
          <button className="btn btn-primary" onClick={async () => { if (await save({ ...saved, folder: target }, "已保存默认保存位置")) setPicking(false); }}>保存到这里</button></>}>
        <FolderPicker start={saved.folder || library.paths[0] || "/"} value={target} onChange={setTarget} />
        <p className="mt-2 text-[12px] text-faint">{target}</p>
      </Sheet>

      <ul className="mt-4 space-y-2">
        {draft.sites.map((site, index) => {
          const result = probe.results.find(item => item.id === site.id);
          const state = result ? STATE[result.state] : null;
          return (
            <li key={index} className="rounded-[14px] p-3 hairline">
              <div className="flex flex-wrap items-center gap-2">
                <input className="field h-9 w-36 shrink-0 text-[13px]" value={site.name} onChange={event => edit(index, { name: event.target.value })} aria-label="网站名称" placeholder="名称" />
                <input className="field h-9 min-w-0 flex-1 basis-60 font-mono text-[12px]" value={site.search} onChange={event => edit(index, { search: event.target.value })}
                  aria-label="搜索地址" placeholder="https://example.com/search/{q}" spellCheck={false} />
                <select className="field h-9 w-auto shrink-0 text-[13px]" value={site.reader ?? ""} aria-label="打开方式"
                  onChange={event => edit(index, { reader: event.target.value as ResourceSite["reader"] })}>
                  <option value="">浏览器打开</option>
                  <option value="seedhub">服务器直接读取（SeedHub）</option>
                </select>
                <button type="button" role="switch" aria-checked={site.enabled !== false} aria-label={`启用 ${site.name}`} className="switch shrink-0"
                  onClick={() => edit(index, { enabled: site.enabled === false })} />
                <button className="icon-btn size-9 hover:text-danger" aria-label={`删除 ${site.name}`} onClick={() => setDraft({ ...draft, sites: draft.sites.filter((_, i) => i !== index) })}><TrashIcon size={16} /></button>
              </div>
              {state && result && (
                <p className="mt-2 flex items-center gap-2 text-[12px] text-muted" title={result.message}>
                  <span className={`size-1.5 rounded-full ${state.dot}`} aria-hidden />
                  <span className="text-ink">{state.label}</span>{state.hint}{result.ms ? <span className="text-faint tabular">· {result.ms} ms</span> : null}
                  {result.message && result.state === "down" && <span className="text-faint">· {result.message}</span>}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[12px] leading-relaxed text-faint">「浏览器打开」适用于任何网站：在用户的浏览器里打开搜索页，复制磁力回来粘贴。「服务器直接读取」只认 SeedHub 的网页格式：服务器替你搜、直接列出磁力，网站改版或开了人机验证就会失效，到时换回浏览器打开即可。</p>
      <p className="mt-1.5 text-[12px] text-faint">搜索地址里用 <span className="font-mono">{"{q}"}</span> 代表片名，比如 <span className="font-mono">{"https://www.seedhub.cc/s/{q}/"}</span>。以后想加别的网站，照这个格式填就行。</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn btn-line h-9 px-3.5 text-[13px]" onClick={() => setDraft({ ...draft, sites: [...draft.sites, { id: "", name: "", search: "https://", enabled: true }] })}><PlusIcon size={15} />添加网站</button>
        <button className="btn btn-line h-9 px-3.5 text-[13px]" disabled={probe.busy || dirty || !saved.sites.length} onClick={() => void runProbe()} title={dirty ? "先保存再检测" : undefined}>
          <ArrowsClockwiseIcon size={15} className={probe.busy ? "spin" : ""} />{probe.busy ? "检测中" : "检测网站"}
        </button>
        {!saved.sites.some(site => site.search.includes("seedhub")) && (
          <button className="btn btn-ghost h-9 px-3 text-[13px]" onClick={() => setDraft({ ...draft, sites: [...draft.sites, ...query.data.default] })}><ArrowCounterClockwiseIcon size={15} />加回 SeedHub</button>
        )}
        {dirty && (
          <>
            <span className="flex-1" />
            <button className="btn btn-ghost h-9 px-3 text-[13px]" onClick={() => setDraft(saved)}>还原</button>
            <button className="btn btn-primary h-9 px-4 text-[13px]" onClick={() => void save(draft, "已保存资源网站")}>保存</button>
          </>
        )}
      </div>
    </section>
  );
}
