import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  computeHotScore,
  HOT_WINDOW_DAYS,
  type ActivityEvent,
} from "../app/domain/scoring/hot";
import { weightForSignalKind } from "../app/domain/scoring/signal-weight";
import { DEFAULT_WEIGHTS, type ScoreWeights } from "../app/domain/scoring/weights";

const PAGE_SIZE = 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Reads every row of a windowed table, a page at a time.
 *
 * PostgREST caps a single response, so a naive select silently returns only the
 * first page and every spot past it would score 0 — a wrong answer that looks
 * like a working job.
 */
async function readAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  since: string,
  filter: (q: any) => any = (q) => q,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await filter(
      supabase.from(table).select(columns).gte("created_at", since),
    )
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Recomputes `spots.hot_score` for every spot.
 *
 * Spec §7: this is a scheduled Node job, deliberately not pg_cron. Computing it
 * in SQL would mean reimplementing the decay curve and the weights there — a
 * second copy of the ranking rules, free to drift from `domain/scoring`.
 *
 * Weights are applied through `weightForSignalKind`, the same mapping the
 * lifetime score uses, so a re-weighting cannot move one ranking without the
 * other.
 *
 * Returns the number of spots written.
 */
export async function refreshHotScores(
  supabase: SupabaseClient,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - HOT_WINDOW_DAYS * MS_PER_DAY).toISOString();
  const bySpot = new Map<string, ActivityEvent[]>();

  const add = (spotId: string, weight: number, occurredAt: string) => {
    const list = bySpot.get(spotId) ?? [];
    list.push({ weight, occurredAt: new Date(occurredAt) });
    bySpot.set(spotId, list);
  };

  const signals = await readAll<{
    spot_id: string;
    kind: "shoot_type_upvote" | "shoot_again";
    value: number;
    created_at: string;
  }>(supabase, "signals", "spot_id, kind, value, created_at", since);

  for (const s of signals) {
    const weight =
      s.kind === "shoot_again"
        ? weightForSignalKind({ kind: "shoot_again", value: s.value === 1 ? 1 : 0 }, weights)
        : weightForSignalKind({ kind: "shoot_type_upvote" }, weights);
    add(s.spot_id, weight, s.created_at);
  }

  const comments = await readAll<{ spot_id: string; created_at: string }>(
    supabase,
    "comments",
    "spot_id, created_at",
    since,
    (q) => q.eq("status", "published"),
  );
  for (const c of comments) {
    add(c.spot_id, weightForSignalKind({ kind: "comment" }, weights), c.created_at);
  }

  const photos = await readAll<{
    spot_id: string;
    kind: "scouting" | "session";
    created_at: string;
  }>(supabase, "photos", "spot_id, kind, created_at", since, (q) =>
    q.eq("status", "published"),
  );
  for (const p of photos) {
    add(p.spot_id, weightForSignalKind({ kind: "photo", photoKind: p.kind }, weights), p.created_at);
  }

  // Every spot is written, not just those with activity in the window. A job
  // that only touched spots it found events for would leave a stale nonzero
  // score on a spot that has gone quiet, so yesterday's hot list would stay hot
  // forever.
  let updated = 0;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("spots")
      .select("id")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const { id } of data as { id: string }[]) {
      const hot = computeHotScore(bySpot.get(id) ?? [], now);
      const { error: updateError } = await supabase
        .from("spots")
        .update({ hot_score: hot })
        .eq("id", id);
      if (updateError) throw updateError;
      updated += 1;
    }

    if (data.length < PAGE_SIZE) break;
  }

  return updated;
}

/** CLI entry point. Requires the service role key: this writes a derived column. */
async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const updated = await refreshHotScores(supabase);
  console.log(`Refreshed hot scores for ${updated} spots.`);
}

if (process.argv[1]?.endsWith("refresh-hot-scores.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
