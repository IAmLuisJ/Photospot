import type { SupabaseClient } from "@supabase/supabase-js";

export interface StudioDetails {
  spotId: string;
  hourlyRateCents: number | null;
  bookingUrl: string | null;
  contactEmail: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
}

interface StudioRow {
  spot_id: string;
  hourly_rate_cents: number | null;
  booking_url: string | null;
  contact_email: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
}

/**
 * Null for an outdoor spot, which has no `studio_details` row at all —
 * `maybeSingle()` rather than `single()`, which would call that a PGRST116
 * error rather than an answer.
 */
export async function getStudioDetails(
  supabase: SupabaseClient,
  spotId: string,
): Promise<StudioDetails | null> {
  const { data, error } = await supabase
    .from("studio_details")
    .select("spot_id, hourly_rate_cents, booking_url, contact_email, claimed_by, claimed_at")
    .eq("spot_id", spotId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as StudioRow;
  return {
    spotId: row.spot_id,
    hourlyRateCents: row.hourly_rate_cents,
    bookingUrl: row.booking_url,
    contactEmail: row.contact_email,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
  };
}

/**
 * Spec §9.3: claiming is a command, not a row write. `claimed_by` is absent
 * from the column grants, so only `claim_studio()` sets it, after confirming
 * the caller's own verified email matches the listing contact. Allowing the
 * column to be written directly would let any signed-in user claim any
 * unclaimed studio — first come, first served, across every listing at once.
 */
export async function claimStudio(supabase: SupabaseClient, spotId: string): Promise<void> {
  const { error } = await supabase.rpc("claim_studio", { p_spot_id: spotId });
  if (error) throw error;
}

/** Renders "$120/hour" from cents, or null when no rate is recorded. */
export function hourlyRateLabel(cents: number | null): string | null {
  if (cents === null) return null;
  const dollars = cents / 100;
  // No decimals on a whole number of dollars: "$120/hour", not "$120.00/hour".
  const amount = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${amount}/hour`;
}
