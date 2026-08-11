import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeScore } from "../app/domain/scoring/score";
import { DEFAULT_WEIGHTS, type ScoreWeights } from "../app/domain/scoring/weights";
import { COUNTER_COLUMNS, toCounters, type CounterRow } from "../app/data/scores";

const PAGE_SIZE = 500;

/** Recomputes every stored score. Run after any change to ScoreWeights. */
export async function backfillScores(
  supabase: SupabaseClient,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): Promise<number> {
  let updated = 0;
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("spots")
      // Shared with refreshSpotScore. Two copies of this projection is exactly
      // how the batch path and the request path would come to disagree about
      // what a counter means.
      .select(`id, ${COUNTER_COLUMNS}`)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    // The shared CounterRow deliberately carries only the counters, since
    // refreshSpotScore already knows which spot it is updating. Paging needs
    // the id as well.
    for (const row of data as (CounterRow & { id: string })[]) {
      const score = computeScore(toCounters(row), weights);
      const { error: updateError } = await supabase
        .from("spots")
        .update({ score })
        .eq("id", row.id);
      if (updateError) throw updateError;
      updated += 1;
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return updated;
}

/** CLI entry point. Requires the service role key: this writes derived columns. */
async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const updated = await backfillScores(supabase);
  console.log(`Recomputed ${updated} spot scores.`);
}

if (process.argv[1]?.endsWith("backfill-scores.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
