import {
  ArrowsClockwiseIcon, BroomIcon, CheckIcon, FilmSlateIcon, ImageIcon, KeyIcon, MagnifyingGlassIcon, PlugsConnectedIcon, XIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { posterAdmin, posters, type PosterLanguage, type PosterSettings as Settings } from "../../api/posters";
import { ErrorState } from "../../components/ErrorState";
import { NumberRoll } from "../../components/NumberRoll";
import { reason } from "../../lib/errors";
import { formatBytes } from "../../lib/format";
import { spring } from "../../lib/motion";
import { toast } from "../../stores/toast";
import { useUi } from "../../stores/ui";

/**
 * Film posters (TMDB): on or off, the token (write-only, shown by its last four
 * characters), the language of titles and synopses, whether posters blur with
 * the covers, what was matched, and the names nothing was found for, each one a
 * click away from picking its poster by hand.
 */

const LANGUAGES: [PosterLanguage, string][] = [["zh-CN", "简体中文"], ["zh-TW", "繁體中文"], ["en-US", "English"], ["ja-JP", "日本語"]];

function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0">
        <p className="text-[14px] font-medium">{title}</p>
        {hint && <p className="mt-0.5 max-w-[52ch] text-[12.5px] leading-relaxed text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Stat({ label, value, index, accent = false }: { label: string; value: ReactNode; index: number; accent?: boolean }) {
  return (
    <motion.div className={`rounded-[var(--radius-tile)] px-4 py-3.5 ${accent ? "bg-accent-soft" : "bg-surface hairline"}`}
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.08 + index * 0.05 }}>
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className="mt-1 text-[26px] font-semibold leading-none tracking-[-0.03em] tabular">{value}</p>
    </motion.div>
  );
}

/** A button that asks once more before doing something it cannot undo. */
function SureButton({ label, sure, icon, onRun, disabled }: { label: string; sure: string; icon: ReactNode; onRun: () => Promise<void>; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <button className={`btn h-9 px-3.5 text-[13px] ${armed ? "btn-danger" : "btn-line"}`} disabled={disabled || busy}
      onBlur={() => setArmed(false)}
      onClick={async () => {
        if (!armed) { setArmed(true); return; }
        setBusy(true);
        try { await onRun(); } finally { setBusy(false); setArmed(false); }
      }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={armed ? "sure" : "ask"} className="inline-flex items-center gap-1.5" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={spring.snappy}>
          {busy ? <ArrowsClockwiseIcon size={15} className="spin" /> : icon}{armed ? sure : label}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

export default function PosterSettings() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["poster-settings"], queryFn: posterAdmin.get, refetchInterval: q => (q.state.data?.stats.pending ? 2500 : false) });
  const [editingToken, setEditingToken] = useState(false);
  const [token, setToken] = useState("");
  const [test, setTest] = useState<{ state: "idle" | "busy" | "ok" | "bad"; message?: string }>({ state: "idle" });

  const apply = (next: Settings): void => {
    client.setQueryData(["poster-settings"], next);
    void client.invalidateQueries({ queryKey: ["posters"] });
  };
  const save = async (change: Parameters<typeof posterAdmin.save>[0], done: string): Promise<boolean> => {
    try {
      apply(await posterAdmin.save(change));
      toast.success(done);
      return true;
    } catch (error) { toast.error("没有保存", error); return false; }
  };
  const runTest = async (): Promise<void> => {
    setTest({ state: "busy" });
    try { await posterAdmin.test(); setTest({ state: "ok" }); }
    catch (error) { setTest({ state: "bad", message: reason(error) }); }
  };

  if (query.isPending) return <div className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-20 rounded-xl" />)}</div>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data;
  const { config, stats } = data;
  const unmatched = stats.unmatched ?? [];

  return (
    <div>
      {/* Header: what this is, whether it is on, whether TMDB answers. */}
      <motion.section className="relative overflow-hidden rounded-[var(--radius-sheet)] bg-surface px-5 py-5 hairline sm:px-6"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
        <div className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]" />
        <div className="relative flex items-start gap-4">
          <motion.span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent text-accent-ink"
            initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ ...spring.bouncy, delay: 0.1 }}>
            <FilmSlateIcon size={24} weight="fill" />
          </motion.span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold tracking-tight">影视海报</h2>
            <p className="mt-0.5 max-w-[56ch] text-[13px] leading-relaxed text-muted">按文件夹和视频的名字到 TMDB 找海报、剧照和简介，用在网格封面和影院模式里。只请求 TMDB，不碰 115。</p>
          </div>
          <button type="button" role="switch" aria-checked={config.enabled} aria-label="启用海报" className="switch mt-1 shrink-0"
            onClick={() => void save({ config: { ...config, enabled: !config.enabled } }, config.enabled ? "已关闭海报" : "已打开海报")} />
        </div>
      </motion.section>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat index={0} accent label="已配上" value={<NumberRoll value={stats.matched} />} />
        <Stat index={1} label="手动指定" value={<NumberRoll value={stats.manual} />} />
        <Stat index={2} label="没配上" value={<NumberRoll value={stats.none} />} />
        <Stat index={3} label="图片缓存" value={<><NumberRoll value={stats.images} /><span className="ml-1.5 text-[13px] font-normal text-muted">{formatBytes(stats.image_bytes)}</span></>} />
      </div>
      <AnimatePresence>
        {stats.pending > 0 && (
          <motion.p className="mt-3 flex items-center gap-2 text-[12.5px] text-muted" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <span className="loader-bars scale-50" aria-hidden><i /><i /><i /><i /></span>还在后台匹配 {stats.pending} 个名字
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-2 divide-y divide-[var(--line)]">
        <Row title="TMDB 令牌" hint={data.token_set ? <>已设置，末尾 <span className="font-mono">{data.token_hint}</span>。只存在服务器上，不会再显示。</> : "在 themoviedb.org 的 设置 › API 里申请，填「API 读取访问令牌」或 API 密钥都行。"}>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-line h-9 px-3.5 text-[13px]" disabled={!data.token_set || test.state === "busy"} onClick={() => void runTest()}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={test.state} className="inline-flex items-center gap-1.5" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring.bouncy}>
                  {test.state === "busy" ? <><ArrowsClockwiseIcon size={15} className="spin" />测试中</>
                    : test.state === "ok" ? <><CheckIcon size={15} weight="bold" className="text-accent-text" />连接正常</>
                    : <><PlugsConnectedIcon size={15} />测试连接</>}
                </motion.span>
              </AnimatePresence>
            </button>
            <button className="btn btn-line h-9 px-3.5 text-[13px]" onClick={() => setEditingToken(open => !open)}><KeyIcon size={15} />{data.token_set ? "更换" : "填写"}</button>
          </div>
        </Row>
        <AnimatePresence initial={false}>
          {test.state === "bad" && (
            <motion.p key="bad" className="pb-4 text-[12.5px] text-danger" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              连不上 TMDB：{test.message}
            </motion.p>
          )}
          {editingToken && (
            <motion.form key="token" className="flex gap-2 overflow-hidden pb-5" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={spring.soft}
              onSubmit={async event => {
                event.preventDefault();
                if (!token.trim()) return;
                if (await save({ token: token.trim() }, "已保存令牌")) { setToken(""); setEditingToken(false); void runTest(); }
              }}>
              <input className="field font-mono text-[12.5px]" type="password" autoComplete="off" spellCheck={false} placeholder="粘贴新的令牌" value={token} onChange={event => setToken(event.target.value)} autoFocus />
              <button className="btn btn-primary shrink-0" disabled={!token.trim()}>保存</button>
            </motion.form>
          )}
        </AnimatePresence>

        <Row title="语言" hint="片名和简介用哪种语言。换了以后会重新匹配（手动选的保留）。">
          <div className="grid grid-cols-4 rounded-[12px] bg-surface p-1 hairline" role="radiogroup">
            {LANGUAGES.map(([value, label]) => {
              const active = config.language === value;
              return (
                <button key={value} type="button" role="radio" aria-checked={active}
                  className={`relative h-8 rounded-[9px] px-3 text-[12.5px] font-medium transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}
                  onClick={() => { if (!active) void save({ config: { ...config, language: value } }, `已改为${label}`); }}>
                  {active && <motion.span layoutId="poster-language" className="absolute inset-0 rounded-[9px] bg-raised" style={{ boxShadow: "var(--shadow-lift)" }} transition={spring.bouncy} />}
                  <span className="relative">{label}</span>
                </button>
              );
            })}
          </div>
        </Row>

        <Row title="海报也跟着封面模糊" hint="打开「模糊封面」时，海报和剧照也先模糊，悬停或长按才清楚。海报是公开图片，默认不模糊。">
          <button type="button" role="switch" aria-checked={config.blur} aria-label="海报也跟着封面模糊" className="switch"
            onClick={() => void save({ config: { ...config, blur: !config.blur } }, config.blur ? "海报不再模糊" : "海报会跟着封面模糊")} />
        </Row>

        <Row title="重新匹配" hint="改过文件夹名，或者 TMDB 新上了资料时用。手动选的海报不受影响。">
          <div className="flex flex-wrap gap-2">
            <SureButton label={`没配上的 ${stats.none} 个`} sure="确定重找" icon={<MagnifyingGlassIcon size={15} />} disabled={!stats.none}
              onRun={async () => { const r = await posterAdmin.reset("none"); apply(r.settings); toast.success("会重新查找", `${r.cleared} 个名字`); }} />
            <SureButton label="全部重新匹配" sure="确定全部重来" icon={<ArrowsClockwiseIcon size={15} />}
              onRun={async () => { const r = await posterAdmin.reset("auto"); apply(r.settings); toast.success("已清空自动匹配", `${r.cleared} 个，打开文件夹时重新匹配`); }} />
          </div>
        </Row>

        <Row title="图片缓存" hint="下载过的海报和剧照存在服务器上，之后不再请求 TMDB。清掉后会按需重新下载。">
          <SureButton label={`清空 ${formatBytes(stats.image_bytes)}`} sure="确定清空" icon={<BroomIcon size={15} />} disabled={!stats.images}
            onRun={async () => { const r = await posterAdmin.reset("images"); apply(r.settings); toast.success("已清空图片缓存", `${r.cleared} 张`); }} />
        </Row>
      </div>

      {/* Names with no poster, each one click away from choosing one by hand. */}
      <section className="mt-6">
        <h3 className="text-[14px] font-medium">没配上的名字</h3>
        <p className="mt-0.5 text-[12.5px] text-muted">{unmatched.length ? "点名字自己挑海报；不是影视的（比如「备份」）点 × 就不再出现。" : "全都配上了。"}</p>
        <motion.ul className="mt-3 flex flex-wrap gap-2" initial="hidden" animate="shown" variants={{ shown: { transition: { staggerChildren: 0.02 } } }}>
          <AnimatePresence initial={false}>
            {unmatched.map(name => (
              <motion.li key={name} layout variants={{ hidden: { opacity: 0, scale: 0.8, y: 8 }, shown: { opacity: 1, scale: 1, y: 0, transition: spring.bouncy } }}
                exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.18 } }}
                className="group inline-flex max-w-[22rem] items-center rounded-full bg-surface text-[13px] hairline transition-colors hover:bg-accent-soft">
                <button className="inline-flex min-w-0 items-center gap-1.5 py-1.5 pl-3 pr-1" onClick={() => useUi.getState().openDialog({ kind: "poster", name })} title={`给「${name}」挑海报`}>
                  <span className="truncate">{name}</span>
                  <ImageIcon size={14} className="shrink-0 text-faint transition-colors group-hover:text-accent-text" />
                </button>
                <button className="mr-1 grid size-6 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--hover)] hover:text-ink" aria-label={`「${name}」不用海报`}
                  onClick={async () => {
                    try {
                      await posters.set(name, null);
                      void client.invalidateQueries({ queryKey: ["poster-settings"] });
                      void client.invalidateQueries({ queryKey: ["posters"] });
                    } catch (error) { toast.error("没有改成", error); }
                  }}>
                  <XIcon size={12} weight="bold" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      </section>
    </div>
  );
}
