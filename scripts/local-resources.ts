import { Miniflare } from "miniflare";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import config from "../cloudflare.config";

export function isMain(url: string) {
  return (
    Boolean(process.argv[1]) &&
    pathToFileURL(resolve(process.argv[1])).href === url
  );
}

/** Same binding identities and state directory as the Cloudflare Vite plugin. */
export async function createLocalResources() {
  const worker = config.worker;
  const runtime = new Miniflare({
    cf: false,
    telemetry: { enabled: false },
    resourcePersistencePath: resolve(".cloudflare/state/v3"),
    workers: [
      {
        config: {
          name: worker.name,
          compatibilityDate: worker.compatibilityDate,
          manifest: {
            mainModule: "local.mjs",
            modules: {
              "local.mjs": {
                type: "esm",
                contents:
                  "export default { fetch() { return new Response('local resources'); } };",
              },
            },
          },
          env: {
            DB: {
              type: "d1",
              id: worker.env.DB.id ?? `DB-${worker.name}`,
              name: worker.env.DB.name,
            },
            PHOTOS: {
              type: "r2",
              name: worker.env.PHOTOS.name ?? `PHOTOS-${worker.name}`,
            },
          },
        },
      },
    ],
  });
  try {
    return {
      db: await runtime.getD1Database("DB"),
      photos: await runtime.getR2Bucket("PHOTOS"),
      close: () => runtime.dispose(),
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
