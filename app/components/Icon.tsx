import type { CSSProperties } from "react";

const paths = {
  aperture:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0 5 9m3-6-5 9m5 3H10m2 3-5-9m-3 6 5-9M4 6h10",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  back: "M19 12H5m6-6-6 6 6 6",
  pin: "M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  map: "m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16",
  photos: "M4 4h16v16H4Zm0 12 5-5 4 4 3-3 4 4M15 8h.01",
  filter: "M4 7h16M4 17h16M9 4v6m6 4v6",
  search: "M17 17l4 4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  chevron: "m8 5 7 7-7 7",
  mail: "M3 5h18v14H3Zm0 0 9 8 9-8",
  check: "m5 12 4 4L19 6",
  compass: "m16 8-3 5-5 3 3-5ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
} as const;

export function Icon({
  name,
  className,
  style,
}: {
  name: keyof typeof paths;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
