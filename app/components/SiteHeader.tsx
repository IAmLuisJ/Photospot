import { Form, Link, useLocation, useMatches } from "react-router";
import type { Profile } from "~/data/profiles";
import { loginPath } from "~/lib/navigation";
import { Icon } from "./Icon";

export function SiteHeader() {
  const location = useLocation();
  const matches = useMatches();
  const routeData = matches
    .map((match) => match.loaderData)
    .reverse()
    .find(
      (value): value is { profile: Profile | null } =>
        typeof value === "object" && value !== null && "profile" in value,
    );
  const profile = routeData?.profile;
  const params = new URLSearchParams(
    location.pathname === "/" ? location.search : "",
  );
  params.set("add", "1");
  params.set("view", "map");
  return (
    <header className="site-header">
      <Link className="wordmark" to="/" aria-label="Photospots home">
        <Icon name="aperture" />
        photospots<span className="wordmark__dot">.</span>
      </Link>
      <span className="site-header__tagline">
        Good places. Better photographs.
      </span>
      <nav aria-label="Main navigation">
        <Link className="site-header__contribute" to={`/?${params}`}>
          <Icon name="plus" />
          Add a spot
        </Link>
        {profile ? (
          <details className="account-menu">
            <summary>{profile.displayName || "Your account"}</summary>
            <div className="account-menu__body">
              {profile.role === "admin" && <Link to="/admin">Moderation</Link>}
              <Form method="post" action="/auth/logout">
                <button type="submit">Sign out</button>
              </Form>
            </div>
          </details>
        ) : (
          location.pathname !== "/auth/login" && (
            <Link
              className="site-header__signin"
              to={loginPath(location.pathname + location.search)}
            >
              Sign in
            </Link>
          )
        )}
      </nav>
    </header>
  );
}
