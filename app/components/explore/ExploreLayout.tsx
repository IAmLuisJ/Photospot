import { useState, type ReactNode } from "react";
import type { ExploreView } from "~/domain/filters/explore-filters";
import { ResultsSheet } from "./ResultsSheet";

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

export type GalleryTab = "photos" | "map";

/** Gallery is the only view with a tab pair; the others always show the map. */
export function showsMap(view: ExploreView, tab: GalleryTab): boolean {
  return view !== "gallery" || tab === "map";
}

export function showsResults(view: ExploreView, tab: GalleryTab): boolean {
  if (view === "gallery") return tab === "photos";
  return true;
}

export interface ExploreLayoutProps {
  view: ExploreView;
  map: ReactNode;
  results: ReactNode;
  controls: ReactNode;
}

export function ExploreLayout({ view, map, results, controls }: ExploreLayoutProps) {
  // Spec §8: gallery is "a photo grid with the map behind a tab". Local state
  // rather than the URL, because it is a glance at the map rather than a view
  // worth sharing — the view itself is already in the URL.
  const [galleryTab, setGalleryTab] = useState<GalleryTab>("photos");

  return (
    <div className={layoutClass(view)}>
      <div className="explore__controls">{controls}</div>

      {view === "gallery" && (
        <div className="explore__tabs" role="group" aria-label="Gallery">
          {(["photos", "map"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={galleryTab === tab}
              onClick={() => setGalleryTab(tab)}
            >
              {tab === "photos" ? "Photos" : "Map"}
            </button>
          ))}
        </div>
      )}

      {showsMap(view, galleryTab) && <div className="explore__map">{map}</div>}
      {view !== "map" && showsResults(view, galleryTab) && (
        <div className="explore__results">{results}</div>
      )}
      {view === "map" && <div className="explore__rail">{results}</div>}

      {/*
        Mobile: every view collapses to a full-screen map with a draggable
        results sheet (spec §8), so the arrangement above is hidden by CSS below
        768px and this takes over. Rendered for all three views because the view
        choice is desktop-only.
      */}
      <div className="explore__sheet">
        <ResultsSheet>{results}</ResultsSheet>
      </div>
    </div>
  );
}
