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
import { snapBoundsToGrid } from "~/domain/geo/bounds";
import { SpotMap } from "~/components/map/SpotMap";
import { SpotCard } from "~/components/explore/SpotCard";
import { ExploreLayout, photoDepthFor } from "~/components/explore/ExploreLayout";
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
  const filters = parseExploreFilters(url.searchParams);

  // Snap before querying so small pans produce the identical bounding box and
  // the previous result can be reused (spec §10).
  const snapped = { ...filters, viewport: snapBoundsToGrid(filters.viewport, filters.zoom) };

  const [profile, spots, shootTypes] = await Promise.all([
    getCurrentProfile(supabase),
    listSpotsInViewport(supabase, snapped, photoDepthFor(filters.view)),
    supabase.from("shoot_types").select("id, slug, label").order("sort_order"),
  ]);

  return routeData(
    {
      profile,
      spots,
      shootTypes: shootTypes.data ?? [],
      filters,
      supabaseUrl: env.supabaseUrl,
      mapStyleUrl: env.mapStyleUrl,
    },
    { headers },
  );
}

export default function Explore({ loaderData }: Route.ComponentProps) {
  const { profile, spots, shootTypes, filters, supabaseUrl, mapStyleUrl } = loaderData;
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

  return <ExploreLayout view={filters.view} map={map} results={results} controls={controls} />;
}
