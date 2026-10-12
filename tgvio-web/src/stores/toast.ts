import { create } from "zustand";

export type ToastTone = "info" | "success" | "error";

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">, ttl?: number) => number;
  dismiss: (id: number) => void;
}

let next = 1;

export const useToasts = create<ToastState>((set, getState) => ({
  toasts: [],
  push(toast, ttl = toast.tone === "error" ? 6000 : 3200) {
    const id = next++;
    set(state => ({ toasts: [...state.toasts.slice(-3), { ...toast, id }] }));
    if (ttl > 0) setTimeout(() => getState().dismiss(id), ttl);
    return id;
  },
  dismiss(id) {
    set(state => ({ toasts: state.toasts.filter(toast => toast.id !== id) }));
  },
}));

export const toast = {
  info: (title: string, detail?: string) => useToasts.getState().push({ tone: "info", title, detail }),
  success: (title: string, detail?: string) => useToasts.getState().push({ tone: "success", title, detail }),
  error: (title: string, error?: unknown) => useToasts.getState().push({
    tone: "error",
    title,
    detail: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
  }),
};
