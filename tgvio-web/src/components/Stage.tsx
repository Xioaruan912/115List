import { AnimatePresence, motion, type Variants } from "motion/react";
import { useRef } from "react";
import { ease } from "../lib/motion";
import { isInside } from "../lib/path";
import { DirectoryView, navOrigin } from "./DirectoryView";

type Direction = "down" | "up" | "side";

/**
 * Folder navigation as depth. Opening a folder zooms into the tile you tapped:
 * the old view swells and fades while the new one grows out of that point. Going
 * up reverses it. Jumping elsewhere slides sideways. One layer per folder, each
 * with its own scroll position.
 */
const variants: Variants = {
  enter: (d: Direction) => d === "down" ? { opacity: 0, scale: 0.9 } : d === "up" ? { opacity: 0, scale: 1.07 } : { opacity: 0, x: 48 },
  center: { opacity: 1, scale: 1, x: 0, transition: { duration: 0.62, ease: ease.expo } },
  exit: (d: Direction) => d === "down"
    ? { opacity: 0, scale: 1.1, transition: { duration: 0.42, ease: ease.expo } }
    : d === "up" ? { opacity: 0, scale: 0.93, transition: { duration: 0.42, ease: ease.expo } }
    : { opacity: 0, x: -48, transition: { duration: 0.32, ease: ease.expo } },
};

export function Stage({ path }: { path: string }) {
  const previous = useRef(path);
  const direction = useRef<Direction>("side");
  if (previous.current !== path) {
    direction.current = isInside(path, previous.current) ? "down" : isInside(previous.current, path) ? "up" : "side";
    previous.current = path;
  }
  const d = direction.current;
  const origin = d === "down" ? `${navOrigin.x * 100}% ${navOrigin.y * 100}%` : "50% 35%";
  return (
    <main className="fixed inset-0 overflow-hidden">
      <AnimatePresence initial={false} custom={d}>
        <motion.div
          key={path}
          custom={d}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          className="absolute inset-0"
          style={{ transformOrigin: origin }}
        >
          <DirectoryView path={path} />
        </motion.div>
      </AnimatePresence>
    </main>
  );
}
