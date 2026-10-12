import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "../hooks/useMedia";
import { spring } from "../lib/motion";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

export type MenuEntry = MenuItem | "divider" | { heading: string };

/**
 * A floating menu at a point. It grows out of the corner nearest the pointer,
 * its rows cascade in, and it flips to stay inside the viewport.
 */
export function Menu({ open, x, y, onClose, entries, width = 220 }: {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  entries: MenuEntry[];
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mobile = useIsMobile();
  const [place, setPlace] = useState({ left: x, top: y, originX: 0, originY: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const height = ref.current?.offsetHeight ?? 300;
    const flipX = x + width + 8 > window.innerWidth;
    const flipY = y + height + 8 > window.innerHeight;
    setPlace({
      left: Math.max(8, flipX ? x - width : x),
      top: Math.max(8, flipY ? Math.max(8, y - height) : y),
      originX: flipX ? 1 : 0,
      originY: flipY ? 1 : 0,
    });
  }, [open, x, y, width, entries.length]);

  useEffect(() => {
    if (!open) return;
    if (mobile) {
      const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    const onDown = (event: PointerEvent): void => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    };
    const onScroll = (): void => onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, onClose, mobile]);

  if (mobile) return <ActionSheet open={open} onClose={onClose} entries={entries} />;

  let row = 0;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          role="menu"
          className="glass fixed z-40 rounded-2xl p-1.5 hairline"
          style={{ left: place.left, top: place.top, width, boxShadow: "var(--shadow-float)", transformOrigin: `${place.originX * 100}% ${place.originY * 100}%` }}
          initial={{ opacity: 0, scale: 0.88, filter: "blur(4px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.12 } }}
          transition={spring.snappy}
          onContextMenu={event => event.preventDefault()}
        >
          {entries.map((entry, index) => {
            if (entry === "divider") return <div key={index} className="mx-2 my-1 h-px bg-line" />;
            if ("heading" in entry) return <p key={index} className="truncate px-2.5 pt-1.5 pb-1 text-[12px] text-faint">{entry.heading}</p>;
            const delay = row++ * 0.018;
            return (
              <motion.button
                key={index}
                role="menuitem"
                disabled={entry.disabled}
                className={`flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13.5px] outline-none transition-colors disabled:opacity-40 ${entry.danger ? "text-danger hover:bg-danger/10 focus:bg-danger/10" : "hover:bg-[var(--hover)] focus:bg-[var(--hover)]"}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0, transition: { delay, ...spring.snappy } }}
                onClick={() => { onClose(); entry.run(); }}
              >
                <span className="grid w-4 place-items-center opacity-80">{entry.icon}</span>
                <span className="flex-1 truncate">{entry.label}</span>
                {entry.hint && <kbd className="font-mono text-[11px] text-faint">{entry.hint}</kbd>}
              </motion.button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Phones get the same entries as a bottom action sheet: it rises from the edge,
 * follows the finger and closes when flung down. Big rows, thumb reach.
 */
function ActionSheet({ open, onClose, entries }: { open: boolean; onClose: () => void; entries: MenuEntry[] }) {
  const heading = entries.find((entry): entry is { heading: string } => typeof entry === "object" && "heading" in entry);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[66]" role="menu">
          <motion.div className="absolute inset-0 bg-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="absolute inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] overflow-hidden rounded-[24px] bg-raised p-1.5 hairline"
            style={{ boxShadow: "var(--shadow-float)" }}
            initial={{ y: "110%" }} animate={{ y: 0 }} exit={{ y: "110%" }} transition={spring.sheet}
            drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.8 }}
            onDragEnd={(_, info) => { if (info.offset.y > 90 || info.velocity.y > 500) onClose(); }}
            onContextMenu={event => event.preventDefault()}
          >
            <div className="mx-auto mb-1 mt-1 h-1 w-9 rounded-full bg-line-strong" />
            {heading && <p className="truncate px-4 pb-1.5 pt-1 text-center text-[13px] text-muted">{heading.heading}</p>}
            {entries.map((entry, index) => {
              if (entry === "divider") return <div key={index} className="mx-3 my-1 h-px bg-line" />;
              if ("heading" in entry) return null;
              return (
                <motion.button key={index} role="menuitem" disabled={entry.disabled}
                  className={`flex h-[50px] w-full items-center gap-3.5 rounded-2xl px-4 text-left text-[16px] active:bg-[var(--hover)] disabled:opacity-35 ${entry.danger ? "text-danger" : ""}`}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { ...spring.snappy, delay: 0.04 + index * 0.02 } }}
                  onClick={() => { onClose(); entry.run(); }}>
                  <span className="grid w-5 place-items-center opacity-80 [&>svg]:size-[19px]">{entry.icon}</span>
                  <span className="flex-1 truncate">{entry.label}</span>
                </motion.button>
              );
            })}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
