import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addSpot, addUser, createTestDatabase } from "./helpers";
import { receivePhoto, servePhoto } from "../../app/lib/uploads.server";
import type { DataContext } from "../../app/data/context";

describe("R2 photos", () => {
  let t: ReturnType<typeof createTestDatabase>;
  let ctx: DataContext;
  let objects: Map<string, { body: Uint8Array; type: string }>;
  let bucket: Pick<R2Bucket, "put" | "get" | "delete">;
  const jpeg = new Uint8Array([
    255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217,
  ]);
  const request = (bytes = jpeg, type = "image/jpeg", length?: string) =>
    new Request("http://localhost:5173/uploads", {
      method: "POST",
      headers: {
        "Content-Type": type,
        ...(length ? { "Content-Length": length } : {}),
      },
      body: bytes,
    });
  beforeEach(async () => {
    t = createTestDatabase();
    ctx = { db: t.db, viewer: await addUser(t.db, "alice") };
    objects = new Map();
    bucket = {
      async put(key: string, value: BodyInit, options?: R2PutOptions) {
        objects.set(key, {
          body: new Uint8Array(await new Response(value).arrayBuffer()),
          type:
            options?.httpMetadata && "contentType" in options.httpMetadata
              ? (options.httpMetadata.contentType ?? "")
              : "",
        });
        return { key };
      },
      async get(key: string) {
        const object = objects.get(key);
        return object
          ? {
              body: new Blob([new Uint8Array(object.body)]).stream(),
              httpEtag: '"test-etag"',
              httpMetadata: { contentType: object.type },
            }
          : null;
      },
      async delete(keys: string | string[]) {
        for (const key of Array.isArray(keys) ? keys : [keys])
          objects.delete(key);
      },
    } as Pick<R2Bucket, "put" | "get" | "delete">;
  });
  afterEach(() => t.close());
  it("stores an image under a server-generated owned key and creates a receipt", async () => {
    const { storagePath } = await receivePhoto(ctx, bucket, request());
    expect(storagePath).toMatch(/^alice\/[a-f0-9-]+\.jpg$/);
    expect(objects.get(storagePath)?.body).toEqual(jpeg);
    expect(
      await t.db
        .prepare(
          "SELECT profile_id,byte_size,attached_at FROM uploads WHERE storage_path=?",
        )
        .bind(storagePath)
        .first(),
    ).toEqual({ profile_id: "alice", byte_size: 14, attached_at: null });
  });
  it("rejects anonymous uploads, MIME mismatches, and oversized bodies", async () => {
    await expect(
      receivePhoto({ db: t.db, viewer: null }, bucket, request()),
    ).rejects.toThrow(/signed in/i);
    await expect(
      receivePhoto(ctx, bucket, request(jpeg, "image/svg+xml")),
    ).rejects.toThrow(/JPEG|PNG|WebP/);
    await expect(
      receivePhoto(ctx, bucket, request(jpeg, "image/png")),
    ).rejects.toThrow(/match/i);
    await expect(
      receivePhoto(ctx, bucket, request(jpeg, "image/jpeg", "8000001")),
    ).rejects.toThrow(/8 MB/);
    expect(objects.size).toBe(0);
  });
  it("enforces the byte limit even without a content-length header", async () => {
    const bytes = new Uint8Array(8_000_001);
    bytes.set(jpeg);
    await expect(receivePhoto(ctx, bucket, request(bytes))).rejects.toThrow(
      /8 MB/,
    );
    expect(
      await t.db.prepare("SELECT COUNT(*) AS n FROM uploads").first("n"),
    ).toBe(0);
  });
  it("serves only published photos on published spots and checks visibility before ETags", async () => {
    const { storagePath } = await receivePhoto(ctx, bucket, request());
    expect(
      (
        await servePhoto(
          ctx,
          bucket,
          storagePath,
          new Request("http://localhost/media"),
        )
      ).status,
    ).toBe(404);
    const spot = await addSpot(t.db, "alice");
    await t.db
      .prepare(
        "INSERT INTO photos(id,spot_id,kind,storage_path) VALUES ('photo',?,'scouting',?)",
      )
      .bind(spot.id, storagePath)
      .run();
    const served = await servePhoto(
      ctx,
      bucket,
      storagePath,
      new Request("http://localhost/media"),
    );
    expect(served.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(jpeg);
    await t.db
      .prepare("UPDATE photos SET status='removed' WHERE id='photo'")
      .run();
    expect(
      (
        await servePhoto(
          ctx,
          bucket,
          storagePath,
          new Request("http://localhost/media", {
            headers: { "If-None-Match": '"test-etag"' },
          }),
        )
      ).status,
    ).toBe(404);
  });
});
