import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import { spring } from "../lib/motion";
import { useToasts } from "../stores/toast";

const TONE = {
  info: <InfoIcon size={18} className="text-muted" />,
  success: <CheckCircleIcon size={18} weight="fill" className="text-accent-text" />,
  error: <WarningCircleIcon size={18} weight="fill" className="text-danger" />,
};

/** Toasts stack at the top centre; newer ones push the older down a little and shrink them. */
export function Toaster() {
  const toasts = useToasts(state => state.toasts);
  const dismiss = useToasts(state => state.dismiss);
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-70 flex flex-col items-center gap-2 px-3" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((toast, index) => {
          const depth = toasts.length - 1 - index;
          return (
            <motion.div
              key={toast.id}
              layout
              className="glass pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-2xl px-4 py-3 hairline"
              style={{ boxShadow: "var(--shadow-float)", transformOrigin: "50% 0%" }}
              initial={{ opacity: 0, y: -28, scale: 0.9 }}
              animate={{ opacity: 1 - depth * 0.08, y: 0, scale: 1 - depth * 0.025 }}
              exit={{ opacity: 0, y: -16, scale: 0.92, transition: { duration: 0.18 } }}
              transition={spring.bouncy}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.6}
              onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 90) dismiss(toast.id); }}
            >
              <span className="mt-0.5 shrink-0">{TONE[toast.tone]}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug">{toast.title}</p>
                {toast.detail && <p className="mt-0.5 break-words text-[13px] text-muted">{toast.detail}</p>}
              </div>
              {toast.action && (
                <button className="btn btn-line h-7 px-2.5 text-[13px]" onClick={() => { toast.action?.run(); dismiss(toast.id); }}>{toast.action.label}</button>
              )}
              <button className="icon-btn -mr-2 -mt-1 h-7 w-7" onClick={() => dismiss(toast.id)} aria-label="关闭"><XIcon size={14} /></button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
