import { createRequestHandler, RouterContextProvider } from "react-router";
import { createRequestContext } from "../app/lib/request-context.server";
import { appRequestContext, runtimeContext } from "../app/lib/runtime-context";
import { backfillScores, refreshHotScores } from "../app/jobs/scores";
import { sweepUploads } from "../app/jobs/uploads";

const handle = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const context = new RouterContextProvider();
    let app: ReturnType<typeof createRequestContext> | undefined;
    context.set(runtimeContext, { env, ctx });
    context.set(
      appRequestContext,
      () => (app ??= createRequestContext(request, env)),
    );
    return handle(request, context);
  },
  async scheduled(controller, env) {
    const now = new Date(controller.scheduledTime);
    const repaired = await backfillScores(env.DB);
    const refreshed = await refreshHotScores(env.DB, undefined, now);
    const removed = await sweepUploads(env.DB, env.PHOTOS, now);
    console.log(
      JSON.stringify({
        event: "scheduled_maintenance",
        repaired,
        refreshed,
        removed,
      }),
    );
  },
} satisfies ExportedHandler<Env>;
