import { useEffect, useRef } from "react";
// maplibre-gl v6 dropped the default export; these are named.
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Bounds } from "~/domain/geo/bounds";
import type { SpotSummary } from "~/data/spots";

// Vite must emit the module worker as an asset; MapLibre's relative default
// URL would otherwise request an unbundled file that does not exist in production.
setWorkerUrl(mapWorkerUrl);

export interface SpotMarker {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lng: number;
  className: string;
  selected: boolean;
}

/** The subset of the MapLibre API this module reads, so it can be tested without a canvas. */
export interface MapLike {
  getBounds(): {
    getWest(): number;
    getSouth(): number;
    getEast(): number;
    getNorth(): number;
  };
  getZoom(): number;
}

export function markersFor(
  spots: SpotSummary[],
  selectedSlug?: string,
): SpotMarker[] {
  return spots.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    lat: s.position.lat,
    lng: s.position.lng,
    className: s.kind === "studio" ? "spot-pin spot-pin--studio" : "spot-pin",
    selected: s.slug === selectedSlug,
  }));
}

export function boundsFromMap(map: MapLike): {
  viewport: Bounds;
  zoom: number;
} {
  const b = map.getBounds();
  return {
    viewport: {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    },
    zoom: Math.round(map.getZoom()),
  };
}

export interface SpotMapProps {
  spots: SpotSummary[];
  viewport: Bounds;
  zoom: number;
  styleUrl: string;
  selectedSlug?: string;
  onViewportChange: (next: {
    viewport: Bounds;
    zoom: number;
    center: { lat: number; lng: number };
  }) => void;
  onSelect: (slug: string) => void;
}

/**
 * Knows nothing about fetching. It takes spots and emits viewport changes;
 * the route decides what to do with them. That keeps the fiddliest piece of the
 * app swappable and testable through `markersFor` / `boundsFromMap`.
 */
export function SpotMap({
  spots,
  viewport,
  zoom,
  styleUrl,
  selectedSlug,
  onViewportChange,
  onSelect,
}: SpotMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const lastViewport = useRef(viewport);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new MapLibreMap({
      container: container.current,
      style: styleUrl,
      bounds: [
        [viewport.west, viewport.south],
        [viewport.east, viewport.north],
      ],
      attributionControl: { compact: true },
    });
    instance.addControl(
      new NavigationControl({ showCompass: false }),
      "top-right",
    );
    const observer = new ResizeObserver(() => {
      if (container.current?.clientWidth && container.current.clientHeight)
        instance.resize();
    });
    observer.observe(container.current);

    // `moveend` rather than `move`: one event per gesture instead of one per
    // frame. Snapping to the grid then means small pans reuse the same query.
    const reportViewport = () => {
      if (!container.current?.clientWidth || !container.current.clientHeight)
        return;
      const center = instance.getCenter();
      onViewportChangeRef.current({
        ...boundsFromMap(instance),
        center: { lat: center.lat, lng: center.lng },
      });
    };
    instance.on("moveend", reportViewport);
    instance.once("load", reportViewport);

    map.current = instance;
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
    // Mount once. Later prop changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL navigation and the reset/widen controls must move the actual camera.
  // Ignore the rounded bounds emitted by the map itself to prevent a loop.
  useEffect(() => {
    const instance = map.current;
    const previous = lastViewport.current;
    lastViewport.current = viewport;
    const keys = ["west", "south", "east", "north"] as const;
    if (!instance || keys.every((key) => previous[key] === viewport[key]))
      return;
    const actual = boundsFromMap(instance).viewport;
    if (keys.every((key) => Math.abs(actual[key] - viewport[key]) < 0.00001))
      return;
    instance.fitBounds(
      [
        [viewport.west, viewport.south],
        [viewport.east, viewport.north],
      ],
      { animate: false },
    );
  }, [viewport]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    for (const m of markers.current) m.remove();
    markers.current = markersFor(spots, selectedSlug).map((marker) => {
      const el = document.createElement("button");
      el.className =
        marker.className + (marker.selected ? " spot-pin--selected" : "");
      el.type = "button";
      el.setAttribute("aria-label", marker.name);
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelect(marker.slug);
      });
      return new Marker({ element: el })
        .setLngLat([marker.lng, marker.lat])
        .addTo(instance);
    });
  }, [spots, selectedSlug, onSelect]);

  return <div ref={container} className="spot-map" data-testid="spot-map" />;
}
