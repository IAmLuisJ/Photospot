import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeScore, type SpotCounters } from "../app/domain/scoring/score";
import { DEFAULT_WEIGHTS, type ScoreWeights } from "../app/domain/scoring/weights";

const PAGE_SIZE = 500;

interface CounterRow {
  id: string;
  shoot_type_upvote_count: number;
  shoot_again_yes_count: number;
  shoot_again_no_count: number;
  comment_count: number;
  scouting_photo_count: number;
  session_photo_count: number;
}

const toCounters = (row: CounterRow): SpotCounters => ({
  shootTypeUpvoteCount: row.shoot_type_upvote_count,
  shootAgainYesCount: row.shoot_again_yes_count,
  shootAgainNoCount: row.shoot_again_no_count,
  commentCount: row.comment_count,
  scoutingPhotoCount: row.scouting_photo_count,
  sessionPhotoCount: row.session_photo_count,
});

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
      .select(
        "id, shoot_type_upvote_count, shoot_again_yes_count, shoot_again_no_count, comment_count, scouting_photo_count, session_photo_count",
      )
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data as CounterRow[]) {
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
