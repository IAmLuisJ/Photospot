import { getRequestContext } from "../lib/request-context.server";
import { runtimeContext } from "../lib/runtime-context";
import { receivePhoto, UploadError } from "../lib/uploads.server";
import { AccessError } from "../data/context";
import type { Route } from "./+types/uploads";

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  const { store, headers } = await getRequestContext(request, context);
  try {
    return Response.json(
      await receivePhoto(
        store,
        context.get(runtimeContext).env.PHOTOS,
        request,
      ),
      { headers },
    );
  } catch (error) {
    if (error instanceof UploadError || error instanceof AccessError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    console.error(JSON.stringify({ event: "photo_upload_failed" }));
    return Response.json(
      { error: "Could not upload that photo. Please try again." },
      { status: 503, headers },
    );
  }
}
export function loader() {
  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
