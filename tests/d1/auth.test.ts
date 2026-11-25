import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "./helpers";
import { createAuth } from "../../app/lib/auth.server";

describe("Better Auth with D1", () => {
  let t: ReturnType<typeof createTestDatabase>;
  const origin = "http://localhost:5173";
  let emails: { to: string[]; text: string }[];
  const env = () => ({
    DB: t.db,
    BETTER_AUTH_SECRET: "test-secret-at-least-thirty-two-characters-long",
    AUTH_ORIGIN: origin,
    RESEND_API_KEY: "test-key",
    AUTH_EMAIL_FROM: "Photospots <photos@example.com>",
  });
  beforeEach(() => {
    t = createTestDatabase();
    emails = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url !== "https://api.resend.com/emails")
        throw new Error("Unexpected external request");
      emails.push(JSON.parse(String(init.body)));
      return Response.json({ id: "test-message" });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    t.close();
  });
  it("redeems a magic link into a verified session and rejects replay", async () => {
    const auth = createAuth(env());
    const start = await auth.handler(
      new Request(`${origin}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ email: "alice@example.com", callbackURL: "/" }),
      }),
    );
    expect(start.status).toBe(200);
    expect(emails[0].to).toEqual(["alice@example.com"]);
    const link = emails[0].text.match(/http:\/\/localhost:5173\/\S+/)![0];
    const redeemed = await auth.handler(new Request(link));
    expect(redeemed.status).toBe(302);
    const cookies = redeemed.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const session = await auth.api.getSession({
      headers: new Headers({ Cookie: cookies }),
    });
    expect(session?.user).toMatchObject({
      email: "alice@example.com",
      emailVerified: true,
    });
    expect(
      await t.db
        .prepare("SELECT role FROM profiles WHERE id=?")
        .bind(session!.user.id)
        .first("role"),
    ).toBe("user");
    const replay = await auth.handler(new Request(link));
    expect(replay.headers.get("location")).toContain("error=");
  });
  it("rejects foreign origins and unsigned session cookies", async () => {
    const auth = createAuth(env());
    const response = await auth.handler(
      new Request(`${origin}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ email: "alice@example.com", callbackURL: "/" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(emails).toHaveLength(0);
    expect(
      await auth.api.getSession({
        headers: new Headers({ Cookie: "better-auth.session_token=forged" }),
      }),
    ).toBeNull();
  });
});
