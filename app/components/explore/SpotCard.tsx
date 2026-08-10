import { Link } from "react-router";
import type { SpotSummary } from "~/data/spots";
import { photoUrl } from "~/lib/photo-url";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Everything under the name, assembled so empty fields leave no punctuation behind. */
export function cardSummaryLine(spot: SpotSummary): string {
  const parts: string[] = [];
  if (spot.kind === "studio") parts.push("Studio");

  const place = [spot.locality, spot.region].filter(Boolean).join(", ");
  if (place) parts.push(place);

  if (spot.photoCount > 0) parts.push(plural(spot.photoCount, "photo", "photos"));
  if (spot.commentCount > 0) parts.push(plural(spot.commentCount, "comment", "comments"));

  return parts.join(" · ");
}

export interface SpotCardProps {
  spot: SpotSummary;
  supabaseUrl: string;
  selected?: boolean;
  variant?: "row" | "tile";
  onHover?: (slug: string | null) => void;
}

export function SpotCard({
  spot,
  supabaseUrl,
  selected = false,
  variant = "row",
  onHover,
}: SpotCardProps) {
  const cover = photoUrl(supabaseUrl, spot.coverPhotoPath);

  return (
    <Link
      to={`/spots/${spot.slug}`}
      className={`spot-card spot-card--${variant}${selected ? " spot-card--selected" : ""}`}
      onMouseEnter={() => onHover?.(spot.slug)}
      onMouseLeave={() => onHover?.(null)}
      aria-current={selected ? "true" : undefined}
    >
      {cover ? (
        <img className="spot-card__image" src={cover} alt="" loading="lazy" />
      ) : (
        <div className="spot-card__image spot-card__image--empty" aria-hidden="true" />
      )}
      <div className="spot-card__body">
        <h3 className="spot-card__name">{spot.name}</h3>
        <p className="spot-card__summary">{cardSummaryLine(spot)}</p>
      </div>
    </Link>
  );
}
