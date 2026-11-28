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
import { directionsUrl, exploreReturnTo } from "~/lib/navigation";
import {
  COST_TYPE_OPTIONS,
  labelForAccessibility,
  labelForTerrain,
} from "~/domain/spots/attributes";
import { Icon } from "~/components/Icon";

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
      returnTo: exploreReturnTo(new URL(request.url).searchParams.get("from")),
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
    returnTo,
  } = loaderData;
  const place = [spot.locality, spot.region].filter(Boolean).join(", ");
  const canEdit =
    profile !== null &&
    (profile.id === spot.createdBy ||
      profile.id === spot.ownerProfileId ||
      profile.role === "admin");
  const cost =
    COST_TYPE_OPTIONS.find((option) => option.value === spot.costType)?.label ??
    spot.costType;
  return (
    <main id="main-content" className="spot-detail">
      <Link className="back-link" to={returnTo}>
        <Icon name="back" />
        Back to locations
      </Link>
      <header className="spot-detail__header">
        <div>
          <p className="eyebrow">
            {spot.kind === "studio" ? "Studio" : "Outdoor location"}
          </p>
          <h1>{spot.name}</h1>
          {place && (
            <p className="spot-detail__place">
              <Icon name="pin" />
              {place}
            </p>
          )}
        </div>
        <a
          className="button"
          href={directionsUrl(spot.position)}
          rel="noreferrer noopener"
          target="_blank"
        >
          Get directions
          <Icon name="arrow" />
        </a>
      </header>
      {media.photos.length > 0 ? (
        <section className="spot-detail__photos" aria-label="Location photos">
          <div className="spot-detail__photo-strip" tabIndex={0}>
            {media.photos.map((photo) => (
              <figure key={photo.id}>
                <img
                  src={photoUrl(photoBaseUrl, photo.storagePath) ?? ""}
                  alt={
                    photo.caption ??
                    `${spot.name} — ${photo.kind === "session" ? "session photo" : "scouting photo"}`
                  }
                  loading={photo === media.photos[0] ? "eager" : "lazy"}
                />
                <figcaption>
                  <span>
                    {photo.kind === "session" ? "Session" : "Scouting"}
                    {photo.creditName && ` · ${photo.creditName}`}
                  </span>
                  <ReportButton
                    targetType="photo"
                    targetId={photo.id}
                    signedIn={profile !== null}
                  />
                </figcaption>
              </figure>
            ))}
          </div>
          {media.photos.length > 1 && (
            <p className="photo-hint">
              {media.photos.length} photos · Scroll to explore
              <Icon name="arrow" />
            </p>
          )}
        </section>
      ) : (
        <div className="spot-detail__no-photo">
          <Icon name="photos" />
          <p>This location is waiting for its first photo.</p>
        </div>
      )}
      <div className="spot-detail__body">
        <div className="spot-detail__overview">
          <p className="eyebrow">The lay of the land</p>
          <h2>A little about this place.</h2>
          <p>
            {spot.description ||
              "The map pin is a starting point. Check access and any local requirements before your visit."}
          </p>
          {shootTypeVotes.length > 0 && (
            <div className="spot-detail__shoot-types" aria-label="Shoot types">
              {shootTypeVotes.map((type) => (
                <span key={type.shootTypeId}>{type.label}</span>
              ))}
            </div>
          )}
          {(spot.shootTypeUpvoteCount > 0 ||
            spot.shootAgainYesCount > 0 ||
            spot.shootAgainNoCount > 0) && (
            <p className="spot-detail__signals">{voteTotalsLine(spot)}</p>
          )}
          {media.galleryLinks.length > 0 && (
            <section className="gallery-links">
              <h3>More from this location</h3>
              {media.galleryLinks.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {link.title}
                  <Icon name="arrow" />
                </a>
              ))}
            </section>
          )}
          {spot.kind === "studio" && (
            <Link
              className="button button--secondary studio-link"
              to={`/studios/${spot.slug}`}
            >
              Studio rates & booking
              <Icon name="arrow" />
            </Link>
          )}
        </div>
        <section className="spot-detail__practical">
          <h2>Before you go</h2>
          <dl className="spot-detail__facts">
            <Detail label="Cost" value={cost ?? "Not shared yet"} />
            <Detail label="Cost notes" value={spot.costNotes} />
            <Detail label="Hours" value={spot.hoursNotes} />
            <Detail
              label="Walk from parking"
              value={
                spot.walkMinutes === null
                  ? "Not shared yet"
                  : `${spot.walkMinutes} min`
              }
            />
            <Detail label="Parking" value={spot.parkingNotes} />
            <Detail
              label="Terrain"
              value={list(spot.terrain?.map(labelForTerrain) ?? null)}
            />
            <Detail
              label="Accessibility"
              value={list(
                spot.accessibility?.map(labelForAccessibility) ?? null,
              )}
            />
            <Detail label="Best light" value={list(spot.bestLight)} />
            <Detail label="Best seasons" value={list(spot.bestSeasons)} />
            <Detail
              label="Group size"
              value={
                spot.maxGroupSize === null ? null : `Up to ${spot.maxGroupSize}`
              }
            />
            <Detail
              label="Dogs welcome"
              value={
                spot.dogFriendly === null
                  ? null
                  : spot.dogFriendly
                    ? "Yes"
                    : "No"
              }
            />
          </dl>
          {spot.permitUrl && (
            <a
              className="text-button"
              href={spot.permitUrl}
              rel="noreferrer noopener"
              target="_blank"
            >
              Check permit information
              <Icon name="arrow" />
            </a>
          )}
        </section>
      </div>
      <details className="community-notes">
        <summary>
          <span>
            <span className="eyebrow">From the community</span>
            <span>Field notes & recommendations</span>
          </span>
          <span className="community-notes__count">
            {comments.length} {comments.length === 1 ? "note" : "notes"}
            <Icon name="plus" />
          </span>
        </summary>
        <VotePanel
          rows={shootTypeVotes}
          shootAgain={shootAgain}
          signedIn={profile !== null}
        />
        <CommentThread comments={comments} signedIn={profile !== null} />
      </details>
      <footer className="spot-detail__footer">
        {canEdit && <Link to={`/spots/${spot.slug}/edit`}>Edit this spot</Link>}
        <ReportButton
          targetType="spot"
          targetId={spot.id}
          signedIn={profile !== null}
        />
        <Link to={returnTo}>
          Keep exploring
          <Icon name="arrow" />
        </Link>
      </footer>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main id="main-content" className="spot-detail">
      <h1>Spot not found</h1>
      <p>It may have been removed, or the link may be wrong.</p>
      <p>
        <Link to="/">← Back to the map</Link>
      </p>
    </main>
  );
}
