/**
 * FLIP for the file grid, outside React. Before a change (delete, sort, rename,
 * new folder) capture() records where every visible tile is; after React commits,
 * play() moves each tile from its old place to its new one with the Web
 * Animations API (transform only, on the compositor). Tiles that were not there
 * before fade up. leave() shrinks tiles away before they are removed.
 */
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
let snapshot: Map<string, DOMRect> | null = null;

function reduced(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function tiles(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-view="active"] [data-flip]')];
}

export function capture(): void {
  if (reduced()) return;
  snapshot = new Map(tiles().map(element => [element.dataset.flip!, element.getBoundingClientRect()]));
}

export function play(): void {
  const before = snapshot;
  snapshot = null;
  if (!before) return;
  for (const element of tiles()) {
    const old = before.get(element.dataset.flip!);
    const now = element.getBoundingClientRect();
    if (!old) {
      element.animate([{ opacity: 0, transform: "scale(0.86)" }, { opacity: 1, transform: "none" }], { duration: 520, easing: EASE });
      continue;
    }
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
      duration: 560 + Math.min(240, Math.hypot(dx, dy) / 4),
      easing: EASE,
    });
  }
}

export async function leave(names: Iterable<string>): Promise<void> {
  if (reduced()) return;
  const wanted = new Set(names);
  const going = tiles().filter(element => wanted.has(element.dataset.flip!));
  await Promise.all(going.map((element, index) => element.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.7) rotate(-3deg)", filter: "blur(4px)" }],
    { duration: 260, delay: Math.min(index, 10) * 18, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
  ).finished.catch(() => undefined)));
}

/** Leave, then capture the survivors, so the caller can mutate and play(). */
export async function leaveThenCapture(names: Iterable<string>): Promise<void> {
  await leave(names);
  capture();
}
