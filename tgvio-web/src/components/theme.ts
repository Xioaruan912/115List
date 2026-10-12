import { flushSync } from "react-dom";
import { resolvedTheme, usePrefs, type Theme } from "../stores/prefs";

export function applyTheme(theme: Theme): void {
  const value = resolvedTheme(theme);
  document.documentElement.dataset.theme = value;
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.setAttribute("content", value === "dark" ? "#0c0c0d" : "#f1f2f3"));
}

type VTDocument = Document & { startViewTransition?: (update: () => void) => { ready: Promise<void> } };

/** The new theme spreads as a circle from where you clicked (View Transitions where available). */
export function switchTheme(theme: Theme, x = innerWidth / 2, y = 0): void {
  const doc = document as VTDocument;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const change = (): void => { flushSync(() => usePrefs.getState().setTheme(theme)); applyTheme(theme); };
  if (!doc.startViewTransition || reduced || resolvedTheme(theme) === document.documentElement.dataset.theme) { change(); return; }
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const transition = doc.startViewTransition(change);
  void transition.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 620, easing: "cubic-bezier(0.16, 1, 0.3, 1)", pseudoElement: "::view-transition-new(root)" },
    );
  });
}
