/** Spec §7: hot decays on a 14-day half-life over a trailing 90-day window. */
export const HOT_HALF_LIFE_DAYS = 14;
export const HOT_WINDOW_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ActivityEvent {
  /** Same weights as the lifetime score — see DEFAULT_WEIGHTS. */
  weight: number;
  occurredAt: Date;
}

export function computeHotScore(
  events: readonly ActivityEvent[],
  now: Date,
  halfLifeDays: number = HOT_HALF_LIFE_DAYS,
  windowDays: number = HOT_WINDOW_DAYS,
): number {
  let total = 0;

  for (const { weight, occurredAt } of events) {
    // Clock skew must not let an event count for more than its face value.
    const ageDays = Math.max(0, (now.getTime() - occurredAt.getTime()) / MS_PER_DAY);
    if (ageDays > windowDays) continue;
    total += weight * Math.pow(0.5, ageDays / halfLifeDays);
  }

  return Math.round(total * 1000) / 1000;
}
