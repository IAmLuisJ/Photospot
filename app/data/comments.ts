import type { SupabaseClient } from "@supabase/supabase-js";

export interface SpotComment {
  id: string;
  body: string;
  createdAt: string;
  /** Null once the author deletes their account (spec §4.6a). */
  authorId: string | null;
  authorName: string | null;
}

interface CommentRow {
  id: string;
  body: string;
  created_at: string;
  profile_id: string | null;
  /**
   * PostgREST returns a to-one embed as an object, not a single-element array —
   * verified against the running database, since supabase-js has typed it both
   * ways across versions. It is null when the author's account is gone.
   */
  profiles: { display_name: string } | null;
}

/**
 * `status = 'published'` is written explicitly even though `comments_read`
 * enforces it. The RLS predicate is a disjunction, so it can never match a
 * partial index's predicate and the filter has to be in the query to be usable.
 *
 * Oldest first: the thread is flat (spec §6), and a conversation about a
 * location reads in the order it happened.
 */
export async function listComments(
  supabase: SupabaseClient,
  spotId: string,
  limit = 200,
): Promise<SpotComment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("id, body, created_at, profile_id, profiles(display_name)")
    .eq("spot_id", spotId)
    .eq("status", "published")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as unknown as CommentRow[]).map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    authorId: row.profile_id,
    authorName: row.profiles?.display_name ?? null,
  }));
}

/**
 * `profile_id` is supplied by the caller and checked by RLS
 * (`comments_insert with check (profile_id = auth.uid())`), so passing someone
 * else's id fails at the database rather than being trusted here.
 *
 * The body is trimmed on the way in, so what the `comments_body_not_blank`
 * check sees is exactly what `validateComment` measured.
 */
export async function addComment(
  supabase: SupabaseClient,
  spotId: string,
  body: string,
  profileId: string,
): Promise<void> {
  const { error } = await supabase.from("comments").insert({
    spot_id: spotId,
    profile_id: profileId,
    body: body.trim(),
  });

  if (error) throw error;
}
