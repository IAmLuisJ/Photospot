import {
  requirePublishedSpot,
  requireViewer,
  type DataContext,
} from "./context";
export interface StudioDetails {
  spotId: string;
  hourlyRateCents: number | null;
  bookingUrl: string | null;
  contactEmail: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
}
export async function getStudioDetails(
  context: DataContext,
  spotId: string,
): Promise<StudioDetails | null> {
  return context.db
    .prepare(
      `SELECT d.spot_id AS spotId,d.hourly_rate_cents AS hourlyRateCents,d.booking_url AS bookingUrl,
    d.contact_email AS contactEmail,d.claimed_by AS claimedBy,d.claimed_at AS claimedAt FROM studio_details d
    JOIN spots s ON s.id=d.spot_id WHERE d.spot_id=? AND s.status='published'`,
    )
    .bind(spotId)
    .first<StudioDetails>();
}
export async function claimStudio(
  context: DataContext,
  spotId: string,
): Promise<void> {
  const viewer = requireViewer(context);
  await requirePublishedSpot(context, spotId);
  const listing = await getStudioDetails(context, spotId);
  if (!listing || listing.claimedBy || !listing.contactEmail)
    throw new Error("listing is not claimable");
  if (
    !viewer.emailVerified ||
    viewer.email.toLowerCase() !== listing.contactEmail.toLowerCase()
  )
    throw new Error(
      "claim requires a confirmed email matching the listing contact",
    );
  const now = new Date().toISOString();
  const [claimed] = await context.db.batch([
    context.db
      .prepare(
        `UPDATE studio_details SET claimed_by=?,claimed_at=?,updated_at=? WHERE spot_id=? AND claimed_by IS NULL
      AND EXISTS(SELECT 1 FROM "user" u WHERE u.id=? AND u.emailVerified=1 AND lower(u.email)=lower(studio_details.contact_email))
      AND EXISTS(SELECT 1 FROM spots WHERE id=? AND kind='studio' AND status='published')`,
      )
      .bind(viewer.id, now, now, spotId, viewer.id, spotId),
    context.db
      .prepare(
        `UPDATE spots SET owner_profile_id=? WHERE id=? AND EXISTS(SELECT 1 FROM studio_details
      WHERE spot_id=? AND claimed_by=? AND claimed_at=?)`,
      )
      .bind(viewer.id, spotId, spotId, viewer.id, now),
  ]);
  if (!claimed.meta.changes) throw new Error("listing is not claimable");
}
export function hourlyRateLabel(cents: number | null): string | null {
  if (cents === null) return null;
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2)}/hour`;
}
