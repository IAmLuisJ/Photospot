import { Form, Link, data as routeData } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { getCurrentProfile } from "~/data/profiles";
import { getSpotBySlug } from "~/data/spots";
import { getStudioDetails, claimStudio, hourlyRateLabel } from "~/data/studios";
import type { Route } from "./+types/studios.$slug";

export function meta({ loaderData }: Route.MetaArgs) {
  const spot = loaderData?.spot;
  return [{ title: spot ? `${spot.name} — Photospots` : "Studio not found — Photospots" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const spot = await getSpotBySlug(supabase, params.slug);

  // 404 rather than a redirect for an outdoor spot: /studios/:slug is a
  // different URL space, and quietly serving a park here would make the two
  // interchangeable in links and search results.
  if (!spot || spot.kind !== "studio") {
    throw new Response("Not found", { status: 404, headers });
  }

  const [studio, profile] = await Promise.all([
    getStudioDetails(supabase, spot.id),
    getCurrentProfile(supabase),
  ]);

  return routeData({ spot, studio, profile }, { headers });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const profile = await getCurrentProfile(supabase);
  if (!profile) {
    return routeData({ error: "Sign in to claim a listing." }, { headers, status: 401 });
  }

  const spot = await getSpotBySlug(supabase, params.slug);
  if (!spot) throw new Response("Not found", { status: 404, headers });

  try {
    await claimStudio(supabase, spot.id);
  } catch (err) {
    // claim_studio raises in three distinct cases and its messages are already
    // written for a person; passing them through beats a generic failure that
    // leaves the owner guessing which one they hit.
    //
    // Read `message` off whatever was thrown rather than testing `instanceof
    // Error`: supabase-js rejects with a PostgrestError, which is a plain
    // object. The instanceof check is false for it, so every refusal collapsed
    // into the generic message — which is what driving this by hand showed.
    const message = typeof (err as { message?: unknown })?.message === "string"
      ? (err as { message: string }).message
      : "";
    if (/confirmed email/i.test(message)) {
      return routeData(
        {
          error:
            "Claiming needs a confirmed email matching the address on this listing. " +
            "Sign in with that address, or ask whoever added the listing to correct it.",
        },
        { headers, status: 403 },
      );
    }
    if (/not claimable/i.test(message)) {
      return routeData({ error: "This listing has already been claimed." }, { headers, status: 409 });
    }
    return routeData({ error: "Could not claim this listing." }, { headers, status: 500 });
  }

  return routeData({ ok: true }, { headers });
}

export default function StudioPage({ loaderData, actionData }: Route.ComponentProps) {
  const { spot, studio, profile } = loaderData;
  const place = [spot.locality, spot.region].filter(Boolean).join(", ");
  const rate = hourlyRateLabel(studio?.hourlyRateCents ?? null);
  const claimed = studio?.claimedBy !== null && studio?.claimedBy !== undefined;
  const viewerOwns = profile !== null && studio?.claimedBy === profile.id;

  return (
    <main className="spot-detail">
      <p>
        <Link to={`/spots/${spot.slug}`}>← Photos, votes and comments</Link>
      </p>

      <h1>{spot.name}</h1>
      {place && <p className="spot-detail__place">{place}</p>}
      {spot.description && <p className="spot-detail__description">{spot.description}</p>}

      <dl className="spot-detail__facts">
        {rate && (
          <div className="spot-detail__fact">
            <dt>Rate</dt>
            <dd>{rate}</dd>
          </div>
        )}
        {studio?.bookingUrl && (
          <div className="spot-detail__fact">
            <dt>Booking</dt>
            <dd>
              <a href={studio.bookingUrl} target="_blank" rel="noreferrer noopener">
                Book this studio
              </a>
            </dd>
          </div>
        )}
      </dl>

      <section className="studio-claim">
        <h2>Is this your studio?</h2>

        {viewerOwns ? (
          <p>
            You claimed this listing. <Link to={`/spots/${spot.slug}/edit`}>Edit it</Link>.
          </p>
        ) : claimed ? (
          <p>This listing has been claimed by its owner.</p>
        ) : profile ? (
          <>
            <p>
              Claiming needs a confirmed email matching the address on the listing, so only its
              owner can take it.
            </p>
            {/* The action returns one shape or the other, so each branch is
                narrowed by the `in` check rather than by an optional access. */}
            {actionData && "error" in actionData && (
              <p role="alert">{actionData.error}</p>
            )}
            {actionData && "ok" in actionData && (
              <p className="studio-claim__done">Claimed — this listing is yours to edit now.</p>
            )}
            <Form method="post">
              <button type="submit">Claim this listing</button>
            </Form>
          </>
        ) : (
          <p>
            <Link to="/auth/login">Sign in</Link> with the email on this listing to claim it.
          </p>
        )}
      </section>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="spot-detail">
      <h1>Studio not found</h1>
      <p>It may have been removed, or this may not be a studio listing.</p>
      <p>
        <Link to="/">← Back to the map</Link>
      </p>
    </main>
  );
}
