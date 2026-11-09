import { ArrowDownIcon, CaretLeftIcon, MagnifyingGlassIcon, StarIcon, SubtitlesIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { shareSubtitles, type ShareSubtitleFile, type ShareSubtitleResult } from "../api/share";
import { basename } from "../lib/path";
import { toast } from "../stores/toast";
import { ErrorState } from "./ErrorState";
import { Sheet } from "./Sheet";

/**
 * 射手网 subtitles for a video in a share. A visitor has no account and writes
 * nothing into the share: the chosen subtitle is fetched as text and played
 * from memory by the player.
 */
export function ShareSubtitleSearch({ share, onClose, onUse }: {
  share: { sid: string; code: string; path: string };
  onClose: () => void;
  onUse: (picked: { name: string; text: string; lang: string }) => void;
}) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<ShareSubtitleResult | null>(null);
  const [busy, setBusy] = useState("");

  const results = useQuery({
    queryKey: ["share-sub-search", share.sid, share.path, query],
    queryFn: () => shareSubtitles.search(share.sid, share.code, share.path, query),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const files = useQuery({
    queryKey: ["share-sub-files", share.sid, chosen?.id],
    queryFn: () => shareSubtitles.files(share.sid, share.code, share.path, chosen!.id),
    enabled: !!chosen,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const use = async (result: ShareSubtitleResult, file: ShareSubtitleFile): Promise<void> => {
    setBusy(file.name);
    try {
      const got = await shareSubtitles.text(share.sid, share.code, share.path, result.id, file.name, result.lang ?? "");
      onUse({ name: got.name, text: got.text, lang: result.lang ?? "" });
      toast.success("字幕已加进播放器", got.name);
      onClose();
    } catch (error) {
      toast.error("没有取到字幕", error);
    } finally {
      setBusy("");
    }
  };

  return (
    <Sheet open onClose={onClose} width={600} title="在线搜索字幕"
      footer={<p className="mr-auto text-[12px] text-faint">字幕来自 <a href="https://assrt.net" target="_blank" rel="noreferrer" className="underline hover:text-ink">射手网 assrt.net</a>，只在这个播放器里用，不会存进分享。</p>}>
      <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); setChosen(null); setQuery(draft.trim()); }}>
        <label className="flex h-10 flex-1 items-center gap-2 rounded-[11px] bg-surface px-3 hairline focus-within:text-ink">
          <MagnifyingGlassIcon size={16} className="shrink-0 text-muted" />
          <input value={draft} onChange={event => setDraft(event.target.value)} placeholder={`按文件名匹配：${basename(share.path)}`} aria-label="字幕关键词"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint" />
        </label>
        <button className="btn btn-line h-10" type="submit">搜索</button>
      </form>
      <p className="mt-2 text-[12.5px] text-muted">{query ? `按「${query}」搜索` : "先按文件名匹配同一个版本的字幕；不准的话输入片名和集数再搜。"}</p>

      {!chosen && (
        <div className="mt-4">
          {results.isPending && <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-14 rounded-[12px]" />)}</div>}
          {results.isError && <ErrorState compact error={results.error} onRetry={() => results.refetch()} />}
          {results.data && !results.data.items.some(result => result.id > 0) && <p className="py-10 text-center text-[13.5px] text-muted">没有找到，换个关键词试试</p>}
          <ul className="divide-y divide-line">
            {results.data?.items.filter(result => result.id > 0).map(result => (
              <li key={result.id}>
                <button className="flex w-full items-start gap-3 py-3 text-left hover:bg-[var(--hover)] max-sm:-mx-1 max-sm:px-1 sm:rounded-[10px] sm:px-2" onClick={() => setChosen(result)}>
                  <SubtitlesIcon size={18} className="mt-0.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{result.name}</span>
                    {result.video && result.video !== result.name && <span className="block truncate text-[12px] text-faint">{result.video}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-[11.5px] text-muted">
                    <span className="flex gap-1">
                      {result.lang && <span className="rounded-[6px] px-1.5 py-0.5 hairline">{result.lang}</span>}
                      {result.type && <span className="rounded-[6px] px-1.5 py-0.5 font-mono hairline">{result.type}</span>}
                    </span>
                    {result.score ? <span className="inline-flex items-center gap-0.5 tabular"><StarIcon size={10} weight="fill" className="text-accent-text" />{result.score}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {chosen && (
        <div className="mt-4">
          <button className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink" onClick={() => setChosen(null)}><CaretLeftIcon size={13} />返回结果</button>
          <p className="truncate text-[14px] font-medium">{chosen.name}</p>
          {files.isPending && <div className="mt-3 skeleton h-12 rounded-[12px]" />}
          {files.isError && <ErrorState compact className="mt-3" error={files.error} onRetry={() => files.refetch()} />}
          {files.data && !files.data.items?.length && <p className="mt-4 text-[13px] text-muted">这个字幕包里没有能直接用的字幕文件（可能是压缩包），换一个试试。</p>}
          <ul className="mt-2 divide-y divide-line">
            {files.data?.items?.map(file => (
              <li key={file.name} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[13.5px]" title={file.name}>{file.name}</span>
                {file.size && <span className="shrink-0 text-[12px] text-faint">{file.size}</span>}
                <button className="btn btn-primary h-8 shrink-0 px-3 text-[13px]" disabled={!!busy} onClick={() => void use(chosen, file)}>
                  <ArrowDownIcon size={14} />{busy === file.name ? "取字幕中…" : "用这个"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
