// `data()` rather than Response.json: it carries headers AND keeps the loader
// return type inferable, which is what makes `data` available in meta().
import { Link, data as routeData } from "react-router";
import { createSupabaseServerClient, createSupabaseAdminClient } from "~/lib/supabase.server";
import { readEnv } from "~/lib/env.server";
import { getSpotBySlug, getSpotMedia, type SpotDetail } from "~/data/spots";
import { photoUrl } from "~/lib/photo-url";
import { getCurrentProfile } from "~/data/profiles";
import {
  getShootTypeVotes,
  getViewerShootAgain,
  castSignal,
  retractSignal,
} from "~/data/signals";
import { listComments, addComment } from "~/data/comments";
import { validateComment } from "~/domain/comments/comment";
import { refreshSpotScore } from "~/data/scores";
import { VotePanel, voteTotalsLine } from "~/components/spot/VotePanel";
import { ReportButton, reportIntentFrom } from "~/components/spot/ReportButton";
import { fileReport } from "~/data/reports";
import { CommentThread } from "~/components/spot/CommentThread";
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

  // Second round: the viewer's own votes need the profile id from the first.
  const [shootTypeVotes, viewerShootAgain, comments] = await Promise.all([
    getShootTypeVotes(supabase, spot.id),
    getViewerShootAgain(supabase, spot.id, profile?.id ?? null),
    listComments(supabase, spot.id),
  ]);

  return routeData(
    {
      spot,
      media,
      profile,
      supabaseUrl: env.supabaseUrl,
      shootTypeVotes,
      shootAgain: {
        yesCount: spot.shootAgainYesCount,
        noCount: spot.shootAgainNoCount,
        viewerAnswer: viewerShootAgain,
      },
      comments,
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const profile = await getCurrentProfile(supabase);
  // Voting and commenting require an account; browsing never does (spec §4.6).
  if (!profile) {
    return routeData({ error: "Sign in to vote or comment." }, { headers, status: 401 });
  }

  const spot = await getSpotBySlug(supabase, params.slug);
  if (!spot) throw new Response("Not found", { status: 404, headers });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    switch (intent) {
      case "upvote":
      case "unvote": {
        const shootTypeId = Number(form.get("shootTypeId"));
        if (!Number.isInteger(shootTypeId)) {
          return routeData({ error: "Unknown shoot type." }, { headers, status: 400 });
        }
        const ref = { spotId: spot.id, kind: "shoot_type_upvote" as const, shootTypeId };
        if (intent === "upvote") await castSignal(supabase, ref, 1);
        else await retractSignal(supabase, ref);
        break;
      }
      case "shoot-again": {
        const ref = { spotId: spot.id, kind: "shoot_again" as const, shootTypeId: null };
        const answer = String(form.get("answer") ?? "");
        if (answer === "retract") await retractSignal(supabase, ref);
        else if (answer === "yes") await castSignal(supabase, ref, 1);
        else if (answer === "no") await castSignal(supabase, ref, 0);
        else return routeData({ error: "Unknown answer." }, { headers, status: 400 });
        break;
      }
      case "comment": {
        const body = String(form.get("body") ?? "");
        const { errors } = validateComment(body);
        if (errors.length > 0) {
          return routeData({ error: errors[0].message }, { headers, status: 400 });
        }
        await addComment(supabase, spot.id, body, profile.id);
        break;
      }
      case "report": {
        const report = reportIntentFrom(form);
        if (!report) {
          return routeData({ error: "That report was not understood." }, { headers, status: 400 });
        }
        await fileReport(supabase, { ...report, profileId: profile.id });
        // Returned early: a report changes no counter, so there is no derived
        // score to refresh below.
        return routeData({ ok: true, reported: true }, { headers });
      }
      default:
        return routeData({ error: "Unknown action." }, { headers, status: 400 });
    }
  } catch (err) {
    return routeData(
      { error: err instanceof Error ? err.message : "Something went wrong." },
      { headers, status: 500 },
    );
  }

  // The write landed; the derived score is what is left. spots.score is not
  // writable by `authenticated` — it is the default sort order — so this needs
  // the service-role client.
  //
  // A failure here must not be reported as a failed vote, because the vote
  // succeeded. It must not be silent either: nothing else in the system would
  // notice a score that had stopped moving.
  try {
    await refreshSpotScore(createSupabaseAdminClient(), spot.id);
  } catch (err) {
    console.error(
      `Score refresh failed for spot ${spot.id}; the vote or comment was saved. ` +
        "Run `npm run backfill:scores` to repair. Cause:",
      err,
    );
  }

  return routeData({ ok: true }, { headers });
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
  const { spot, media, profile, supabaseUrl, shootTypeVotes, shootAgain, comments } = loaderData;
  const place = [spot.locality, spot.region].filter(Boolean).join(", ");

  // Matches spots_update: the submitter, the listing owner, or an admin. The
  // action refuses anyone else politely, but the link should not be there at
  // all — plan 5 found it offered to every signed-in user on every spot.
  const canEdit =
    profile !== null &&
    (profile.id === spot.createdBy ||
      profile.id === spot.ownerProfileId ||
      profile.role === "admin");

  return (
    <main className="spot-detail">
      <p>
        <Link to="/">← Back to the map</Link>
      </p>

      <h1>{spot.name}</h1>
      {place && <p className="spot-detail__place">{place}</p>}
      {spot.description && <p className="spot-detail__description">{spot.description}</p>}

      <p className="spot-detail__signals">{voteTotalsLine(spot)}</p>

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
                {/* Spec §4.3: session photos show real families, so the
                    takedown path has to reach individual photos. */}
                <ReportButton targetType="photo" targetId={p.id} signedIn={profile !== null} />
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

      {spot.kind === "studio" && (
        <p>
          <Link to={`/studios/${spot.slug}`}>Rate, booking and ownership →</Link>
        </p>
      )}

      {canEdit && (
        <p>
          <Link to={`/spots/${spot.slug}/edit`}>Edit this spot</Link>
        </p>
      )}

      <ReportButton targetType="spot" targetId={spot.id} signedIn={profile !== null} />

      <VotePanel rows={shootTypeVotes} shootAgain={shootAgain} signedIn={profile !== null} />

      <CommentThread comments={comments} signedIn={profile !== null} />
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
