/** Spec §7: hot decays on a 14-day half-life over a trailing 90-day window. */
export const HOT_HALF_LIFE_DAYS = 14;

/**
 * The window bounds the event scan; decay alone would not.
 *
 * At 90 days an event still contributes 0.5^(90/14) ≈ 1.2% of its weight, so
 * this cutoff is not about arithmetic — it is about I/O. Unlike computeScore,
 * which reads six precomputed counters, this function needs the individual
 * events, gathered by scanning signals/comments/photos by created_at. The
 * window is what keeps that query bounded and indexable as the site ages, and
 * the same cutoff has to hold here so the function agrees with the query that
 * feeds it. Don't remove it on the grounds that decay makes it redundant.
 */
export const HOT_WINDOW_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ActivityEvent {
  /** Same weights as the lifetime score — see DEFAULT_WEIGHTS. */
  weight: number;
  occurredAt: Date;
}

/** Unrounded contribution, so paginated jobs round only the final total. */
export function hotContribution(
  { weight, occurredAt }: ActivityEvent,
  now: Date,
  halfLifeDays = HOT_HALF_LIFE_DAYS,
  windowDays = HOT_WINDOW_DAYS,
): number {
  const ageDays = Math.max(
    0,
    (now.getTime() - occurredAt.getTime()) / MS_PER_DAY,
  );
  return ageDays > windowDays
    ? 0
    : weight * Math.pow(0.5, ageDays / halfLifeDays);
}

export function computeHotScore(
  events: readonly ActivityEvent[],
  now: Date,
  halfLifeDays: number = HOT_HALF_LIFE_DAYS,
  windowDays: number = HOT_WINDOW_DAYS,
): number {
  let total = 0;

  for (const event of events)
    total += hotContribution(event, now, halfLifeDays, windowDays);

  return Math.round(total * 1000) / 1000;
}
