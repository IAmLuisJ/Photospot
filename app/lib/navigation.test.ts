import { describe, expect, it } from "vitest";
import {
  directionsUrl,
  exploreReturnTo,
  loginPath,
  safeReturnTo,
} from "./navigation";

describe("return navigation", () => {
  it("keeps a chosen pin, filters and mobile pane across sign-in", () => {
    const from = "/?type=2&cost=free&pane=map&w=-86&s=42&e=-85&n=43";
    const next = `/submit?${new URLSearchParams({ lat: "42.96", lng: "-85.67", from })}`;
    const login = new URL(loginPath(next), "https://photospots.test");
    expect(safeReturnTo(login.searchParams.get("returnTo"))).toBe(next);
    expect(exploreReturnTo(from)).toBe(from);
  });

  it.each([
    null,
    "https://other.example",
    "//other.example",
    "/\\other.example",
    "/%2fother.example",
    "/%5cother.example",
    "/auth/login",
    "/AUTH/logout",
    "/%61uth/login",
    "/api/auth/get-session",
    "/../auth/login",
    "/%zz",
    "/\nother",
  ])("refuses unsafe or looping callbacks: %s", (path) => {
    expect(safeReturnTo(path)).toBe("/");
  });

  it("only accepts the explore page as a back-to-locations target", () => {
    expect(exploreReturnTo("/admin")).toBe("/");
    expect(exploreReturnTo("/spots/blue-bridge")).toBe("/");
    expect(exploreReturnTo("/?q=bridge&view=gallery")).toBe(
      "/?q=bridge&view=gallery",
    );
  });
});

it("opens directions to the location's exact coordinates", () => {
  const url = new URL(directionsUrl({ lat: 0, lng: -85.6784 }));
  expect(url.origin).toBe("https://www.google.com");
  expect(url.pathname).toBe("/maps/dir/");
  expect(url.searchParams.get("destination")).toBe("0,-85.6784");
  expect(url.searchParams.get("api")).toBe("1");
});
