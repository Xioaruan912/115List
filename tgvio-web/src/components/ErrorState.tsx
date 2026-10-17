import { ArrowClockwiseIcon, CopySimpleIcon, FilmStripIcon, type Icon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { explain } from "../lib/errors";
import { copyText } from "../lib/links";
import { spring } from "../lib/motion";
import { toast } from "../stores/toast";

/**
 * Failure as a broken reel ("断片"): a strip of film torn in two across the
 * middle of the page. The halves spring apart with sparks at the tear and sway
 * there; "重试" slides them back together, a flash marks the splice, and only
 * then is the request repeated. The words come from lib/errors, never the raw
 * server message, which is only reachable through "复制详情".
 */

// Jagged tear, shared by both halves so they fit back together exactly:
// [offset into the 12 px overlap, height].
const TEAR: [number, number][] = [[0, 0], [7, 14], [2, 30], [10, 47], [3, 63], [9, 80], [1, 100]];
const OVERLAP = 12;

function tearClip(side: -1 | 1): string {
  if (side < 0) {
    const edge = TEAR.map(([x, y]) => `calc(100% - ${OVERLAP - x}px) ${y}%`);
    return `polygon(0 0, ${edge.join(", ")}, 0 100%)`;
  }
  const edge = [...TEAR].reverse().map(([x, y]) => `${x}px ${y}%`);
  return `polygon(${TEAR[0][0]}px 0, 100% 0, 100% 100%, ${edge.join(", ")})`;
}

function Half({ side, joined, sway }: { side: -1 | 1; joined: boolean; sway: boolean }) {
  return (
    <motion.div
      data-half={side}
      className={`relative h-[92px] w-[min(36vw,216px)] ${side > 0 ? "-ml-3" : ""}`}
      style={{ transformOrigin: side < 0 ? "10% 50%" : "90% 50%" }}
      initial={{ x: 0, y: 0, rotate: 0 }}
      animate={joined ? { x: 0, y: 0, rotate: 0 } : { x: side * 18, y: side * 6, rotate: side * 7 }}
      transition={joined ? spring.snappy : { ...spring.pop, delay: 0.18 }}
    >
      <motion.div className="absolute inset-0" animate={sway ? { rotate: [0, side * 1.8, 0], y: [0, side * -2, 0] } : { rotate: 0, y: 0 }}
        transition={sway ? { duration: 3.8, repeat: Infinity, ease: "easeInOut", delay: side > 0 ? 0.6 : 0.9 } : spring.snappy}>
        <div className={`reel absolute inset-0 ${side < 0 ? "reel-left" : "reel-right"}`} style={{ clipPath: tearClip(side) }}>
          <div className="reel-frames"><span /><span /></div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Reel({ joined, splice }: { joined: boolean; splice: number }) {
  const reduced = useReducedMotion();
  return (
    <div className="relative flex items-center justify-center" aria-hidden>
      <div className="absolute -inset-x-16 -inset-y-10 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--danger)_14%,transparent),transparent)] blur-xl" />
      <Half side={-1} joined={joined || !!reduced} sway={!joined && !reduced} />
      <Half side={1} joined={joined || !!reduced} sway={!joined && !reduced} />
      {/* Sparks fly out of the tear when it breaks. */}
      {!reduced && !joined && [-70, -30, 10, 45, 80].map((angle, i) => (
        <motion.i key={`${splice}-${angle}`} className="absolute left-1/2 top-1/2 block h-[2px] w-4 origin-left rounded-full bg-accent"
          style={{ rotate: angle }}
          initial={{ scaleX: 0, opacity: 0, x: 0 }} animate={{ scaleX: [0, 1, 0.3], opacity: [0, 1, 0], x: [0, 20 + i * 4, 34 + i * 6] }}
          transition={{ duration: 0.7, delay: 0.16 + i * 0.03, ease: [0.16, 1, 0.3, 1] }} />
      ))}
      {/* The splice: a white flash where the halves meet again. */}
      <AnimatePresence>
        {joined && splice > 0 && (
          <motion.span key={splice} className="absolute left-1/2 top-1/2 -ml-8 -mt-14 h-28 w-16 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.9),transparent)]"
            initial={{ opacity: 0, scaleY: 0.4 }} animate={{ opacity: [0, 1, 0], scaleY: [0.4, 1.2, 1] }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }} />
        )}
      </AnimatePresence>
    </div>
  );
}

export function ErrorState({ error, onRetry, compact = false, icon: IconComponent = FilmStripIcon, title, hint, extra, className = "" }: {
  error: unknown;
  onRetry?: () => unknown;
  compact?: boolean;
  icon?: Icon;
  /** Override the wording when the caller knows better. */
  title?: string;
  hint?: string;
  extra?: ReactNode;
  className?: string;
}) {
  const explained = useMemo(() => explain(error), [error]);
  const [busy, setBusy] = useState(false);
  const [splice, setSplice] = useState(0);
  useEffect(() => { if (explained.raw) console.warn("[tgvio-web]", explained.raw); }, [explained.raw]);
  // A fresh failure tears the reel again.
  useEffect(() => { setBusy(false); }, [error]);

  const retry = async (): Promise<void> => {
    if (!onRetry || busy) return;
    setBusy(true);
    setSplice(n => n + 1);
    await new Promise(resolve => setTimeout(resolve, 420)); // let the halves meet first
    try { await onRetry(); } catch { /* the next error renders on its own */ }
    window.setTimeout(() => setBusy(false), 600);
  };
  const copy = (): void => void copyText(explained.raw).then(() => toast.success("已复制错误详情"));
  const canRetry = !!onRetry && explained.retry;
  // Clicks here are not the start of a rubber-band selection behind us.
  const shield = { onPointerDown: (event: React.PointerEvent) => event.stopPropagation() };

  if (compact) {
    return (
      <motion.div {...shield} className={`flex items-center gap-3 rounded-[var(--radius-tile)] bg-[color-mix(in_srgb,var(--danger)_6%,transparent)] px-3 py-2.5 ${className}`}
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft} role="alert">
        <motion.span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger"
          initial={{ rotate: -14, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={spring.pop} aria-hidden>
          <IconComponent size={19} weight="duotone" />
        </motion.span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium">{title ?? explained.title}</p>
          <p className="truncate text-[12.5px] text-muted">{hint ?? explained.hint}</p>
        </div>
        {canRetry && (
          <button className="btn btn-line h-8 shrink-0 px-3 text-[12.5px]" disabled={busy} onClick={() => void retry()}>
            <ArrowClockwiseIcon size={14} className={busy ? "spin" : ""} />重试
          </button>
        )}
      </motion.div>
    );
  }
  return (
    <motion.div {...shield} className={`mx-auto flex w-full max-w-lg flex-col items-center px-4 py-14 text-center sm:py-20 ${className}`}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} role="alert">
      <Reel joined={busy} splice={splice} />
      <motion.h2 className="mt-12 text-[22px] font-semibold tracking-[-0.02em]" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.25 }}>
        {title ?? explained.title}
      </motion.h2>
      <motion.p className="mt-2 max-w-[40ch] text-pretty leading-relaxed text-muted" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.32 }}>
        {hint ?? explained.hint}
      </motion.p>
      <motion.div className="mt-7 flex flex-wrap items-center justify-center gap-2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.4 }}>
        {canRetry && (
          <button className="btn btn-primary h-11 px-5" disabled={busy} onClick={() => void retry()}>
            <ArrowClockwiseIcon size={16} weight="bold" className={busy ? "spin" : ""} />{busy ? "重新连接…" : "重试"}
          </button>
        )}
        {extra}
        {explained.raw && <button className="btn btn-ghost h-11 text-[13px] text-muted" onClick={copy}><CopySimpleIcon size={15} />复制详情</button>}
      </motion.div>
    </motion.div>
  );
}
