import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { ShootTypeVoteState } from "../domain/signals/vote-state";

export type SignalKind = "shoot_type_upvote" | "shoot_again";

/** Identifies one ballot: a spot, a kind, and — for upvotes — a shoot type. */
export interface SignalRef {
  spotId: string;
  kind: SignalKind;
  /** Null for `shoot_again`, which the `signals_shape` check requires. */
  shootTypeId: number | null;
}

export interface ShootTypeVotes extends ShootTypeVoteState {
  slug: string;
}

interface SummaryRow {
  shoot_type_id: number;
  slug: string;
  label: string;
  sort_order: number;
  upvote_count: number;
  viewer_upvoted: boolean;
}

/**
 * The rows come back already ordered by `sort_order`, so `sort_order` itself is
 * dropped here rather than carried into the UI as a field nothing reads.
 */
export async function getShootTypeVotes(
  supabase: SupabaseClient,
  spotId: string,
): Promise<ShootTypeVotes[]> {
  const { data, error } = await supabase.rpc("spot_signal_summary", { p_spot_id: spotId });
  if (error) throw error;

  return ((data ?? []) as SummaryRow[]).map((row) => ({
    shootTypeId: row.shoot_type_id,
    slug: row.slug,
    label: row.label,
    upvoteCount: row.upvote_count,
    viewerUpvoted: row.viewer_upvoted,
  }));
}

/**
 * The viewer's own "would you shoot here again?" answer, or null.
 *
 * Takes the profile id rather than calling `auth.getUser()`: the route already
 * has it from `getCurrentProfile`, and a logged-out visitor should cost no
 * round trip at all.
 */
export async function getViewerShootAgain(
  supabase: SupabaseClient,
  spotId: string,
  profileId: string | null,
): Promise<0 | 1 | null> {
  if (!profileId) return null;

  const { data, error } = await supabase
    .from("signals")
    .select("value")
    .eq("spot_id", spotId)
    .eq("profile_id", profileId)
    .eq("kind", "shoot_again")
    .maybeSingle();

  if (error) throw error;
  return data ? ((data.value as 0 | 1) ?? null) : null;
}

const UNIQUE_VIOLATION = "23505";

/**
 * Spec §9.2: a duplicate vote is the state the caller asked for, already
 * present. Surfacing it would turn a double click into an error toast.
 *
 * Checks the SQLSTATE rather than the message, which is localised and free to
 * change. Matching on "already exists" text would also catch a 42501, which is
 * a completely different failure and must not be swallowed.
 */
export const isDuplicateSignal = (error: PostgrestError | null): boolean =>
  error?.code === UNIQUE_VIOLATION;

/**
 * One RPC, one transaction. Changing a vote is a delete plus an insert; done
 * from the client as two round trips, a delete that succeeds followed by an
 * insert that fails silently discards the vote the optimistic UI already drew
 * (spec §9.2).
 */
export async function castSignal(
  supabase: SupabaseClient,
  ref: SignalRef,
  value: 0 | 1 = 1,
): Promise<void> {
  const { error } = await supabase.rpc("cast_signal", {
    p_spot_id: ref.spotId,
    p_kind: ref.kind,
    p_shoot_type_id: ref.shootTypeId,
    p_value: value,
  });

  if (error && !isDuplicateSignal(error)) throw error;
}

/**
 * Taking a vote back. A plain DELETE rather than an RPC: it is a single
 * statement, so it is already atomic, and `signals_delete` limits it to the
 * caller's own rows — the authorization stays in RLS rather than in a filter
 * this function could forget.
 */
export async function retractSignal(
  supabase: SupabaseClient,
  ref: SignalRef,
): Promise<void> {
  // The `kind` filter is currently inert and no test can make it bite: the
  // `signals_shape` check gives shoot_again rows a null shoot_type_id and
  // upvotes a non-null one, so the shoot-type filter below already separates
  // the two kinds. It stays as defence for the day a second kind carries a
  // shoot type, which would make it load-bearing overnight.
  const query = supabase
    .from("signals")
    .delete()
    .eq("spot_id", ref.spotId)
    .eq("kind", ref.kind);

  // `.eq(col, null)` sends `col=eq.null`, which matches nothing. shoot_again
  // rows have a null shoot_type_id, so they need `is`.
  const { error } =
    ref.shootTypeId === null
      ? await query.is("shoot_type_id", null)
      : await query.eq("shoot_type_id", ref.shootTypeId);

  if (error) throw error;
}
