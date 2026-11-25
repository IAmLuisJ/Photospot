import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { createTestDatabase, addSpot, addUser } from "./helpers";
import { createAuth } from "../../app/lib/auth.server";
import { createRequestContext } from "../../app/lib/request-context.server";
import {
  appRequestContext,
  runtimeContext,
} from "../../app/lib/runtime-context";
import { action as submit } from "../../app/routes/submit";
import { action as edit } from "../../app/routes/spots.$slug.edit";
import { action as vote } from "../../app/routes/spots.$slug";
import { action as moderate } from "../../app/routes/admin";
import { action as upload } from "../../app/routes/uploads";
import { action as logout } from "../../app/routes/auth.logout";
import { action as login } from "../../app/routes/auth.login";

describe("HTTP action boundaries with real Better Auth sessions", () => {
  let t: ReturnType<typeof createTestDatabase>;
  const origin = "http://localhost:5173";
  const deliveries: { text: string }[] = [];
  const photoPut = vi.fn();
  const env = () => ({
    DB: t.db,
    PHOTOS: { put: photoPut },
    AUTH_ORIGIN: origin,
    BETTER_AUTH_SECRET: "route-tests-with-at-least-thirty-two-characters",
    RESEND_API_KEY: "test-key",
    AUTH_EMAIL_FROM: "photos@example.com",
  });
  beforeEach(() => {
    t = createTestDatabase();
    deliveries.length = 0;
    photoPut.mockReset();
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url !== "https://api.resend.com/emails")
        throw new Error("Unexpected external request");
      deliveries.push(JSON.parse(String(init.body)));
      return Response.json({ id: "test-message" });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    t.close();
  });
  function args(request: Request, slug = "") {
    const context = new RouterContextProvider();
    context.set(runtimeContext, {
      env: env() as unknown as Env,
      ctx: {} as ExecutionContext,
    });
    context.set(appRequestContext, () => createRequestContext(request, env()));
    return {
      request,
      url: new URL(request.url),
      params: { slug },
      context,
      pattern: "",
    };
  }
  function post(
    path: string,
    values: Record<string, string>,
    cookie = "",
    requestOrigin = origin,
  ) {
    return new Request(origin + path, {
      method: "POST",
      headers: { Origin: requestOrigin, Cookie: cookie },
      body: new URLSearchParams(values),
    });
  }
  async function signIn() {
    const auth = createAuth(env());
    const started = await login(
      args(
        post("/auth/login", {
          intent: "magic-link",
          email: "alice@example.com",
        }),
      ),
    );
    expect(started).toMatchObject({ data: { sent: true } });
    const redeemed = await auth.handler(
      new Request(
        deliveries.at(-1)!.text.match(/http:\/\/localhost:5173\/\S+/)![0],
      ),
    );
    const cookie = redeemed.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    expect(cookie).toContain("session_token=");
    return {
      auth,
      cookie,
      session: (await auth.api.getSession({
        headers: new Headers({ Cookie: cookie }),
      }))!,
    };
  }
  it("rejects direct anonymous writes without relying on loaders", async () => {
    const owner = await addUser(t.db, "owner");
    const spot = await addSpot(t.db, owner.id);
    const cases = [
      [submit, post("/submit", {})],
      [edit, post(`/spots/${spot.slug}/edit`, { name: "Stolen" })],
      [
        vote,
        post(`/spots/${spot.slug}`, { intent: "shoot-again", answer: "yes" }),
      ],
      [moderate, post("/admin", { reportId: "forged", action: "remove" })],
      [upload, post("/uploads", {})],
    ] as const;
    for (const [action, request] of cases) {
      const result = await action(args(request, spot.slug));
      expect(
        result instanceof Response ? result.status : result.init?.status,
      ).toBe(401);
    }
    expect(
      await t.db
        .prepare("SELECT name FROM spots WHERE id=?")
        .bind(spot.id)
        .first("name"),
    ).toBe("River park");
    expect(photoPut).not.toHaveBeenCalled();
  });
  it.each([
    "{",
    "null",
    "{}",
    "[null]",
    '[{"kind":"session","rightsAttested":"false"}]',
  ])(
    "returns a field error for malformed photo metadata: %s",
    async (photos) => {
      const { cookie } = await signIn();
      const result = await submit(
        args(
          post(
            "/submit",
            { name: "Park", lat: "43", lng: "-85", shootTypeIds: "1", photos },
            cookie,
          ),
        ),
      );
      expect(result).toMatchObject({
        data: { errors: [{ field: "photos" }] },
        init: { status: 400 },
      });
      expect(
        await t.db.prepare("SELECT COUNT(*) FROM spots").first("COUNT(*)"),
      ).toBe(0);
    },
  );
  it("uses the session actor, forbids cross-user edits and blocks foreign origins", async () => {
    const owner = await addUser(t.db, "owner");
    const spot = await addSpot(t.db, owner.id);
    const { cookie, session } = await signIn();
    const changed = await edit(
      args(
        post(
          `/spots/${spot.slug}/edit`,
          { name: "Stolen", profileId: owner.id },
          cookie,
        ),
        spot.slug,
      ),
    );
    expect(changed).toMatchObject({ init: { status: 403 } });
    const result = await vote(
      args(
        post(
          `/spots/${spot.slug}`,
          { intent: "shoot-again", answer: "yes", profileId: owner.id },
          cookie,
        ),
        spot.slug,
      ),
    );
    expect(result).toMatchObject({ data: { ok: true } });
    expect(
      await t.db.prepare("SELECT profile_id FROM signals").first("profile_id"),
    ).toBe(session.user.id);
    await expect(
      vote(
        args(
          post(
            `/spots/${spot.slug}`,
            { intent: "shoot-again", answer: "no" },
            cookie,
            "https://evil.example",
          ),
          spot.slug,
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await t.db.prepare("SELECT value FROM signals").first("value")).toBe(
      1,
    );
  });
  it("forwards logout cookies and invalidates the database session", async () => {
    const { auth, cookie } = await signIn();
    const response = await logout(args(post("/auth/logout", {}, cookie)));
    expect(response.status).toBe(302);
    expect(response.headers.getSetCookie().join(";")).toMatch(
      /session_token=.*Max-Age=0/,
    );
    expect(
      await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) }),
    ).toBeNull();
  });

  it("preserves unknown arrays on unrelated edits and distinguishes explicit none", async () => {
    const { cookie, session } = await signIn();
    const spot = await addSpot(t.db, session.user.id, {
      accessibility: null,
      terrain: null,
    });
    const saved = await edit(
      args(
        post(`/spots/${spot.slug}/edit`, { name: "Renamed" }, cookie),
        spot.slug,
      ),
    );
    expect(saved).toMatchObject({ status: 302 });
    expect(
      await t.db
        .prepare("SELECT accessibility,terrain FROM spots WHERE id=?")
        .bind(spot.id)
        .first(),
    ).toEqual({ accessibility: null, terrain: null });
    await edit(
      args(
        post(
          `/spots/${spot.slug}/edit`,
          { accessibilityState: "known", terrainState: "known" },
          cookie,
        ),
        spot.slug,
      ),
    );
    expect(
      await t.db
        .prepare("SELECT accessibility,terrain FROM spots WHERE id=?")
        .bind(spot.id)
        .first(),
    ).toEqual({ accessibility: "[]", terrain: "[]" });
    await edit(
      args(
        post(
          `/spots/${spot.slug}/edit`,
          { accessibilityState: "unknown", terrainState: "unknown" },
          cookie,
        ),
        spot.slug,
      ),
    );
    expect(
      await t.db
        .prepare("SELECT accessibility,terrain FROM spots WHERE id=?")
        .bind(spot.id)
        .first(),
    ).toEqual({ accessibility: null, terrain: null });
  });

  it("keeps unanswered new-spot attributes unknown", async () => {
    const { cookie, session } = await signIn();
    await t.db
      .prepare(
        "INSERT INTO uploads(storage_path,profile_id,content_type,byte_size,state,created_at,expires_at) VALUES ('route.jpg',?,'image/jpeg',8,'ready','2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z')",
      )
      .bind(session.user.id)
      .run();
    const result = await submit(
      args(
        post(
          "/submit",
          {
            name: "Unanswered",
            lat: "43",
            lng: "-85",
            shootTypeIds: "1",
            photos: JSON.stringify([
              {
                storagePath: "route.jpg",
                kind: "scouting",
                rightsAttested: false,
              },
            ]),
          },
          cookie,
        ),
      ),
    );
    expect(result).toMatchObject({ status: 302 });
    expect(
      await t.db.prepare("SELECT accessibility,terrain FROM spots").first(),
    ).toEqual({ accessibility: null, terrain: null });
  });

  it("returns a conflict when a moderator acts on an already closed report", async () => {
    const { cookie, session } = await signIn();
    await t.db
      .prepare("UPDATE profiles SET role='admin' WHERE id=?")
      .bind(session.user.id)
      .run();
    const spot = await addSpot(t.db, session.user.id);
    await t.db
      .prepare(
        "INSERT INTO reports(id,target_type,target_id,reason,status) VALUES ('closed','spot',?,'spam','dismissed')",
      )
      .bind(spot.id)
      .run();
    const result = await moderate(
      args(post("/admin", { reportId: "closed", action: "remove" }, cookie)),
    );
    expect(result).toMatchObject({ init: { status: 409 } });
    expect(
      await t.db
        .prepare("SELECT status FROM spots WHERE id=?")
        .bind(spot.id)
        .first("status"),
    ).toBe("published");
  });
});
