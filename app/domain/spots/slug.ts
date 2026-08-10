/**
 * A URL-safe slug.
 *
 * Accents are stripped rather than dropped, so "Café" becomes "cafe" and not
 * "caf" — losing a letter changes how the name reads.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Slugs to try, in order, until one is free.
 *
 * Spec §9.1: slugs are globally unique because `/spots/:slug` is a flat URL
 * space, and "Millennium Park" genuinely recurs across cities — so collision is
 * the normal path. The last candidate always carries a random discriminator, so
 * the list can never be exhausted.
 */
export function slugCandidates(
  name: string,
  locality: string | null,
  region: string | null,
): string[] {
  const base = slugify(name) || "spot";
  const candidates = [base];

  const localityPart = locality ? slugify(locality) : "";
  if (localityPart) {
    candidates.push(`${base}-${localityPart}`);
    const regionPart = region ? slugify(region) : "";
    if (regionPart) candidates.push(`${base}-${localityPart}-${regionPart}`);
  }

  candidates.push(`${base}-${Math.random().toString(36).slice(2, 8)}`);
  return candidates;
}
