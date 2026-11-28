import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, Response as RuntimeResponse } from "miniflare";
import config from "../cloudflare.config";
import { seed } from "./seed-grand-rapids";

// Run the production bundle with real workerd, D1 and R2. Only email delivery
// is replaced, so no credentials or external messages are needed.
const root = await mkdtemp(join(tmpdir(), "photospots-runtime-"));
const databaseId = crypto.randomUUID();
const workerName = "photospots-runtime-test";
const origin = "http://localhost:5173";
const deliveries: { text: string; to: string[] }[] = [];
let runtime: Miniflare | undefined;
try {
  const cli = fileURLToPath(
    new URL("./bin/cf", import.meta.resolve("cf/package.json")),
  );
  const migration = spawnSync(
    process.execPath,
    [
      cli,
      "d1",
      "migrations",
      "apply",
      databaseId,
      "--local",
      "--dir",
      "migrations",
      "--persist-to",
      root,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CLOUDFLARE_DEV_REGISTRY_PATH: join(root, "registry"),
        CHOKIDAR_USEPOLLING: "1",
      },
    },
  );
  assert.equal(migration.status, 0, migration.stderr + migration.stdout);
  const bundleRoot = resolve(".cloudflare/output/v1/workers/default/bundle");
  const files = await readdir(bundleRoot, { recursive: true });
  const modules = Object.fromEntries(
    await Promise.all(
      files
        .filter((file) => file.endsWith(".js"))
        .map(async (file) => [
          "bundle/" + file,
          {
            type: "esm" as const,
            contents: await readFile(join(bundleRoot, file), "utf8"),
          },
        ]),
    ),
  );
  runtime = new Miniflare({
    cf: false,
    telemetry: { enabled: false },
    unsafeLocalExplorer: true,
    unsafeDevRegistryPath: join(root, "registry"),
    resourcePersistencePath: join(root, "v3"),
    workers: [
      {
        config: {
          name: workerName,
          compatibilityDate: config.worker.compatibilityDate,
          compatibilityFlags: ["nodejs_compat"],
          triggers: config.worker.triggers,
          manifest: { mainModule: "bundle/index.js", modules },
          env: {
            DB: { type: "d1", id: databaseId },
            PHOTOS: { type: "r2", name: "runtime-photos" },
            AUTH_ORIGIN: { type: "text", value: origin },
            BETTER_AUTH_SECRET: {
              type: "text",
              value: crypto.randomUUID() + crypto.randomUUID(),
            },
            RESEND_API_KEY: { type: "text", value: "test-key" },
            AUTH_EMAIL_FROM: { type: "text", value: "photos@example.com" },
            GOOGLE_CLIENT_ID: { type: "text", value: "test-google-client" },
            GOOGLE_CLIENT_SECRET: { type: "text", value: "test-google-secret" },
          },
        },
        dev: {
          outboundService: {
            type: "fetcher",
            async handler(request) {
              assert.equal(request.url, "https://api.resend.com/emails");
              deliveries.push(
                (await request.json()) as (typeof deliveries)[number],
              );
              return new RuntimeResponse(JSON.stringify({ id: "test-email" }), {
                headers: { "Content-Type": "application/json" },
              });
            },
          },
        },
      },
    ],
  });
  const db = await runtime.getD1Database("DB");
  const bucket = await runtime.getR2Bucket("PHOTOS");
  assert.equal(await seed(db as unknown as D1Database, bucket), 6);
  const send = (
    path: string,
    init?: Parameters<Miniflare["dispatchFetch"]>[1],
  ) => runtime!.dispatchFetch(origin + path, { redirect: "manual", ...init });
  const form = (values: Record<string, string>, cookie = "") => ({
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(values).toString(),
  });

  const home = await send("/");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Millennium Park Meadow/);
  const dataRedirect = await send(
    "/submit.data?lat=0&lng=0&_routes=routes/submit",
  );
  const redirectBody = await dataRedirect.text();
  assert.match(redirectBody, /returnTo=%2Fsubmit%3Flat%3D0/);
  assert.doesNotMatch(redirectBody, /returnTo=%2Fsubmit\.data/);
  const denied = await send("/uploads", form({}));
  assert.equal(denied.status, 401);
  await denied.body?.cancel();
  const google = await send("/auth/login", form({ intent: "google" }));
  assert.equal(google.status, 302);
  const googleUrl = new URL(google.headers.get("location")!);
  assert.equal(googleUrl.hostname, "accounts.google.com");
  assert.equal(
    googleUrl.searchParams.get("redirect_uri"),
    origin + "/api/auth/callback/google",
  );
  assert.ok(googleUrl.searchParams.get("state"));
  assert.ok(
    google.headers.getSetCookie().length,
    "OAuth state cookies must survive the app redirect",
  );
  const returnTo = "/submit?lat=42.96&lng=-85.67";
  const started = await send(
    "/auth/login",
    form({ intent: "magic-link", email: "runtime@example.com", returnTo }),
  );
  assert.equal(started.status, 200);
  assert.match(await started.text(), /Check your inbox/);
  assert.equal(deliveries.length, 1);
  const link = deliveries[0].text.match(/http:\/\/localhost:5173\/\S+/)![0];
  const verified = await runtime.dispatchFetch(link, { redirect: "manual" });
  assert.equal(verified.status, 302);
  const returned = new URL(verified.headers.get("Location")!, origin);
  assert.equal(returned.pathname + returned.search, returnTo);
  const cookie = verified.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.match(cookie, /session_token=/);
  const sessionResponse = await send("/api/auth/get-session", {
    headers: { Cookie: cookie },
  });
  const session = (await sessionResponse.json()) as {
    user: { id: string; emailVerified: boolean };
  };
  assert.equal(session.user.emailVerified, true);
  await db
    .prepare(
      "INSERT INTO spots(id,kind,name,slug,lat,lng) VALUES ('studio','studio','Test studio','test-studio',43,-85)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO studio_details(spot_id,contact_email) VALUES ('studio','runtime@example.com')",
    )
    .run();
  const claims = await Promise.all([
    send("/studios/test-studio", form({}, cookie)),
    send("/studios/test-studio", form({}, cookie)),
  ]);
  assert.deepEqual(claims.map((r) => r.status).sort(), [200, 409]);
  for (const response of claims) await response.body?.cancel();
  assert.equal(
    await db
      .prepare("SELECT owner_profile_id FROM spots WHERE id='studio'")
      .first("owner_profile_id"),
    session.user.id,
  );
  await db
    .prepare("UPDATE profiles SET role='admin' WHERE id=?")
    .bind(session.user.id)
    .run();
  await db
    .prepare(
      "INSERT INTO reports(id,target_type,target_id,reason) VALUES ('moderation-race','spot','studio','spam')",
    )
    .run();
  const decisions = await Promise.all([
    send(
      "/admin",
      form({ reportId: "moderation-race", action: "remove" }, cookie),
    ),
    send(
      "/admin",
      form({ reportId: "moderation-race", action: "dismiss" }, cookie),
    ),
  ]);
  assert.deepEqual(
    decisions.map((response) => response.status).sort(),
    [200, 409],
  );
  for (const response of decisions) await response.body?.cancel();
  const replay = await runtime.dispatchFetch(link, { redirect: "manual" });
  assert.match(replay.headers.get("location") ?? "", /error=/);
  const crossOrigin = await send("/uploads", {
    ...form({}, cookie),
    headers: { Origin: "https://evil.example", Cookie: cookie },
  });
  assert.equal(crossOrigin.status, 403);
  await crossOrigin.body?.cancel();

  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const uploaded = await send("/uploads", {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "image/jpeg" },
    body: bytes,
  });
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  const { storagePath } = (await uploaded.json()) as { storagePath: string };
  const submitted = await send(
    "/submit",
    form(
      {
        name: "Runtime park",
        lat: "43",
        lng: "-85",
        shootTypeIds: "1",
        photos: JSON.stringify([
          { storagePath, kind: "scouting", rightsAttested: false },
        ]),
      },
      cookie,
    ),
  );
  assert.equal(submitted.status, 302, await submitted.text());
  assert.deepEqual(
    await db
      .prepare(
        "SELECT accessibility,terrain FROM spots WHERE name='Runtime park'",
      )
      .first(),
    { accessibility: null, terrain: null },
  );
  const mediaPath =
    "/media/" + storagePath.split("/").map(encodeURIComponent).join("/");
  const media = await send(mediaPath);
  assert.equal(media.status, 200);
  const etag = media.headers.get("ETag")!;
  assert.deepEqual(new Uint8Array(await media.arrayBuffer()), bytes);
  await db
    .prepare("UPDATE photos SET status='removed' WHERE storage_path=?")
    .bind(storagePath)
    .run();
  const removed = await send(mediaPath, { headers: { "If-None-Match": etag } });
  assert.equal(removed.status, 404);
  await removed.body?.cancel();

  await bucket.put("expired.jpg", bytes);
  await db
    .prepare(
      "INSERT INTO uploads(storage_path,content_type,byte_size,state,created_at,expires_at) VALUES ('expired.jpg','image/jpeg',8,'ready','2020-01-01T00:00:00.000Z','2020-01-02T00:00:00.000Z')",
    )
    .run();
  const maintenance = await send(
    `/cdn-cgi/local/explorer/api/local/scheduled?worker=${workerName}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cron: "17 * * * *" }),
    },
  );
  assert.equal(maintenance.status, 200, await maintenance.text());
  assert.equal(
    await db
      .prepare(
        "SELECT storage_path FROM uploads WHERE storage_path='expired.jpg'",
      )
      .first(),
    null,
  );
  assert.equal(await bucket.get("expired.jpg"), null);

  const loggedOut = await send("/auth/logout", form({}, cookie));
  assert.equal(loggedOut.status, 302);
  assert.match(
    loggedOut.headers.getSetCookie().join(";"),
    /session_token=.*Max-Age=0/,
  );
  const cleared = await send("/api/auth/get-session", {
    headers: { Cookie: cookie },
  });
  assert.equal(await cleared.json(), null);
  console.log(
    "Worker HTTP smoke passed: SSR, native D1/R2, Google state cookies, magic-link session and replay, concurrent claims/moderation, origin protection, upload/submission, unknown attributes, media visibility, scheduled cleanup and logout.",
  );
} finally {
  await runtime?.dispose();
  await rm(root, { recursive: true, force: true });
}
