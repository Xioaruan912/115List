import type { Transition } from "motion/react";

/** Spring presets. Everything interactive moves on one of these. */
export const spring = {
  snappy: { type: "spring", stiffness: 560, damping: 40, mass: 0.7 } satisfies Transition,
  soft: { type: "spring", stiffness: 280, damping: 32, mass: 0.9 } satisfies Transition,
  // Quick and settling without overshoot (ζ≈0.93): UI state never bounces past its mark.
  pop: { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } satisfies Transition,
  sheet: { type: "spring", stiffness: 380, damping: 38, mass: 0.9 } satisfies Transition,
};

export const ease = {
  expo: [0.16, 1, 0.3, 1] as const,
  swift: [0.32, 0.72, 0, 1] as const,
};
