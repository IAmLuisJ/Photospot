import type { ReactNode } from "react";
import type { ExploreView } from "~/domain/filters/explore-filters";
import { Icon } from "~/components/Icon";

export function layoutClass(view: ExploreView): string {
  return `explore explore--${view}`;
}
export function photoDepthFor(view: ExploreView): number {
  return view === "map" ? 300 : view === "gallery" ? 120 : 60;
}

export function ExploreLayout({
  view,
  map,
  results,
  controls,
  adding = false,
  loading = false,
  resultCount = 0,
  mobileView,
  onMobileViewChange,
}: {
  view: ExploreView;
  map: ReactNode;
  results: ReactNode;
  controls: ReactNode;
  adding?: boolean;
  loading?: boolean;
  resultCount?: number;
  mobileView: "photos" | "map";
  onMobileViewChange: (view: "photos" | "map") => void;
}) {
  return (
    <main
      id="main-content"
      className={layoutClass(view)}
      data-mobile-view={adding ? "map" : mobileView}
      data-adding={adding || undefined}
    >
      <section className="explore__browse" aria-label="Find locations">
        <div className="explore__controls">{controls}</div>
        <div className="explore__results" aria-busy={loading}>
          {results}
        </div>
      </section>
      <section className="explore__map" aria-label="Location map">
        {map}
      </section>
      {!adding && (
        <div
          className="mobile-view-switch"
          role="group"
          aria-label="Browse view"
        >
          <button
            type="button"
            aria-pressed={mobileView === "photos"}
            onClick={() => onMobileViewChange("photos")}
          >
            <Icon name="photos" />
            {resultCount} {resultCount === 1 ? "location" : "locations"}
          </button>
          <button
            type="button"
            aria-pressed={mobileView === "map"}
            onClick={() => onMobileViewChange("map")}
          >
            <Icon name="map" />
            Map
          </button>
        </div>
      )}
      <span className="sr-only" role="status">
        {loading
          ? "Updating locations…"
          : `${resultCount} {resultCount === 1 ? "location" : "locations"} in this map area`}
      </span>
    </main>
  );
}
