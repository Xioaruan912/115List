import { XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "../hooks/useMedia";
import { spring } from "../lib/motion";

/**
 * Modal surface. A centred card on wide screens that settles in on a spring; a
 * bottom sheet on phones that follows the finger and closes when flung down.
 */
export function Sheet({ open, onClose, title, children, footer, width = 460 }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const mobile = useIsMobile();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    const restore = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      const target = panel.current?.querySelector<HTMLElement>("[autofocus], input, textarea, select, button:not([data-close])");
      target?.focus();
    });
    return () => { window.removeEventListener("keydown", onKey, true); restore?.focus?.(); };
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo): void => {
    if (info.offset.y > 110 || info.velocity.y > 600) onClose();
  };

  return createPortal(
    <AnimatePresence propagate>
      {open && (
        <div className="fixed inset-0 z-[65] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true">
          <motion.div
            className="absolute inset-0 bg-scrim"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.28 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            className="relative flex max-h-[88dvh] w-full flex-col overflow-hidden bg-raised hairline sm:rounded-[var(--radius-sheet)] rounded-t-[var(--radius-sheet)]"
            style={{ maxWidth: mobile ? undefined : width, boxShadow: "var(--shadow-float)" }}
            initial={mobile ? { y: "100%" } : { opacity: 0, y: 24, scale: 0.94 }}
            animate={mobile ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
            exit={mobile ? { y: "100%" } : { opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.16 } }}
            transition={spring.sheet}
            drag={mobile ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={onDragEnd}
          >
            {mobile && <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line-strong" />}
            <header className="flex shrink-0 items-center justify-between gap-4 px-5 pt-4 pb-2">
              <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
              <button className="icon-btn -mr-2" onClick={onClose} aria-label="关闭" data-close><XIcon size={18} /></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1">{children}</div>
            {footer && <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3.5 pb-[max(0.9rem,env(safe-area-inset-bottom))]">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
