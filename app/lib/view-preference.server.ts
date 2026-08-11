import { createCookie } from "react-router";
import type { ExploreView } from "~/domain/filters/explore-filters";

const VIEWS: readonly string[] = ["split", "map", "gallery"];

export const viewPreferenceCookie = createCookie("photospots_view", {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  // A year. The preference is not sensitive, and re-choosing it every session
  // is exactly the friction spec §8's "remembered per user" exists to avoid.
  maxAge: 60 * 60 * 24 * 365,
});

/**
 * The URL wins over the cookie, always.
 *
 * A view in the URL is what a shared link carries, and spec §8 makes every view
 * a shareable link on purpose — a photographer sending a family "here are the
 * family-photo spots near you". If the cookie won, opening that link would show
 * the recipient their own remembered view and the link would look broken.
 *
 * The cookie is stored input and is validated exactly like the URL is: a value
 * that is not a known view is ignored rather than trusted.
 */
export function resolveView(fromUrl: string | null, fromCookie: string | null): ExploreView {
  if (fromUrl !== null && VIEWS.includes(fromUrl)) return fromUrl as ExploreView;
  if (fromCookie !== null && VIEWS.includes(fromCookie)) return fromCookie as ExploreView;
  return "split";
}
