import type { Transition, Variants } from "motion/react";

// One place for the app's motion language so screens feel consistent.

export const spring: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 };
export const softSpring: Transition = { type: "spring", stiffness: 220, damping: 28 };
export const easeOut = [0.22, 1, 0.36, 1] as const;

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};

export const rise: Variants = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  // Drop the filter once done: any filter makes position:fixed descendants
  // (sheets opened from a section) position against the section, not the screen.
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.55, ease: easeOut }, transitionEnd: { filter: "none" } },
};

export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.85 },
  show: { opacity: 1, scale: 1, transition: spring },
};
