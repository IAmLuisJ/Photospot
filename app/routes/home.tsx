import { useCallback, useMemo, useState } from "react";
import { Form, Link, useSearchParams, data as routeData } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { readEnv } from "~/lib/env.server";
import { getCurrentProfile } from "~/data/profiles";
import { listSpotsInViewport, type SpotSummary } from "~/data/spots";
import {
  parseExploreFilters,
  filtersToSearchParams,
  type ExploreFilters,
} from "~/domain/filters/explore-filters";
import {
  hasAnyAttributeFilter,
  NO_ATTRIBUTE_FILTERS,
  type AttributeFilters,
} from "~/domain/filters/attribute-filters";
import { snapBoundsToGrid } from "~/domain/geo/bounds";
import { resolveView, viewPreferenceCookie } from "~/lib/view-preference.server";
import { SpotMap } from "~/components/map/SpotMap";
import { SpotCard } from "~/components/explore/SpotCard";
import { ExploreLayout, photoDepthFor } from "~/components/explore/ExploreLayout";
import { FilterBar, hiddenByFiltersMessage } from "~/components/explore/FilterBar";
import type { Route } from "./+types/home";
import "maplibre-gl/dist/maplibre-gl.css";

export function meta() {
  return [
    { title: "Photospots — photography locations, mapped" },
    {
      name: "description",
      content: "A map of photography locations, cultivated by local photographers.",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { supabase, headers } = createSupabaseServerClient(request);
  const env = readEnv();
  const url = new URL(request.url);

  // Read the raw parameter before parseExploreFilters normalises it: it turns
  // an absent view into "split", which is indistinguishable from an explicit
  // one and would override the remembered choice on every visit.
  const rawView = url.searchParams.get("view");
  const remembered = await viewPreferenceCookie.parse(request.headers.get("Cookie"));
  const view = resolveView(rawView, typeof remembered === "string" ? remembered : null);
  const filters = { ...parseExploreFilters(url.searchParams), view };

  // Written whenever the URL carried a view — which includes following someone
  // else's shared link, so that does update your remembered choice. Verified,
  // not assumed: choosing gallery then opening a shared `?view=split` link
  // leaves the cookie on split.
  //
  // Distinguishing "I clicked a view" from "I followed a link" is not possible
  // here, because the view buttons set the same search parameter a shared link
  // carries. Doing it properly would mean posting to an action on click. Left
  // as is: the view you last looked at is a reasonable thing to remember, and
  // the alternative costs a round trip on every view switch.
  //
  // Appended to the headers createSupabaseServerClient returned rather than a
  // fresh object: that one carries refreshed Supabase session cookies, and
  // replacing it signs the user out on their next request.
  if (rawView !== null && rawView === view) {
    headers.append("Set-Cookie", await viewPreferenceCookie.serialize(view));
  }

  // Snap before querying so small pans produce the identical bounding box and
  // the previous result can be reused (spec §10).
  const snapped = { ...filters, viewport: snapBoundsToGrid(filters.viewport, filters.zoom) };

  const [profile, spots, shootTypes] = await Promise.all([
    getCurrentProfile(supabase),
    listSpotsInViewport(supabase, snapped, photoDepthFor(filters.view)),
    supabase.from("shoot_types").select("id, slug, label").order("sort_order"),
  ]);

  // How many spots in view the attribute filters removed. Only worth a second
  // query when something is actually filtered.
  //
  // Both counts are capped by the RPC at 500, so on a busy viewport this
  // undercounts — it is a hint about missing data, not a figure to quote, and
  // the wording keeps it that way.
  const unfilteredCount = hasAnyAttributeFilter(filters.attributes)
    ? (
        await listSpotsInViewport(
          supabase,
          { ...snapped, attributes: NO_ATTRIBUTE_FILTERS },
          photoDepthFor(filters.view),
        )
      ).length
    : spots.length;

  return routeData(
    {
      profile,
      spots,
      shootTypes: shootTypes.data ?? [],
      filters,
      hiddenByFilters: unfilteredCount - spots.length,
      supabaseUrl: env.supabaseUrl,
      mapStyleUrl: env.mapStyleUrl,
    },
    { headers },
  );
}

export default function Explore({ loaderData }: Route.ComponentProps) {
  const { profile, spots, shootTypes, filters, hiddenByFilters, supabaseUrl, mapStyleUrl } =
    loaderData;
  const [, setSearchParams] = useSearchParams();
  const [hovered, setHovered] = useState<string | null>(null);

  const update = useCallback(
    (next: Partial<ExploreFilters>) => {
      // replace: true so panning the map does not fill the back button with
      // every intermediate viewport.
      setSearchParams(filtersToSearchParams({ ...filters, ...next }), { replace: true });
    },
    [filters, setSearchParams],
  );

  const onViewportChange = useCallback(
    (next: { viewport: ExploreFilters["viewport"]; zoom: number }) => update(next),
    [update],
  );

  const onSelect = useCallback((slug: string) => setHovered(slug), []);

  const onAttributesChange = useCallback(
    (attributes: AttributeFilters) => update({ attributes }),
    [update],
  );

  const hiddenMessage = hiddenByFiltersMessage(hiddenByFilters);

  const map = useMemo(
    () => (
      <SpotMap
        spots={spots}
        viewport={filters.viewport}
        zoom={filters.zoom}
        styleUrl={mapStyleUrl}
        selectedSlug={hovered ?? undefined}
        onViewportChange={onViewportChange}
        onSelect={onSelect}
      />
    ),
    [spots, filters.viewport, filters.zoom, mapStyleUrl, hovered, onViewportChange, onSelect],
  );

  const results =
    spots.length === 0 ? (
      <p className="explore__empty">
        No spots in view yet. Try zooming out, or clearing the filter.
        {hiddenMessage && <> {hiddenMessage}</>}
      </p>
    ) : (
      <ul className="explore__list">
        {spots.map((spot) => (
          <li key={spot.id}>
            <SpotCard
              spot={spot}
              supabaseUrl={supabaseUrl}
              selected={hovered === spot.slug}
              variant={filters.view === "gallery" ? "tile" : "row"}
              onHover={setHovered}
            />
          </li>
        ))}
      </ul>
    );

  const controls = (
    <>
      <div className="explore__filters" role="group" aria-label="Shoot type">
        <button
          type="button"
          aria-pressed={filters.shootTypeId === null}
          onClick={() => update({ shootTypeId: null })}
        >
          All
        </button>
        {shootTypes.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={filters.shootTypeId === t.id}
            onClick={() => update({ shootTypeId: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <FilterBar filters={filters.attributes} onChange={onAttributesChange} />

      <div className="explore__views" role="group" aria-label="View">
        {(["split", "map", "gallery"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={filters.view === v}
            onClick={() => update({ view: v })}
          >
            {v}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={filters.sort === "hot"}
          onClick={() => update({ sort: filters.sort === "hot" ? "score" : "hot" })}
        >
          {filters.sort === "hot" ? "Hot" : "Best"}
        </button>
      </div>

      <Link
        className="explore__add"
        to={`/submit?lat=${((filters.viewport.north + filters.viewport.south) / 2).toFixed(6)}&lng=${((filters.viewport.east + filters.viewport.west) / 2).toFixed(6)}`}
      >
        Add a spot here
      </Link>

      <div className="explore__account">
        {profile ? (
          <Form method="post" action="/auth/logout">
            <span>{profile.displayName}</span> <button type="submit">Sign out</button>
          </Form>
        ) : (
          <Link to="/auth/login">Sign in</Link>
        )}
      </div>
    </>
  );

  const resultsWithNotice = (
    <>
      {hiddenMessage && spots.length > 0 && <p className="explore__hidden">{hiddenMessage}</p>}
      {results}
    </>
  );

  return (
    <ExploreLayout view={filters.view} map={map} results={resultsWithNotice} controls={controls} />
  );
}
