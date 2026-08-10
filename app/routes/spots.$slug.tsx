// `data()` rather than Response.json: it carries headers AND keeps the loader
// return type inferable, which is what makes `data` available in meta().
import { Link, data as routeData } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { readEnv } from "~/lib/env.server";
import { getSpotBySlug, getSpotMedia, type SpotDetail } from "~/data/spots";
import { photoUrl } from "~/lib/photo-url";
import { getCurrentProfile } from "~/data/profiles";
import type { Route } from "./+types/spots.$slug";

// `loaderData`, not `data` — renamed in React Router v8. It is optional here
// because this route has an ErrorBoundary, so meta() also runs for the 404.
export function meta({ loaderData }: Route.MetaArgs) {
  const spot = loaderData?.spot;
  return [{ title: spot ? `${spot.name} — Photospots` : "Spot not found — Photospots" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const env = readEnv();
  const spot = await getSpotBySlug(supabase, params.slug);

  if (!spot) {
    // 404 rather than an empty page, so an unpublished or renamed spot is not
    // reported to search engines as a valid URL.
    throw new Response("Not found", { status: 404, headers });
  }

  const [media, profile] = await Promise.all([
    getSpotMedia(supabase, spot.id),
    getCurrentProfile(supabase),
  ]);

  return routeData({ spot, media, profile, supabaseUrl: env.supabaseUrl }, { headers });
}

/** Renders only the attributes that were filled in — most are nullable by design (spec §4.7). */
function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="spot-detail__fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const list = (values: string[] | null) =>
  values && values.length > 0 ? values.join(", ") : null;

export default function SpotDetailPage({ loaderData }: Route.ComponentProps) {
  const { spot, media, profile, supabaseUrl } = loaderData;
  const place = [spot.locality, spot.region].filter(Boolean).join(", ");

  return (
    <main className="spot-detail">
      <p>
        <Link to="/">← Back to the map</Link>
      </p>

      <h1>{spot.name}</h1>
      {place && <p className="spot-detail__place">{place}</p>}
      {spot.description && <p className="spot-detail__description">{spot.description}</p>}

      <p className="spot-detail__signals">
        {spot.shootTypeUpvoteCount} upvotes · {spot.shootAgainYesCount} would shoot here again
        {spot.shootAgainNoCount > 0 && <> · {spot.shootAgainNoCount} would not</>}
      </p>

      <dl className="spot-detail__facts">
        <Detail label="Cost" value={spot.costType} />
        <Detail label="Cost notes" value={spot.costNotes} />
        <Detail label="Hours" value={spot.hoursNotes} />
        <Detail
          label="Walk from parking"
          value={spot.walkMinutes === null ? null : `${spot.walkMinutes} min`}
        />
        <Detail label="Parking" value={spot.parkingNotes} />
        <Detail label="Terrain" value={list(spot.terrain)} />
        <Detail label="Accessibility" value={list(spot.accessibility)} />
        <Detail label="Best light" value={list(spot.bestLight)} />
        <Detail label="Best seasons" value={list(spot.bestSeasons)} />
        <Detail
          label="Max group"
          value={spot.maxGroupSize === null ? null : String(spot.maxGroupSize)}
        />
        <Detail
          label="Dog friendly"
          value={spot.dogFriendly === null ? null : spot.dogFriendly ? "Yes" : "No"}
        />
      </dl>

      {spot.permitUrl && (
        <p>
          <a href={spot.permitUrl} rel="noreferrer noopener" target="_blank">
            Permit information
          </a>
        </p>
      )}

      {media.photos.length > 0 && (
        <section className="spot-detail__photos">
          <h2>Photos</h2>
          <ul>
            {media.photos.map((p) => (
              <li key={p.id}>
                <img
                  src={photoUrl(supabaseUrl, p.storagePath) ?? ""}
                  alt={p.caption ?? ""}
                  loading="lazy"
                />
                <p>
                  {p.kind === "session" ? "Session" : "Scouting"}
                  {p.creditName && <> · {p.creditName}</>}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {media.galleryLinks.length > 0 && (
        <section>
          <h2>Full galleries</h2>
          <ul>
            {media.galleryLinks.map((l) => (
              <li key={l.id}>
                <a href={l.url} target="_blank" rel="noreferrer noopener">
                  {l.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile && (
        <p>
          <Link to={`/spots/${spot.slug}/edit`}>Edit this spot</Link>
        </p>
      )}

      <p className="spot-detail__pending">Comments and voting arrive in the next milestone.</p>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="spot-detail">
      <h1>Spot not found</h1>
      <p>It may have been removed, or the link may be wrong.</p>
      <p>
        <Link to="/">← Back to the map</Link>
      </p>
    </main>
  );
}
