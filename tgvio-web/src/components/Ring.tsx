import { motion } from "motion/react";
import { spring } from "../lib/motion";

/** Circular progress. pathLength is animated by Motion's SVG support (one element, cheap). */
export function Ring({ value, size = 28, stroke = 2.5, className = "", track = true }: {
  value: number; // 0..1
  size?: number;
  stroke?: number;
  className?: string;
  track?: boolean;
}) {
  const r = (size - stroke) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`-rotate-90 ${className}`} aria-hidden>
      {track && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={stroke} />}
      <motion.circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke} strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: Math.max(0.001, Math.min(1, value)) }} transition={spring.soft}
      />
    </svg>
  );
}
