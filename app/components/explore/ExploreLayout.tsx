import type { ReactNode } from "react";
import type { ExploreView } from "~/domain/filters/explore-filters";

export function layoutClass(view: ExploreView): string {
  return `explore explore--${view}`;
}

/**
 * How many spots to request for a view.
 *
 * Map view is pins only, so it can afford the most. Gallery renders large
 * images and scrolls, so it wants a healthy page. Split shows a narrow list
 * beside the map and needs the fewest. Capped by the RPC at 500.
 */
export function photoDepthFor(view: ExploreView): number {
  switch (view) {
    case "map":
      return 300;
    case "gallery":
      return 120;
    case "split":
      return 60;
  }
}

export interface ExploreLayoutProps {
  view: ExploreView;
  map: ReactNode;
  results: ReactNode;
  controls: ReactNode;
}

export function ExploreLayout({ view, map, results, controls }: ExploreLayoutProps) {
  return (
    <div className={layoutClass(view)}>
      <div className="explore__controls">{controls}</div>
      {view !== "gallery" && <div className="explore__map">{map}</div>}
      {view !== "map" && <div className="explore__results">{results}</div>}
      {view === "map" && <div className="explore__rail">{results}</div>}
    </div>
  );
}
