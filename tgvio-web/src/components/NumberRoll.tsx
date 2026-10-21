import { animate, useMotionValue, useReducedMotion, useTransform, motion } from "motion/react";
import { useEffect } from "react";

/** A number that springs to its new value; digits stay still thanks to tabular figures. */
export function NumberRoll({ value, format = (n: number) => String(Math.round(n)), className = "" }: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const motionValue = useMotionValue(reduced ? value : 0);
  const text = useTransform(motionValue, format);
  useEffect(() => {
    if (reduced) { motionValue.set(value); return; }
    const controls = animate(motionValue, value, { type: "spring", stiffness: 90, damping: 22, restDelta: 0.5 });
    return () => controls.stop();
  }, [value, reduced, motionValue]);
  return <motion.span className={`tabular ${className}`}>{text}</motion.span>;
}
