import { useCallback, useState } from "react";
import { Link, redirect, useFetcher, data as routeData } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { readEnv } from "~/lib/env.server";
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
import { createClient } from "@supabase/supabase-js";
import type { Route } from "./+types/submit";

export function meta() {
  return [{ title: "Add a spot — Photospots" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const env = readEnv();
  const profile = await getCurrentProfile(supabase);

  // Submitting requires an account (spec §4.6). Browsing does not, so this is
  // the only place in the app that redirects to sign-in.
  if (!profile) throw redirect("/auth/login", { headers });

  const { data: shootTypes } = await supabase
    .from("shoot_types")
    .select("id, slug, label")
    .order("sort_order");

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const kind = url.searchParams.get("kind") === "studio" ? "studio" : "outdoor";

  const hasPin = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
  const nearby: NearbySpot[] = hasPin
    ? await findNearbyDuplicates(supabase, { lat, lng }, kind)
    : [];

  return routeData(
    {
      profile,
      shootTypes: shootTypes ?? [],
      position: hasPin ? { lat, lng } : null,
      kind,
      nearby,
      supabaseUrl: env.supabaseUrl,
      supabaseAnonKey: env.supabaseAnonKey,
    },
    { headers },
  );
}

export async function action({ request }: Route.ActionArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const profile = await getCurrentProfile(supabase);
  if (!profile) return routeData({ errors: [{ field: "auth", message: "Sign in first." }] }, { headers });

  const form = await request.formData();
  const photos = JSON.parse(String(form.get("photos") ?? "[]")) as PhotoInput[];
  const input: SubmissionInput = {
    name: String(form.get("name") ?? ""),
    kind: form.get("kind") === "studio" ? "studio" : "outdoor",
    position: { lat: Number(form.get("lat")), lng: Number(form.get("lng")) },
    description: String(form.get("description") ?? "") || null,
    locality: String(form.get("locality") ?? "") || null,
    region: String(form.get("region") ?? "") || null,
    shootTypeIds: form.getAll("shootTypeIds").map(Number).filter(Number.isFinite),
    photos,
  };

  const { errors } = validateSubmission(input);
  if (errors.length > 0) return routeData({ errors }, { headers });

  const slug = await resolveSlug(supabase, input.name, input.locality, input.region);
  try {
    await createSpot(supabase, input, slug);
  } catch (err) {
    return routeData(
      { errors: [{ field: "form", message: err instanceof Error ? err.message : "Could not save." }] },
      { headers },
    );
  }

  return redirect(`/spots/${slug}`, { headers });
}

interface StagedPhoto extends PhotoInput {
  previewName: string;
}

export default function Submit({ loaderData }: Route.ComponentProps) {
  const { profile, shootTypes, position, kind, nearby, supabaseUrl, supabaseAnonKey } = loaderData;
  const fetcher = useFetcher<typeof action>();
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const onFiles = useCallback(
    async (files: FileList | null, photoKind: "scouting" | "session") => {
      if (!files || files.length === 0) return;
      setUploading(true);
      setUploadError(null);
      try {
        // A browser client, because uploads go straight to Storage rather than
        // through the server (spec §9.1).
        const browser = createClient(supabaseUrl, supabaseAnonKey);
        const { data: session } = await browser.auth.getSession();
        if (!session.session) throw new Error("Session expired — sign in again.");

        for (const file of Array.from(files)) {
          const uploaded = await uploadSpotPhoto(browser, profile!.id, file);
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
            },
          ]);
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(false);
      }
    },
    [profile, supabaseUrl, supabaseAnonKey],
  );

  const errors = fetcher.data?.errors ?? [];
  const errorFor = (field: string) => errors.find((e) => e.field === field)?.message;

  if (!position) {
    return (
      <main className="submit">
        <h1>Add a spot</h1>
        <p>
          Open the map, find the place, and use “Add a spot here”. The pin comes first so we can
          check whether it is already on the map.
        </p>
        <p>
          <Link to="/">← Back to the map</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="submit">
      <p>
        <Link to="/">← Back to the map</Link>
      </p>
      <h1>Add a spot</h1>

      {nearby.length > 0 && (
        <section className="submit__duplicates">
          <h2>Is it one of these?</h2>
          <p>There {nearby.length === 1 ? "is" : "are"} already {nearby.length} nearby.</p>
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
        <input type="hidden" name="lat" value={position.lat} />
        <input type="hidden" name="lng" value={position.lng} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="photos" value={JSON.stringify(staged)} />

        <label>
          Name
          <input name="name" required maxLength={120} />
        </label>
        {errorFor("name") && <p role="alert">{errorFor("name")}</p>}

        <fieldset>
          <legend>What is it good for?</legend>
          {shootTypes.map((t) => (
            <label key={t.id}>
              <input type="checkbox" name="shootTypeIds" value={t.id} />
              {t.label}
            </label>
          ))}
        </fieldset>
        {errorFor("shootTypeIds") && <p role="alert">{errorFor("shootTypeIds")}</p>}

        <fieldset>
          <legend>Photos</legend>
          <p>
            Scouting shots show what the place looks like. Session photos are work you shot there —
            up to {MAX_PHOTOS_PER_KIND} of each.
          </p>
          <label>
            Scouting photos
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onFiles(e.currentTarget.files, "scouting")}
            />
          </label>
          <label>
            Session photos
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onFiles(e.currentTarget.files, "session")}
            />
          </label>

          {uploading && <p>Uploading…</p>}
          {uploadError && <p role="alert">{uploadError}</p>}

          <ul className="submit__staged">
            {staged.map((p, i) => (
              <li key={p.storagePath}>
                {p.previewName} — {p.kind}
                {p.kind === "session" && (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={p.rightsAttested}
                        onChange={(e) =>
                          setStaged((prev) =>
                            prev.map((q, j) =>
                              j === i ? { ...q, rightsAttested: e.currentTarget.checked } : q,
                            ),
                          )
                        }
                      />
                      I shot this and have the right to post it
                    </label>
                    <label>
                      Credit
                      <input
                        value={p.creditName ?? ""}
                        onChange={(e) =>
                          setStaged((prev) =>
                            prev.map((q, j) =>
                              j === i ? { ...q, creditName: e.currentTarget.value || null } : q,
                            ),
                          )
                        }
                      />
                    </label>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setStaged((prev) => prev.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
        {errorFor("photos") && <p role="alert">{errorFor("photos")}</p>}

        <details>
          <summary>Add details</summary>
          <label>
            Description
            <textarea name="description" rows={3} />
          </label>
          <label>
            Town or city
            <input name="locality" defaultValue="Grand Rapids" />
          </label>
          <label>
            State
            <input name="region" defaultValue="MI" />
          </label>
        </details>

        {errorFor("form") && <p role="alert">{errorFor("form")}</p>}

        <button type="submit" disabled={uploading || fetcher.state !== "idle"}>
          {fetcher.state === "idle" ? "Add this spot" : "Saving…"}
        </button>
      </fetcher.Form>
    </main>
  );
}
