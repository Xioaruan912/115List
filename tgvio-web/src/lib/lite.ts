import { useSyncExternalStore } from "react";
import { usePrefs } from "../stores/prefs";

/**
 * 精简动效: whether the heavy effects are off on this device. Chosen in the
 * account menu (自动 / 完整 / 精简); 自动 turns them off for people who ask
 * their system for less motion, and for devices that cannot keep up: frames
 * are timed for a moment after the page opens, and if they come too slowly
 * the effects go (remembered for a day, so the next visit starts light).
 *
 * Lite means: no blur behind bars and menus, no film grain, no slow zoom on
 * the billboard, no 3D tilt, no drifting poster wall, no staggered entrances.
 * Everything still works; only the show is quieter.
 */

const AUTO_KEY = "tgvio-web:auto-lite";
const DAY = 86_400_000;

let autoLite = (() => {
  try { const at = Number(localStorage.getItem(AUTO_KEY)); return at > 0 && Date.now() - at < DAY; } catch { return false; }
})();
const listeners = new Set<() => void>();

function setAutoLite(on: boolean): void {
  if (on === autoLite) return;
  autoLite = on;
  try { if (on) localStorage.setItem(AUTO_KEY, String(Date.now())); else localStorage.removeItem(AUTO_KEY); } catch { /* ignore */ }
  listeners.forEach(listener => listener());
}

/** Time ~1.5 s of frames once the page has settled; slow ones mean a device that struggles. */
export function measureDevice(): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    if (document.hidden) return;
    const frames: number[] = [];
    let last = performance.now();
    const tick = (t: number): void => {
      frames.push(t - last);
      last = t;
      if (frames.length < 90) { requestAnimationFrame(tick); return; }
      if (document.hidden) return;
      const sorted = frames.slice(3).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const slow = sorted.filter(ms => ms > 34).length / sorted.length;
      setAutoLite(median > 24 || slow > 0.2);
    };
    requestAnimationFrame(tick);
  }, 2500);
}

const reducedQuery = typeof window !== "undefined" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  reducedQuery?.addEventListener("change", listener);
  return () => { listeners.delete(listener); reducedQuery?.removeEventListener("change", listener); };
}

export function useLite(): boolean {
  const mode = usePrefs(state => state.motion);
  const auto = useSyncExternalStore(subscribe, () => autoLite || !!reducedQuery?.matches, () => false);
  return mode === "lite" || (mode === "auto" && auto);
}

export const MOTION_LABEL = { auto: "自动", full: "完整", lite: "精简" } as const;
