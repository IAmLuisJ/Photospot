import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("submit", "routes/submit.tsx"),
  route("spots/:slug", "routes/spots.$slug.tsx"),
  route("spots/:slug/edit", "routes/spots.$slug.edit.tsx"),
  route("studios/:slug", "routes/studios.$slug.tsx"),
  route("admin", "routes/admin.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/logout", "routes/auth.logout.tsx"),
  route("api/auth/*", "routes/api.auth.ts"),
  route("uploads", "routes/uploads.ts"),
  route("media/*", "routes/media.ts"),
] satisfies RouteConfig;
