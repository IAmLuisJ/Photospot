import { useCallback, useMemo, useState } from "react";
import {
  Form,
  Link,
  useNavigation,
  useSearchParams,
  data as routeData,
} from "react-router";
import { getRequestContext } from "~/lib/request-context.server";
import { getCurrentProfile } from "~/data/profiles";
import {
  listSpotsInViewport,
  listShootTypes,
  type SpotSummary,
} from "~/data/spots";
import {
  parseExploreFilters,
  filtersToSearchParams,
  type ExploreFilters,
  DEFAULT_VIEWPORT,
} from "~/domain/filters/explore-filters";
import {
  hasAnyAttributeFilter,
  NO_ATTRIBUTE_FILTERS,
  type AttributeFilters,
} from "~/domain/filters/attribute-filters";
import { snapBoundsToGrid } from "~/domain/geo/bounds";
import {
  resolveView,
  viewPreferenceCookie,
} from "~/lib/view-preference.server";
import { SpotMap } from "~/components/map/SpotMap";
import { SpotCard } from "~/components/explore/SpotCard";
import {
  ExploreLayout,
  photoDepthFor,
} from "~/components/explore/ExploreLayout";
import {
  FilterBar,
  hiddenByFiltersMessage,
  activeFilterCount,
} from "~/components/explore/FilterBar";
import { Icon } from "~/components/Icon";
import type { Route } from "./+types/home";
import "maplibre-gl/dist/maplibre-gl.css";

export function meta() {
  return [
    { title: "Photospots — photography locations, mapped" },
    {
      name: "description",
      content:
        "A map of photography locations, cultivated by local photographers.",
    },
  ];
}

export async function loader({ request, context, url }: Route.LoaderArgs) {
  const { store, headers, env } = await getRequestContext(request, context);

  // Read the raw parameter before parseExploreFilters normalises it: it turns
  // an absent view into "split", which is indistinguishable from an explicit
  // one and would override the remembered choice on every visit.
  const rawView = url.searchParams.get("view");
  const remembered = await viewPreferenceCookie.parse(
    request.headers.get("Cookie"),
  );
  const view = resolveView(
    rawView,
    typeof remembered === "string" ? remembered : null,
  );
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
  // Appended to the headers getRequestContext returned rather than a
  // fresh object: that one carries refreshed Better Auth session cookies, and
  // replacing it signs the user out on their next request.
  if (rawView !== null && rawView === view) {
    headers.append("Set-Cookie", await viewPreferenceCookie.serialize(view));
  }

  // Snap before querying so small pans produce the identical bounding box and
  // the previous result can be reused (spec §10).
  const snapped = {
    ...filters,
    viewport: snapBoundsToGrid(filters.viewport, filters.zoom),
  };

  const [profile, spots, shootTypes] = await Promise.all([
    getCurrentProfile(store),
    listSpotsInViewport(store, snapped, photoDepthFor(filters.view)),
    listShootTypes(store),
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
          store,
          { ...snapped, attributes: NO_ATTRIBUTE_FILTERS },
          photoDepthFor(filters.view),
        )
      ).length
    : spots.length;

  return routeData(
    {
      profile,
      spots,
      shootTypes,
      filters,
      hiddenByFilters: unfilteredCount - spots.length,
      photoBaseUrl: env.authOrigin,
      mapStyleUrl: env.mapStyleUrl,
    },
    { headers },
  );
}

export default function Explore({ loaderData }: Route.ComponentProps) {
  const {
    spots,
    shootTypes,
    filters,
    hiddenByFilters,
    photoBaseUrl,
    mapStyleUrl,
  } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mapCenter, setMapCenter] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const isAdding = searchParams.get("add") === "1";
  const mobileView = searchParams.get("pane") === "map" ? "map" : "photos";
  const count = activeFilterCount(filters.attributes);
  const hasFilters =
    count > 0 || filters.shootTypeId !== null || Boolean(filters.query);
  const browseParams = new URLSearchParams(searchParams);
  browseParams.delete("add");
  const returnTo = browseParams.size ? `/?${browseParams}` : "/";

  const update = useCallback(
    (next: Partial<ExploreFilters>) => {
      const params = filtersToSearchParams({ ...filters, ...next });
      if (isAdding) params.set("add", "1");
      if (mobileView === "map") params.set("pane", "map");
      setSearchParams(params, { replace: true, preventScrollReset: true });
    },
    [filters, isAdding, mobileView, setSearchParams],
  );

  const onViewportChange = useCallback(
    (next: {
      viewport: ExploreFilters["viewport"];
      zoom: number;
      center: { lat: number; lng: number };
    }) => {
      setMapCenter(next.center);
      update({ viewport: next.viewport, zoom: next.zoom });
    },
    [update],
  );
  const onSelect = useCallback((slug: string) => setSelectedSlug(slug), []);
  const onAttributesChange = useCallback(
    (attributes: AttributeFilters) => update({ attributes }),
    [update],
  );
  const selected = spots.find((spot) => spot.slug === selectedSlug);
  const hiddenMessage = hiddenByFiltersMessage(hiddenByFilters);
  const map = useMemo(
    () => (
      <SpotMap
        spots={spots}
        viewport={filters.viewport}
        zoom={filters.zoom}
        styleUrl={mapStyleUrl}
        selectedSlug={hovered ?? selectedSlug ?? undefined}
        onViewportChange={onViewportChange}
        onSelect={onSelect}
      />
    ),
    [
      spots,
      filters.viewport,
      filters.zoom,
      mapStyleUrl,
      hovered,
      selectedSlug,
      onViewportChange,
      onSelect,
    ],
  );
  const center = mapCenter ?? {
    lat: (filters.viewport.north + filters.viewport.south) / 2,
    lng: (filters.viewport.east + filters.viewport.west) / 2,
  };
  const submitPath = `/submit?${new URLSearchParams({ lat: center.lat.toFixed(6), lng: center.lng.toFixed(6), from: returnTo })}`;
  const addParams = new URLSearchParams(searchParams);
  addParams.set("view", "map");
  addParams.set("add", "1");
  const addPath = `/?${addParams}`;

  const controls = (
    <>
      <div className="explore__intro">
        <p className="eyebrow">A photographer’s field guide</p>
        <h1>
          Find your next
          <br />
          <em>shoot location.</em>
        </h1>
        <p>
          Good light. A fresh perspective. A place you’ll want to come back to.
        </p>
      </div>
      <Form
        className="area-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          update({
            query: String(new FormData(event.currentTarget).get("q") ?? "")
              .trim()
              .slice(0, 120),
          });
        }}
      >
        <label className="sr-only" htmlFor="spot-search">
          Search spots in this map area
        </label>
        <Icon name="search" />
        <input
          key={filters.query}
          id="spot-search"
          name="q"
          type="search"
          defaultValue={filters.query}
          placeholder="Search spots in this area"
          maxLength={120}
        />
        <button type="submit" aria-label="Search this area">
          <Icon name="arrow" />
        </button>
      </Form>
      <div className="explore__filter-row">
        <label className="shoot-filter">
          <span className="sr-only">Shoot type</span>
          <select
            value={filters.shootTypeId ?? ""}
            onChange={(event) =>
              update({
                shootTypeId: event.target.value
                  ? Number(event.target.value)
                  : null,
              })
            }
          >
            <option value="">Any shoot type</option>
            {shootTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className={`filter-toggle${count ? " filter-toggle--active" : ""}`}
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="extra-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <Icon name="filter" />
          Filters{count > 0 && <span className="filter-count">{count}</span>}
        </button>
        {hasFilters && (
          <button
            className="text-button"
            type="button"
            onClick={() =>
              update({
                query: "",
                shootTypeId: null,
                attributes: NO_ATTRIBUTE_FILTERS,
              })
            }
          >
            Reset
          </button>
        )}
      </div>
      {filtersOpen && (
        <section
          id="extra-filters"
          className="extra-filters"
          aria-label="More filters"
        >
          <FilterBar
            filters={filters.attributes}
            onChange={onAttributesChange}
          />
          <div className="explore__display">
            <label>
              Display
              <select
                value={filters.view}
                onChange={(event) =>
                  update({ view: event.target.value as ExploreFilters["view"] })
                }
              >
                <option value="split">Photos + map</option>
                <option value="gallery">Photo gallery</option>
                <option value="map">Map + compact list</option>
              </select>
            </label>
            <button
              type="button"
              className="text-button"
              onClick={() => setFiltersOpen(false)}
            >
              Done
            </button>
          </div>
        </section>
      )}
    </>
  );

  const results = (
    <>
      <div className="results-heading">
        <div>
          <h2>
            {spots.length} {spots.length === 1 ? "location" : "locations"}
          </h2>
          <p>In this map area</p>
        </div>
        <label className="sort-control">
          <span className="sr-only">Sort locations</span>
          <select
            value={filters.sort}
            onChange={(event) =>
              update({ sort: event.target.value as ExploreFilters["sort"] })
            }
          >
            <option value="score">Top rated</option>
            <option value="hot">Trending</option>
          </select>
        </label>
      </div>
      {hiddenMessage && spots.length > 0 && (
        <p className="explore__hidden">{hiddenMessage}</p>
      )}
      {spots.length ? (
        <ul className="explore__list">
          {spots.map((spot) => (
            <li key={spot.id}>
              <SpotCard
                spot={spot}
                photoBaseUrl={photoBaseUrl}
                selected={hovered === spot.slug || selectedSlug === spot.slug}
                variant={filters.view === "map" ? "row" : "tile"}
                onHover={setHovered}
                returnTo={returnTo}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="explore__empty">
          <span className="empty-mark">
            <Icon name="compass" />
          </span>
          <h2>
            {hasFilters
              ? "A little room to explore?"
              : "A fresh patch of the map."}
          </h2>
          <p>
            {hasFilters
              ? "No locations match just yet. Try another search or clear your filters."
              : "No locations have been shared here yet. Move or zoom out on the map to keep exploring."}
          </p>
          {hiddenMessage && <p className="explore__hidden">{hiddenMessage}</p>}
          {hasFilters ? (
            <button
              type="button"
              className="button button--secondary"
              onClick={() =>
                update({
                  query: "",
                  shootTypeId: null,
                  attributes: NO_ATTRIBUTE_FILTERS,
                })
              }
            >
              Clear search & filters
            </button>
          ) : (
            <button
              type="button"
              className="button button--secondary"
              onClick={() =>
                update({
                  viewport: {
                    west: Math.max(
                      -180,
                      center.lng -
                        (filters.viewport.east - filters.viewport.west),
                    ),
                    east: Math.min(
                      180,
                      center.lng +
                        (filters.viewport.east - filters.viewport.west),
                    ),
                    south: Math.max(
                      -85,
                      center.lat -
                        (filters.viewport.north - filters.viewport.south),
                    ),
                    north: Math.min(
                      85,
                      center.lat +
                        (filters.viewport.north - filters.viewport.south),
                    ),
                  },
                  zoom: Math.max(0, filters.zoom - 1),
                })
              }
            >
              Explore a wider area
              <Icon name="arrow" />
            </button>
          )}
        </div>
      )}
      <div className="explore__contribute">
        <span>Know a place worth sharing?</span>
        <Link to={addPath}>
          Add it to the map
          <Icon name="plus" />
        </Link>
      </div>
    </>
  );

  return (
    <ExploreLayout
      view={isAdding ? "map" : filters.view}
      controls={controls}
      results={results}
      adding={isAdding}
      loading={navigation.state !== "idle"}
      resultCount={spots.length}
      mobileView={mobileView}
      onMobileViewChange={(view) => {
        const params = new URLSearchParams(searchParams);
        if (view === "map") params.set("pane", "map");
        else params.delete("pane");
        setSearchParams(params, { replace: true, preventScrollReset: true });
      }}
      map={
        <>
          {map}
          {!isAdding && (
            <div className="map-note">
              <span className="map-note__dot" />
              Move the map to explore
            </div>
          )}
          {!isAdding && (
            <button
              type="button"
              className="map-reset"
              onClick={() => update({ viewport: DEFAULT_VIEWPORT, zoom: 12 })}
            >
              <Icon name="pin" />
              Grand Rapids
            </button>
          )}
          {selected && !isAdding && (
            <aside className="map-preview" aria-label="Selected location">
              <SpotCard
                spot={selected}
                photoBaseUrl={photoBaseUrl}
                variant="row"
                returnTo={returnTo}
              />
              <button
                className="map-preview__close"
                type="button"
                onClick={() => setSelectedSlug(null)}
                aria-label="Close location preview"
              >
                <Icon name="close" />
              </button>
            </aside>
          )}
          {isAdding && (
            <>
              <div className="map-crosshair" aria-hidden="true">
                <Icon name="pin" />
              </div>
              <div className="pin-picker">
                <p className="eyebrow">Start with the place</p>
                <h1>Move the map to your spot.</h1>
                <p>The pin marks the location you’ll share.</p>
                <div>
                  <Link className="button" to={submitPath}>
                    Use this location
                    <Icon name="arrow" />
                  </Link>
                  <Link className="text-button" to={returnTo}>
                    Cancel
                  </Link>
                </div>
              </div>
            </>
          )}
        </>
      }
    />
  );
}
