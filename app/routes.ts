import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("submit", "routes/submit.tsx"),
  route("spots/:slug", "routes/spots.$slug.tsx"),
  route("spots/:slug/edit", "routes/spots.$slug.edit.tsx"),
  route("studios/:slug", "routes/studios.$slug.tsx"),
  route("admin", "routes/admin.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/callback", "routes/auth.callback.tsx"),
  route("auth/logout", "routes/auth.logout.tsx"),
] satisfies RouteConfig;
