import { Form, Link, redirect, data as routeData } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { getCurrentProfile } from "~/data/profiles";
import { getSpotBySlug } from "~/data/spots";
import { updateSpot, addGalleryLink } from "~/data/spot-writes";
import type { Route } from "./+types/spots.$slug.edit";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `Edit ${loaderData.spot.name} — Photospots` : "Edit — Photospots" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const profile = await getCurrentProfile(supabase);
  if (!profile) throw redirect("/auth/login", { headers });

  const spot = await getSpotBySlug(supabase, params.slug);
  if (!spot) throw new Response("Not found", { status: 404, headers });

  return routeData({ spot }, { headers });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const spot = await getSpotBySlug(supabase, params.slug);
  if (!spot) throw new Response("Not found", { status: 404, headers });

  const form = await request.formData();

  if (form.get("intent") === "add-link") {
    const url = String(form.get("url") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    if (!url || !title) {
      return routeData({ error: "A gallery link needs both a URL and a title." }, { headers });
    }
    try {
      await addGalleryLink(supabase, spot.id, url, title);
    } catch {
      return routeData({ error: "Could not add that link." }, { headers });
    }
    return redirect(`/spots/${params.slug}/edit`, { headers });
  }

  try {
    // RLS decides whether this user may edit; a stranger's update matches no
    // rows rather than erroring, so success here does not prove a change.
    await updateSpot(supabase, spot.id, {
      name: String(form.get("name") ?? spot.name),
      description: String(form.get("description") ?? "") || null,
      locality: String(form.get("locality") ?? "") || null,
      region: String(form.get("region") ?? "") || null,
      walkMinutes: form.get("walkMinutes") ? Number(form.get("walkMinutes")) : null,
      parkingNotes: String(form.get("parkingNotes") ?? "") || null,
    });
  } catch {
    return routeData({ error: "Could not save those changes." }, { headers });
  }

  return redirect(`/spots/${params.slug}`, { headers });
}

export default function EditSpot({ loaderData, actionData }: Route.ComponentProps) {
  const { spot } = loaderData;

  return (
    <main className="spot-detail">
      <p>
        <Link to={`/spots/${spot.slug}`}>← Back to {spot.name}</Link>
      </p>
      <h1>Edit {spot.name}</h1>

      {actionData?.error && <p role="alert">{actionData.error}</p>}

      <Form method="post" className="submit__form">
        <label>
          Name
          <input name="name" defaultValue={spot.name} required maxLength={120} />
        </label>
        <label>
          Description
          <textarea name="description" rows={3} defaultValue={spot.description ?? ""} />
        </label>
        <label>
          Town or city
          <input name="locality" defaultValue={spot.locality ?? ""} />
        </label>
        <label>
          State
          <input name="region" defaultValue={spot.region ?? ""} />
        </label>
        <label>
          Walk from parking (minutes)
          <input
            name="walkMinutes"
            type="number"
            min={0}
            defaultValue={spot.walkMinutes ?? ""}
          />
        </label>
        <label>
          Parking notes
          <input name="parkingNotes" defaultValue={spot.parkingNotes ?? ""} />
        </label>
        <button type="submit">Save changes</button>
      </Form>

      <h2>Link a full gallery</h2>
      <p>Hosted photos are capped, so link the full session rather than uploading it.</p>
      <Form method="post" className="submit__form">
        <input type="hidden" name="intent" value="add-link" />
        <label>
          Title
          <input name="title" required />
        </label>
        <label>
          URL
          <input name="url" type="url" required />
        </label>
        <button type="submit">Add link</button>
      </Form>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="spot-detail">
      <h1>Spot not found</h1>
      <p>
        <Link to="/">← Back to the map</Link>
      </p>
    </main>
  );
}
