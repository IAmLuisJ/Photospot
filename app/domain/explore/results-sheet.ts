export type SheetSnap = "peek" | "half" | "full";

/** Ordered closed → open, so a step is an index change. */
const ORDER: readonly SheetSnap[] = ["peek", "half", "full"];

export const SNAP_HEIGHTS: Record<SheetSnap, string> = Object.freeze({
  peek: "18vh",
  half: "50vh",
  full: "88vh",
});

/** Below this, a drag is a wobble rather than an intent. */
const STEP_PIXELS = 100;
/** px/ms. A flick past this wins regardless of how far it travelled. */
const FLICK_VELOCITY = 1.2;

const clampIndex = (i: number) => Math.min(ORDER.length - 1, Math.max(0, i));

/**
 * Where a drag lands.
 *
 * `deltaY` and `velocityY` follow screen coordinates: negative is upward, which
 * opens the sheet. Velocity is checked before distance because a flick is an
 * intent, not a measurement — without it a fast short swipe springs back and
 * the sheet feels stuck to the thumb.
 */
export function nextSnap(current: SheetSnap, deltaY: number, velocityY: number): SheetSnap {
  const index = ORDER.indexOf(current);

  if (velocityY <= -FLICK_VELOCITY) return ORDER[clampIndex(index + 1)];
  if (velocityY >= FLICK_VELOCITY) return ORDER[clampIndex(index - 1)];

  // Truncated, not rounded: a drag has to fully cross a step to count, so
  // releasing mid-way returns to where it started rather than jumping ahead.
  const steps = Math.trunc(-deltaY / STEP_PIXELS);
  return ORDER[clampIndex(index + steps)];
}
