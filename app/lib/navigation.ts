/** Auth callbacks only return to local pages, never another origin or auth loop. */
export function safeReturnTo(value: unknown, fallback = "/"): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  )
    return fallback;
  const url = new URL(value, "https://photospots.invalid");
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return fallback;
  }
  if (
    url.origin !== "https://photospots.invalid" ||
    decodedPath.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(decodedPath) ||
    /^\/(?:auth|api)(?:\/|$)/i.test(decodedPath)
  )
    return fallback;
  return url.pathname + url.search + url.hash;
}

export function exploreReturnTo(value: unknown): string {
  const path = safeReturnTo(value);
  return new URL(path, "https://photospots.invalid").pathname === "/"
    ? path
    : "/";
}

export function loginPath(returnTo: string): string {
  return `/auth/login?${new URLSearchParams({ returnTo: safeReturnTo(returnTo) })}`;
}

export function directionsUrl(position: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination: `${position.lat},${position.lng}` })}`;
}
