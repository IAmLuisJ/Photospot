import { Form, Link, redirect, data as routeData } from "react-router";
import { getRequestContext } from "~/lib/request-context.server";
import { getCurrentProfile } from "~/data/profiles";
import { getSpotBySlug } from "~/data/spots";
import { updateSpot, addGalleryLink } from "~/data/spot-writes";
import {
  AttributeFields,
  optionalChoicesFrom,
  parseOptionalInt,
  parseOptionalBool,
} from "~/components/spot/AttributeFields";
import type { Route } from "./+types/spots.$slug.edit";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData
        ? `Edit ${loaderData.spot.name} — Photospots`
        : "Edit — Photospots",
    },
  ];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { store, headers, env } = await getRequestContext(request, context);
  const profile = await getCurrentProfile(store);
  if (!profile) throw redirect("/auth/login", { headers });

  const spot = await getSpotBySlug(store, params.slug);
  if (!spot) throw new Response("Not found", { status: 404, headers });

  return routeData({ spot }, { headers });
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { store, headers, env } = await getRequestContext(request, context);
  if (!store.viewer)
    return routeData({ error: "Sign in first." }, { headers, status: 401 });
  const spot = await getSpotBySlug(store, params.slug);
  if (!spot) throw new Response("Not found", { status: 404, headers });

  const form = await request.formData();

  if (form.get("intent") === "add-link") {
    const url = String(form.get("url") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    if (!url || !title) {
      return routeData(
        { error: "A gallery link needs both a URL and a title." },
        { headers },
      );
    }
    try {
      await addGalleryLink(store, spot.id, url, title);
    } catch {
      return routeData({ error: "Could not add that link." }, { headers });
    }
    return redirect(`/spots/${params.slug}/edit`, { headers });
  }

  let saved: boolean;
  try {
    // The repository's conditional update is the authorization boundary.
    // Zero affected rows means the edit was refused.
    saved = await updateSpot(store, spot.id, {
      name: String(form.get("name") ?? spot.name),
      description: String(form.get("description") ?? "") || null,
      locality: String(form.get("locality") ?? "") || null,
      region: String(form.get("region") ?? "") || null,
      parkingNotes: String(form.get("parkingNotes") ?? "") || null,
      // A known group with no checked options explicitly clears it to []. An
      // unknown group is null; an omitted group preserves the stored answer.
      //
      // parseOptionalInt rather than `form.get(x) ? Number(x) : null`, which
      // read "0" as falsy and stored null — turning "you park at the spot"
      // into "nobody said".
      walkMinutes: parseOptionalInt(form, "walkMinutes"),
      costType: String(form.get("costType") ?? "") || null,
      accessibility: optionalChoicesFrom(
        form,
        "accessibility",
        spot.accessibility,
      ),
      terrain: optionalChoicesFrom(form, "terrain", spot.terrain),
      // Tri-state, not a checkbox: an unchecked box cannot say "I don't
      // know", and would publish "Dog friendly: No" for every contributor who
      // ignored it.
      dogFriendly: parseOptionalBool(form, "dogFriendly"),
    });
  } catch {
    return routeData({ error: "Could not save those changes." }, { headers });
  }

  if (!saved) {
    // Reached by anyone signed in who did not submit this spot: the detail page
    // offers everyone the edit link. Saying so beats redirecting to a page that
    // looks saved and is not.
    return routeData(
      {
        error: "Only the person who added this spot, or an admin, can edit it.",
      },
      { headers, status: 403 },
    );
  }

  return redirect(`/spots/${params.slug}`, { headers });
}

export default function EditSpot({
  loaderData,
  actionData,
}: Route.ComponentProps) {
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
          <input
            name="name"
            defaultValue={spot.name}
            required
            maxLength={120}
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            rows={3}
            defaultValue={spot.description ?? ""}
          />
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
          Parking notes
          <input name="parkingNotes" defaultValue={spot.parkingNotes ?? ""} />
        </label>

        {/* Owns walkMinutes, so there is no second input for it above. */}
        <AttributeFields
          current={{
            costType: spot.costType,
            walkMinutes: spot.walkMinutes,
            accessibility: spot.accessibility,
            terrain: spot.terrain,
            dogFriendly: spot.dogFriendly,
          }}
        />

        <button type="submit">Save changes</button>
      </Form>

      <h2>Link a full gallery</h2>
      <p>
        Hosted photos are capped, so link the full session rather than uploading
        it.
      </p>
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
