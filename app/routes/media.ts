import { runtimeContext } from "../lib/runtime-context";
import { servePhoto } from "../lib/uploads.server";
import type { Route } from "./+types/media";

export function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(runtimeContext);
  return servePhoto(
    { db: env.DB, viewer: null },
    env.PHOTOS,
    params["*"],
    request,
  );
}
