export const SPOT_PHOTO_BUCKET = "spot-photos";

/**
 * Public URL for a stored photo.
 *
 * Built by hand rather than via `supabase.storage.getPublicUrl` so it can run
 * in a component with no Supabase client — the loader passes the base URL down
 * and the browser never needs one.
 */
export function photoUrl(supabaseUrl: string, storagePath: string | null): string | null {
  if (!storagePath) return null;
  const base = supabaseUrl.replace(/\/+$/, "");
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${SPOT_PHOTO_BUCKET}/${encoded}`;
}
