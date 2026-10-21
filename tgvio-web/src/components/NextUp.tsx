import { PlayIcon, XIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { spring } from "../lib/motion";

export interface NextEpisode {
  /** What the card says: the episode's title or file name. */
  title: string;
  thumb?: string;
  play: () => void;
}

const COUNTDOWN = 8;

/**
 * When an episode ends: the next one, playing by itself after a short count
 * unless the person cancels. The ring drains with the seconds left.
 */
export function NextUp({ next, onPlay, onCancel }: { next: NextEpisode; onPlay: () => void; onCancel: () => void }) {
  const [left, setLeft] = useState(COUNTDOWN);
  useEffect(() => {
    if (left <= 0) { onPlay(); return; }
    const timer = window.setTimeout(() => setLeft(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = 15;
  const length = 2 * Math.PI * r;
  return (
    <motion.div className="absolute bottom-[92px] right-3 z-[1] w-[min(86vw,340px)] overflow-hidden rounded-[16px] bg-black/75 text-white backdrop-blur-xl sm:right-5"
      style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.12), 0 24px 60px -24px rgb(0 0 0 / 0.8)" }}
      initial={{ opacity: 0, y: 18, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} transition={spring.soft}
      role="status" aria-live="polite">
      <div className="flex gap-3 p-3">
        <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-[10px] bg-white/10">
          {next.thumb && <img src={next.thumb} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] text-white/55 tabular">{left} 秒后播放下一集</p>
          <p className="mt-0.5 line-clamp-2 text-[13.5px] font-medium leading-snug" title={next.title}>{next.title}</p>
        </div>
        <button className="-m-1 grid size-8 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/12 hover:text-white" aria-label="不播下一集" onClick={onCancel}>
          <XIcon size={15} />
        </button>
      </div>
      <button className="flex w-full items-center justify-center gap-2 border-t border-white/10 py-2.5 text-[13.5px] font-medium text-accent hover:bg-white/8" onClick={onPlay}>
        <span className="relative grid size-[34px] place-items-center">
          <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r={r} fill="none" stroke="rgb(255 255 255 / 0.15)" strokeWidth="2.5" />
            <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={length} strokeDashoffset={length * (1 - left / COUNTDOWN)} style={{ transition: "stroke-dashoffset 1s linear" }} />
          </svg>
          <PlayIcon size={13} weight="fill" className="translate-x-px" />
        </span>
        立即播放
      </button>
    </motion.div>
  );
}
