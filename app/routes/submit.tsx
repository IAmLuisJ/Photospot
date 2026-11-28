import { useCallback, useEffect, useRef, useState } from "react";
import { Link, redirect, useFetcher, data as routeData } from "react-router";
import { getRequestContext } from "~/lib/request-context.server";
import { getCurrentProfile } from "~/data/profiles";
import {
  findNearbyDuplicates,
  resolveSlug,
  createSpot,
  type NearbySpot,
} from "~/data/spot-writes";
import {
  validateSubmission,
  MAX_PHOTOS_PER_KIND,
  type PhotoInput,
  type SubmissionInput,
} from "~/domain/spots/submission";
import { uploadSpotPhoto } from "~/lib/photo-upload.client";
import { readPhotoInputs } from "~/lib/submission.server";
import {
  AttributeFields,
  optionalChoicesFrom,
  parseOptionalInt,
  parseOptionalBool,
} from "~/components/spot/AttributeFields";
import { listShootTypes } from "~/data/spots";
import type { Route } from "./+types/submit";
import { exploreReturnTo, loginPath } from "~/lib/navigation";
import { Icon } from "~/components/Icon";

export function meta() {
  return [{ title: "Add a spot — Photospots" }];
}

export async function loader({ request, context, url }: Route.LoaderArgs) {
  const { store, headers, env } = await getRequestContext(request, context);
  const profile = await getCurrentProfile(store);

  // Submitting requires an account (spec §4.6). Browsing does not, so this is
  // the only place in the app that redirects to sign-in.
  if (!profile) {
    throw redirect(loginPath(url.pathname + url.search), { headers });
  }

  const shootTypes = await listShootTypes(store);

  const lat = Number(url.searchParams.get("lat")?.trim() || NaN);
  const lng = Number(url.searchParams.get("lng")?.trim() || NaN);
  const kind = url.searchParams.get("kind") === "studio" ? "studio" : "outdoor";

  const hasPin =
    url.searchParams.has("lat") &&
    url.searchParams.has("lng") &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;
  const nearby: NearbySpot[] = hasPin
    ? await findNearbyDuplicates(store, { lat, lng }, kind)
    : [];

  return routeData(
    {
      profile,
      shootTypes: shootTypes ?? [],
      position: hasPin ? { lat, lng } : null,
      kind,
      nearby,
      photoBaseUrl: env.authOrigin,
      returnTo: exploreReturnTo(url.searchParams.get("from")),
    },
    { headers },
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const { store, headers, env } = await getRequestContext(request, context);
  const profile = await getCurrentProfile(store);
  if (!profile)
    return routeData(
      { errors: [{ field: "auth", message: "Sign in first." }] },
      { headers, status: 401 },
    );

  const form = await request.formData();
  let photos: PhotoInput[];
  try {
    photos = readPhotoInputs(form.get("photos"));
  } catch {
    return routeData(
      {
        errors: [
          {
            field: "photos",
            message:
              "Invalid photo details. Upload the photos again and check their credits.",
          },
        ],
      },
      { headers, status: 400 },
    );
  }
  const input: SubmissionInput = {
    name: String(form.get("name") ?? ""),
    kind: form.get("kind") === "studio" ? "studio" : "outdoor",
    position: {
      lat: Number(String(form.get("lat") ?? "").trim() || NaN),
      lng: Number(String(form.get("lng") ?? "").trim() || NaN),
    },
    description: String(form.get("description") ?? "") || null,
    locality: String(form.get("locality") ?? "") || null,
    region: String(form.get("region") ?? "") || null,
    shootTypeIds: form
      .getAll("shootTypeIds")
      .map(Number)
      .filter(Number.isFinite),
    photos,
    // Collected at submission so a spot is findable immediately, rather than
    // only once someone remembers to edit it.
    costType: String(form.get("costType") ?? "") || null,
    walkMinutes: parseOptionalInt(form, "walkMinutes"),
    accessibility: optionalChoicesFrom(form, "accessibility"),
    terrain: optionalChoicesFrom(form, "terrain"),
    dogFriendly: parseOptionalBool(form, "dogFriendly"),
  };

  const { errors } = validateSubmission(input);
  if (errors.length > 0) return routeData({ errors }, { headers, status: 400 });

  const slug = await resolveSlug(
    store,
    input.name,
    input.locality,
    input.region,
  );
  try {
    await createSpot(store, input, slug);
  } catch (err) {
    return routeData(
      {
        errors: [
          {
            field: "form",
            message: err instanceof Error ? err.message : "Could not save.",
          },
        ],
      },
      { headers },
    );
  }

  return redirect(
    `/spots/${slug}?${new URLSearchParams({ from: exploreReturnTo(form.get("from")) })}`,
    { headers },
  );
}

interface StagedPhoto extends PhotoInput {
  previewName: string;
  previewUrl: string;
}

export default function Submit({ loaderData }: Route.ComponentProps) {
  const { profile, shootTypes, position, kind, nearby, returnTo } = loaderData;
  const fetcher = useFetcher<typeof action>();
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const previewUrls = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
    };
  }, []);

  const onFiles = useCallback(
    async (files: FileList | null, photoKind: "scouting" | "session") => {
      if (!files || files.length === 0) return;
      const remaining =
        MAX_PHOTOS_PER_KIND -
        staged.filter((photo) => photo.kind === photoKind).length;
      if (files.length > remaining) {
        setUploadError(
          `Choose up to ${remaining} more ${photoKind} ${remaining === 1 ? "photo" : "photos"}.`,
        );
        return;
      }
      setUploading(true);
      setUploadError(null);
      try {
        for (const file of Array.from(files)) {
          const uploaded = await uploadSpotPhoto(file);
          if (!mounted.current) return;
          const previewUrl = URL.createObjectURL(file);
          previewUrls.current.add(previewUrl);
          setStaged((prev) => [
            ...prev,
            {
              storagePath: uploaded.storagePath,
              kind: photoKind,
              rightsAttested: false,
              creditName: null,
              creditUrl: null,
              caption: null,
              previewName: file.name,
              previewUrl,
            },
          ]);
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(false);
      }
    },
    [staged],
  );

  const errors = fetcher.data?.errors ?? [];
  const errorFor = (field: string) =>
    errors.find((e) => e.field === field)?.message;

  if (!position) {
    return (
      <main id="main-content" className="submit">
        <h1>Add a spot</h1>
        <p>
          Start by placing a pin. Move the map to the location you want to
          share.
        </p>
        <Link className="button" to="/?add=1&view=map">
          Choose a location
          <Icon name="arrow" />
        </Link>
        <p>
          <Link className="back-link" to={returnTo}>
            <Icon name="back" />
            Back to locations
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="submit">
      <p>
        <Link className="back-link" to={returnTo}>
          <Icon name="back" />
          Back to locations
        </Link>
      </p>
      <p className="eyebrow">Pass on a good find</p>
      <h1>Share a spot.</h1>
      <p className="submit__intro">
        A name, a few photos, and your local knowledge.
      </p>
      <p className="submit__pin">
        <Icon name="pin" />
        Location chosen{" "}
        <Link
          to={`/?add=1&view=map&w=${position.lng - 0.005}&e=${position.lng + 0.005}&s=${position.lat - 0.005}&n=${position.lat + 0.005}`}
        >
          Adjust pin
        </Link>
      </p>

      {nearby.length > 0 && (
        <section className="submit__duplicates">
          <h2>Is it one of these?</h2>
          <p>
            There {nearby.length === 1 ? "is" : "are"} already {nearby.length}{" "}
            nearby.
          </p>
          <ul>
            {nearby.map((s) => (
              <li key={s.id}>
                <Link to={`/spots/${s.slug}`}>{s.name}</Link>{" "}
                <span>{Math.round(s.distanceMeters)} m away</span>
              </li>
            ))}
          </ul>
          <p>If none of them is it, carry on below.</p>
        </section>
      )}

      <fetcher.Form method="post" className="submit__form">
        <input type="hidden" name="from" value={returnTo} />
        <input type="hidden" name="lat" value={position.lat} />
        <input type="hidden" name="lng" value={position.lng} />
        <input type="hidden" name="kind" value={kind} />
        <input
          type="hidden"
          name="photos"
          value={JSON.stringify(
            staged.map(({ previewName, previewUrl, ...photo }) => photo),
          )}
        />

        <label>
          Location name
          <input
            name="name"
            required
            maxLength={120}
            placeholder="A name other photographers will recognize"
            aria-describedby={errorFor("name") ? "name-error" : undefined}
          />
        </label>
        {errorFor("name") && (
          <p id="name-error" role="alert">
            {errorFor("name")}
          </p>
        )}

        <fieldset>
          <legend>01 / What would you shoot here?</legend>
          {shootTypes.map((t) => (
            <label key={t.id}>
              <input type="checkbox" name="shootTypeIds" value={t.id} />
              {t.label}
            </label>
          ))}
        </fieldset>
        {errorFor("shootTypeIds") && (
          <p role="alert">{errorFor("shootTypeIds")}</p>
        )}

        <fieldset>
          <legend>02 / Show the place</legend>
          <p>
            Scouting shots show what the place looks like. Session photos are
            work you shot there — up to {MAX_PHOTOS_PER_KIND} of each.
          </p>
          <label>
            Scouting photos
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={
                uploading ||
                staged.filter((photo) => photo.kind === "scouting").length >=
                  MAX_PHOTOS_PER_KIND
              }
              onChange={(e) => onFiles(e.currentTarget.files, "scouting")}
            />
          </label>
          <label>
            Session photos
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={
                uploading ||
                staged.filter((photo) => photo.kind === "session").length >=
                  MAX_PHOTOS_PER_KIND
              }
              onChange={(e) => onFiles(e.currentTarget.files, "session")}
            />
          </label>

          {uploading && <p>Uploading…</p>}
          {uploadError && <p role="alert">{uploadError}</p>}

          <ul className="submit__staged">
            {staged.map((p, i) => (
              <li key={p.storagePath}>
                <img
                  className="submit__preview"
                  src={p.previewUrl}
                  alt={p.previewName}
                />
                {p.previewName} — {p.kind}
                {p.kind === "session" && (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={p.rightsAttested}
                        onChange={(e) => {
                          const rightsAttested = e.currentTarget.checked;
                          setStaged((prev) =>
                            prev.map((q, j) =>
                              j === i
                                ? {
                                    ...q,
                                    rightsAttested,
                                  }
                                : q,
                            ),
                          );
                        }}
                      />
                      I shot this and have the right to post it
                    </label>
                    <label>
                      Credit
                      <input
                        value={p.creditName ?? ""}
                        onChange={(e) => {
                          const creditName = e.currentTarget.value || null;
                          setStaged((prev) =>
                            prev.map((q, j) =>
                              j === i
                                ? {
                                    ...q,
                                    creditName,
                                  }
                                : q,
                            ),
                          );
                        }}
                      />
                    </label>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(p.previewUrl);
                    previewUrls.current.delete(p.previewUrl);
                    setStaged((prev) => prev.filter((_, j) => j !== i));
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
        {errorFor("photos") && <p role="alert">{errorFor("photos")}</p>}

        <details className="submit__optional">
          <summary>
            03 / Add practical details <span>Optional</span>
          </summary>
          <label>
            Description
            <textarea name="description" rows={3} />
          </label>
          <label>
            Town or city
            <input name="locality" />
          </label>
          <label>
            State
            <input name="region" />
          </label>

          <AttributeFields
            current={{
              costType: null,
              walkMinutes: null,
              accessibility: null,
              terrain: null,
              dogFriendly: null,
            }}
          />
        </details>

        {errorFor("form") && <p role="alert">{errorFor("form")}</p>}

        <button
          className="button"
          type="submit"
          disabled={uploading || fetcher.state !== "idle"}
        >
          {fetcher.state === "idle" ? "Share this location" : "Saving…"}
        </button>
      </fetcher.Form>
    </main>
  );
}
