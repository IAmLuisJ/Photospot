// `data()` rather than Response.json: it carries headers AND keeps the loader
// return type inferable, which is what makes `data` available in meta().
import { Link, data as routeData } from "react-router";
import { getRequestContext } from "~/lib/request-context.server";
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
  return [
    {
      title: spot ? `${spot.name} — Photospots` : "Spot not found — Photospots",
    },
  ];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { store, headers, env } = await getRequestContext(request, context);
  const spot = await getSpotBySlug(store, params.slug);

  if (!spot) {
    // 404 rather than an empty page, so an unpublished or renamed spot is not
    // reported to search engines as a valid URL.
    throw new Response("Not found", { status: 404, headers });
  }

  const [media, profile] = await Promise.all([
    getSpotMedia(store, spot.id),
    getCurrentProfile(store),
  ]);

  // Second round: the viewer's own votes need the profile id from the first.
  const [shootTypeVotes, viewerShootAgain, comments] = await Promise.all([
    getShootTypeVotes(store, spot.id),
    getViewerShootAgain(store, spot.id, profile?.id ?? null),
    listComments(store, spot.id),
  ]);

  return routeData(
    {
      spot,
      media,
      profile,
      photoBaseUrl: env.authOrigin,
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

export async function action({ request, params, context }: Route.ActionArgs) {
  const { store, headers, env } = await getRequestContext(request, context);
  const profile = await getCurrentProfile(store);
  // Voting and commenting require an account; browsing never does (spec §4.6).
  if (!profile) {
    return routeData(
      { error: "Sign in to vote or comment." },
      { headers, status: 401 },
    );
  }

  const spot = await getSpotBySlug(store, params.slug);
  if (!spot) throw new Response("Not found", { status: 404, headers });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    switch (intent) {
      case "upvote":
      case "unvote": {
        const shootTypeId = Number(form.get("shootTypeId"));
        if (!Number.isInteger(shootTypeId)) {
          return routeData(
            { error: "Unknown shoot type." },
            { headers, status: 400 },
          );
        }
        const ref = {
          spotId: spot.id,
          kind: "shoot_type_upvote" as const,
          shootTypeId,
        };
        if (intent === "upvote") await castSignal(store, ref, 1);
        else await retractSignal(store, ref);
        break;
      }
      case "shoot-again": {
        const ref = {
          spotId: spot.id,
          kind: "shoot_again" as const,
          shootTypeId: null,
        };
        const answer = String(form.get("answer") ?? "");
        if (answer === "retract") await retractSignal(store, ref);
        else if (answer === "yes") await castSignal(store, ref, 1);
        else if (answer === "no") await castSignal(store, ref, 0);
        else
          return routeData(
            { error: "Unknown answer." },
            { headers, status: 400 },
          );
        break;
      }
      case "comment": {
        const body = String(form.get("body") ?? "");
        const { errors } = validateComment(body);
        if (errors.length > 0) {
          return routeData(
            { error: errors[0].message },
            { headers, status: 400 },
          );
        }
        await addComment(store, spot.id, body, profile.id);
        break;
      }
      case "report": {
        const report = reportIntentFrom(form);
        if (!report) {
          return routeData(
            { error: "That report was not understood." },
            { headers, status: 400 },
          );
        }
        await fileReport(store, { ...report, profileId: profile.id });
        // Returned early: a report changes no counter, so there is no derived
        // score to refresh below.
        return routeData({ ok: true, reported: true }, { headers });
      }
      default:
        return routeData(
          { error: "Unknown action." },
          { headers, status: 400 },
        );
    }
  } catch (err) {
    return routeData(
      { error: err instanceof Error ? err.message : "Something went wrong." },
      { headers, status: 500 },
    );
  }

  // The contribution has committed. Refresh derived ranking separately so a
  // refresh failure does not report a failed vote. Hourly maintenance repairs it.
  try {
    await refreshSpotScore(store.db, spot.id);
  } catch (err) {
    console.error(
      `Score refresh failed for spot ${spot.id}; the vote or comment was saved. ` +
        "Scheduled maintenance will retry. Cause:",
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
  const {
    spot,
    media,
    profile,
    photoBaseUrl,
    shootTypeVotes,
    shootAgain,
    comments,
  } = loaderData;
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
      {spot.description && (
        <p className="spot-detail__description">{spot.description}</p>
      )}

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
          value={
            spot.dogFriendly === null ? null : spot.dogFriendly ? "Yes" : "No"
          }
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
                  src={photoUrl(photoBaseUrl, p.storagePath) ?? ""}
                  alt={p.caption ?? ""}
                  loading="lazy"
                />
                <p>
                  {p.kind === "session" ? "Session" : "Scouting"}
                  {p.creditName && <> · {p.creditName}</>}
                </p>
                {/* Spec §4.3: session photos show real families, so the
                    takedown path has to reach individual photos. */}
                <ReportButton
                  targetType="photo"
                  targetId={p.id}
                  signedIn={profile !== null}
                />
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
          <Link to={`/studios/${spot.slug}`}>
            Rate, booking and ownership →
          </Link>
        </p>
      )}

      {canEdit && (
        <p>
          <Link to={`/spots/${spot.slug}/edit`}>Edit this spot</Link>
        </p>
      )}

      <ReportButton
        targetType="spot"
        targetId={spot.id}
        signedIn={profile !== null}
      />

      <VotePanel
        rows={shootTypeVotes}
        shootAgain={shootAgain}
        signedIn={profile !== null}
      />

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
