import {
  ArrowsClockwiseIcon, CheckIcon, CopyIcon, LinkBreakIcon, LockSimpleIcon, ShareNetworkIcon, TrashIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LayoutGroup, motion, useReducedMotionConfig } from "motion/react";
import { memo, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { encode } from "uqr";
import { randomCode, shares, shareUrl, type Share } from "../api/share";
import { copyText } from "../lib/links";
import { spring } from "../lib/motion";
import { basename, join } from "../lib/path";
import { toast } from "../stores/toast";
import { Mark } from "./Mark";
import { Sheet } from "./Sheet";
import { ErrorState } from "./ErrorState";

/* ------------------------------------------------------------------ QR code */

/**
 * The QR code assembles itself: modules pop in on a ripple from the centre, the
 * three finder eyes spin into place last. Pure CSS on SVG rects (one keyframe,
 * per-module delay), so a 1 000-module code costs no React work after mount.
 */
export const QrCode = memo(function QrCode({ text, size = 196 }: { text: string; size?: number }) {
  const reduced = useReducedMotionConfig();
  const { cells, n } = useMemo(() => {
    const qr = encode(text, { ecc: "H", border: 0 });
    const count = qr.size;
    const centre = (count - 1) / 2;
    const hole = Math.round(count * 0.22); // room for the mark in the middle
    const out: { x: number; y: number; delay: number }[] = [];
    const eye = (x: number, y: number): boolean => (x < 7 && y < 7) || (x >= count - 7 && y < 7) || (x < 7 && y >= count - 7);
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (!qr.data[y][x] || eye(x, y)) continue;
        if (Math.abs(x - centre) <= hole / 2 && Math.abs(y - centre) <= hole / 2) continue;
        out.push({ x, y, delay: Math.hypot(x - centre, y - centre) * 22 });
      }
    }
    return { cells: out, n: count };
  }, [text]);
  const eyes: [number, number][] = [[0, 0], [n - 7, 0], [0, n - 7]];
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} width={size} height={size} className="block text-[#0c0c0d]" shapeRendering="crispEdges" role="img" aria-label="分享链接二维码">
        {cells.map(cell => (
          <rect key={`${cell.x}-${cell.y}`} x={cell.x + 0.06} y={cell.y + 0.06} width={0.88} height={0.88} rx={0.28} fill="currentColor"
            className={reduced ? undefined : "qr-dot"} style={{ animationDelay: `${cell.delay}ms` } as CSSProperties} />
        ))}
        {eyes.map(([x, y], index) => (
          <g key={index} className={reduced ? undefined : "qr-eye"} style={{ transformOrigin: `${x + 3.5}px ${y + 3.5}px`, animationDelay: `${420 + index * 90}ms` } as CSSProperties}>
            <rect x={x + 0.5} y={y + 0.5} width={6} height={6} rx={1.8} fill="none" stroke="currentColor" strokeWidth={1} />
            <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.9} fill="currentColor" />
          </g>
        ))}
      </svg>
      <motion.span className="absolute left-1/2 top-1/2 -ml-[11%] -mt-[11%] grid size-[22%] place-items-center rounded-[22%] bg-white p-[3%]"
        initial={reduced ? false : { scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ ...spring.pop, delay: 0.55 }}>
        <Mark className="size-full text-[clamp(12px,3.4vw,22px)]" rounded="rounded-[24%]" />
      </motion.span>
    </div>
  );
});

/* ------------------------------------------------------------------ helpers */

const DAY = 86_400_000;
const EXPIRY: [number, string][] = [[1, "1 天"], [7, "7 天"], [30, "30 天"], [0, "永久"]];
const LIMITS: [number, string][] = [[0, "不限"], [10, "10 次"], [50, "50 次"], [200, "200 次"]];

function Segmented<T extends number>({ id, value, options, onChange }: { id: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div className="grid rounded-[12px] bg-surface p-1 hairline" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup">
      {options.map(([option, label]) => {
        const active = option === value;
        return (
          <button key={option} type="button" role="radio" aria-checked={active} onClick={() => onChange(option)}
            className={`relative h-9 rounded-[9px] text-[13px] font-medium transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}>
            {active && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[9px] bg-raised" style={{ boxShadow: "var(--shadow-lift)" }} transition={spring.pop} />}
            <span className="relative">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function describeExpiry(expires: string | null): { text: string; over: boolean } {
  if (!expires || expires.startsWith("0001")) return { text: "永久有效", over: false };
  const left = new Date(expires).getTime() - Date.now();
  if (left <= 0) return { text: "已过期", over: true };
  if (left < DAY) return { text: `${Math.max(1, Math.round(left / 3_600_000))} 小时后过期`, over: false };
  return { text: `${Math.ceil(left / DAY)} 天后过期`, over: false };
}

function shareTitle(files: string[]): string {
  const first = basename(files[0] ?? "") || "分享";
  return files.length > 1 ? `${first} 等 ${files.length} 项` : first;
}

function clipboardText(share: Pick<Share, "id" | "pwd" | "files">): string {
  return `${shareTitle(share.files)}\n${shareUrl(share.id)}${share.pwd ? `\n提取码：${share.pwd}` : ""}`;
}

/** Each character drops into its slot, like a split-flap board. */
function Code({ value }: { value: string }) {
  return (
    <span className="inline-flex gap-1 font-mono text-[22px] font-semibold tracking-[0.08em]" aria-label={`提取码 ${value}`}>
      {[...value].map((char, index) => (
        <motion.span key={`${value}-${index}`} className="grid h-10 w-8 place-items-center rounded-[8px] bg-surface hairline"
          initial={{ rotateX: -90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ ...spring.pop, delay: 0.5 + index * 0.07 }}
          style={{ transformPerspective: 400 }}>
          {char}
        </motion.span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ dialog */

export function ShareDialog({ dir, names, onClose }: { dir: string; names: string[]; onClose: () => void }) {
  const client = useQueryClient();
  const [days, setDays] = useState(7);
  const [locked, setLocked] = useState(true);
  const [pwd, setPwd] = useState(() => randomCode());
  const [spins, setSpins] = useState(0);
  const [limit, setLimit] = useState(0);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Share | null>(null);
  const [copied, setCopied] = useState(false);
  const files = useMemo(() => names.map(name => join(dir, name)), [dir, names]);

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const share = await shares.create({
        files,
        expires: days ? new Date(Date.now() + days * DAY).toISOString() : null,
        pwd: locked ? pwd.trim() : "",
        max_accessed: limit,
        remark: remark.trim(),
      });
      setMade({ ...share, files: share.files?.length ? share.files : files });
      void client.invalidateQueries({ queryKey: ["shares"] });
    } catch (error) { toast.error("创建分享失败", error); }
    setBusy(false);
  };

  const copy = async (): Promise<void> => {
    if (!made) return;
    await copyText(clipboardText(made));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const native = made && typeof navigator.share === "function"
    ? () => void navigator.share({ title: shareTitle(made.files), text: made.pwd ? `提取码：${made.pwd}` : undefined, url: shareUrl(made.id) }).catch(() => undefined)
    : null;

  const footer = made ? (
    <>
      {native && <button className="btn btn-ghost" onClick={native}><ShareNetworkIcon size={16} />发送到…</button>}
      <button className="btn btn-primary" onClick={() => void copy()}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={copied ? "done" : "copy"} className="inline-flex items-center gap-1.5" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={spring.snappy}>
            {copied ? <><CheckIcon size={16} weight="bold" />已复制</> : <><CopyIcon size={16} />复制链接{made.pwd ? "和提取码" : ""}</>}
          </motion.span>
        </AnimatePresence>
      </button>
    </>
  ) : (
    <>
      <button className="btn btn-ghost" onClick={onClose}>取消</button>
      <button className="btn btn-primary" disabled={busy || (locked && !pwd.trim())} onClick={() => void create()}>{busy ? "正在创建…" : "创建链接"}</button>
    </>
  );

  return (
    <Sheet open onClose={onClose} width={480} title={made ? "链接已生成" : `分享 ${shareTitle(files)}`} footer={footer}>
      <LayoutGroup>
        <AnimatePresence mode="popLayout" initial={false}>
          {!made ? (
            <motion.div key="form" className="space-y-5" exit={{ opacity: 0, scale: 0.96, filter: "blur(6px)" }} transition={{ duration: 0.22 }}>
              <div>
                <span className="label">有效期</span>
                <Segmented id="expiry" value={days} options={EXPIRY} onChange={setDays} />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="label mb-0">提取码</span>
                  <button type="button" role="switch" aria-checked={locked} aria-label="需要提取码" className="switch" onClick={() => setLocked(!locked)} />
                </div>
                <AnimatePresence initial={false}>
                  {locked && (
                    <motion.div className="flex gap-2" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.soft} style={{ overflow: "hidden" }}>
                      <input className="field font-mono tracking-[0.12em]" value={pwd} maxLength={16} spellCheck={false} autoComplete="off"
                        onChange={event => setPwd(event.target.value.replace(/\s/g, ""))} aria-label="提取码" />
                      <button type="button" className="btn btn-line shrink-0 px-3" aria-label="换一个" onClick={() => { setPwd(randomCode()); setSpins(n => n + 1); }}>
                        <motion.span animate={{ rotate: spins * 180 }} transition={spring.pop} className="inline-flex"><ArrowsClockwiseIcon size={16} /></motion.span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div>
                <span className="label">访问次数</span>
                <Segmented id="limit" value={limit} options={LIMITS} onChange={setLimit} />
              </div>
              <label className="block">
                <span className="label">备注</span>
                <input className="field" value={remark} placeholder="只有你自己能看到" onChange={event => setRemark(event.target.value)} />
              </label>
            </motion.div>
          ) : (
            <motion.div key="ticket" className="relative"
              initial={{ opacity: 0, rotateX: 70, y: 40 }} animate={{ opacity: 1, rotateX: 0, y: 0 }} transition={{ ...spring.soft, delay: 0.08 }}
              style={{ transformPerspective: 900, transformOrigin: "50% 0%" }}>
              <div className="ticket relative overflow-hidden rounded-[18px] bg-surface hairline">
                <div className="flex flex-col items-center gap-4 px-5 pb-6 pt-6">
                  <div className="rounded-[16px] bg-white p-3" style={{ boxShadow: "0 18px 40px -20px rgb(0 0 0 / 0.5)" }}>
                    <QrCode text={shareUrl(made.id)} size={184} />
                  </div>
                  {made.pwd && <Code value={made.pwd} />}
                </div>
                <div className="ticket-cut" aria-hidden />
                <div className="space-y-2 px-5 pb-5 pt-4">
                  <button className="group flex w-full items-center gap-2 rounded-[10px] bg-bg px-3 py-2.5 text-left hairline" onClick={() => void copy()}>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-muted group-hover:text-ink">{shareUrl(made.id)}</span>
                    <CopyIcon size={15} className="shrink-0 text-faint group-hover:text-ink" />
                  </button>
                  <p className="text-[12.5px] text-muted">
                    {describeExpiry(made.expires).text}{made.max_accessed ? `，最多 ${made.max_accessed} 人访问` : ""}。在 账户 › 我的分享 里随时停用。
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ list */

function ShareRow({ share, index }: { share: Share; index: number }) {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const expiry = describeExpiry(share.expires);
  const spent = share.max_accessed > 0 && share.accessed >= share.max_accessed;
  const live = !share.disabled && !expiry.over && !spent;
  const refresh = (): Promise<void> => client.invalidateQueries({ queryKey: ["shares"] });
  const action = async (task: () => Promise<unknown>, done: string): Promise<void> => {
    try { await task(); toast.success(done); } catch (error) { toast.error("操作失败", error); }
    await refresh();
  };
  const meta: ReactNode[] = [
    `${share.accessed} 次访问${share.max_accessed ? ` / ${share.max_accessed}` : ""}`,
    share.disabled ? "已停用" : spent ? "次数已用完" : expiry.text,
  ];
  return (
    <motion.li layout className="flex items-center gap-3 rounded-[var(--radius-tile)] bg-surface px-3.5 py-3 hairline"
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: live ? 1 : 0.6, y: 0, transition: { ...spring.snappy, delay: Math.min(index, 12) * 0.035 } }}
      exit={{ opacity: 0, x: -30, transition: { duration: 0.2 } }}>
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${live ? "bg-accent text-accent-ink" : "bg-raised text-muted hairline"}`}>
        {live ? <ShareNetworkIcon size={18} weight="bold" /> : <LinkBreakIcon size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={share.files.join("\n")}>{share.remark || shareTitle(share.files)}</p>
        <p className="truncate text-[12.5px] text-muted tabular">
          {meta.join("，")}{share.pwd && <><LockSimpleIcon size={11} className="mb-0.5 ml-1.5 mr-0.5 inline" />{share.pwd}</>}
        </p>
      </div>
      <button className="icon-btn" aria-label="复制链接" onClick={() => void copyText(clipboardText(share)).then(() => toast.success("已复制链接"))}><CopyIcon size={17} /></button>
      <button type="button" role="switch" aria-checked={!share.disabled} aria-label={share.disabled ? "启用" : "停用"} className="switch"
        onClick={() => void action(() => shares.setEnabled(share.id, share.disabled), share.disabled ? "已启用分享" : "已停用分享")} />
      <AnimatePresence mode="popLayout" initial={false}>
        {confirm ? (
          <motion.button key="sure" className="btn btn-danger h-8 px-2.5 text-[12.5px]" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => void action(() => shares.remove(share.id), "已删除分享")} onBlur={() => setConfirm(false)} autoFocus>
            删除
          </motion.button>
        ) : (
          <motion.button key="ask" className="icon-btn hover:text-danger" aria-label="删除" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setConfirm(true)}>
            <TrashIcon size={17} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export function SharesDialog({ onClose }: { onClose: () => void }) {
  const query = useQuery({ queryKey: ["shares"], queryFn: shares.list });
  const list = useMemo(() => [...(query.data?.content ?? [])].reverse(), [query.data]);
  return (
    <Sheet open onClose={onClose} width={620} title="我的分享">
      {query.isPending && <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16 rounded-[var(--radius-tile)]" />)}</div>}
      {query.isError && <ErrorState compact error={query.error} onRetry={() => query.refetch()} />}
      {query.data && list.length === 0 && (
        <div className="flex flex-col items-start gap-2 py-4">
          <ShareNetworkIcon size={28} weight="duotone" className="text-accent-text" />
          <p className="font-medium">还没有分享</p>
          <p className="text-muted">在文件上点右键或长按，选「分享」就能生成链接和二维码。</p>
        </div>
      )}
      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {list.map((share, index) => <ShareRow key={share.id} share={share} index={index} />)}
        </AnimatePresence>
      </ul>
    </Sheet>
  );
}
