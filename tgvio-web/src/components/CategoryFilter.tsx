import { motion } from "motion/react";
import { CATEGORY_LABEL, type Category } from "../api/posters";
import * as flip from "../lib/flip";
import { spring } from "../lib/motion";

/**
 * Narrow a folder to one kind of thing TMDB knows (电影, 电视剧, 动漫…). Shown
 * when the folder holds more than one kind; the pill slides between choices.
 */
export function CategoryFilter({ path, counts, total, value, onChange }: {
  path: string; counts: [Category, number][]; total: number; value: Category | "all"; onChange: (value: Category | "all") => void;
}) {
  const options: [Category | "all", string, number][] = [["all", "全部", total], ...counts.map(([cat, n]) => [cat, CATEGORY_LABEL[cat], n] as [Category, string, number])];
  return (
    <div className="-mx-1 flex max-w-full items-center gap-1 overflow-x-auto px-1 text-[13px] [scrollbar-width:none]" role="group" aria-label="分类">
      {options.map(([key, label, n]) => {
        const active = key === value;
        return (
          <button key={key} aria-pressed={active} onClick={() => { flip.capture(); onChange(key); }}
            className={`relative h-8 shrink-0 rounded-full px-3 transition-colors ${active ? "text-accent-ink" : "text-muted hover:text-ink"}`}>
            {active && <motion.span layoutId={`cat-${path}`} className="absolute inset-0 rounded-full bg-accent" transition={spring.snappy} />}
            <span className="relative tabular">{label}<span className={`ml-1 text-[11.5px] ${active ? "opacity-70" : "text-faint"}`}>{n}</span></span>
          </button>
        );
      })}
    </div>
  );
}

