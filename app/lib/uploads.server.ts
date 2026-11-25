import { requireViewer, type DataContext } from "../data/context";
import { uploadPathFor } from "./photo-path";

export const MAX_UPLOAD_BYTES = 8_000_000;
const UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;
type PhotoBucket = Pick<R2Bucket, "put" | "get" | "delete">;

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

async function readImage(request: Request, expectedType: string) {
  const length = request.headers.get("Content-Length");
  if (
    length &&
    (!Number.isSafeInteger(Number(length)) ||
      Number(length) > MAX_UPLOAD_BYTES ||
      Number(length) < 1)
  ) {
    throw new UploadError("Photos must be between 1 byte and 8 MB.", 413);
  }
  if (!request.body) throw new UploadError("Choose a photo.");
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        throw new UploadError("Photos must be at most 8 MB.", 413);
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new UploadError("Choose a photo.");
  const blob = new Blob(chunks, { type: expectedType });
  const prefix = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...prefix.slice(start, end));
  const actual =
    prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255
      ? "image/jpeg"
      : [137, 80, 78, 71, 13, 10, 26, 10].every(
            (byte, index) => prefix[index] === byte,
          )
        ? "image/png"
        : ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP"
          ? "image/webp"
          : null;
  if (actual !== expectedType)
    throw new UploadError(
      "The photo contents do not match its image type.",
      415,
    );
  return blob;
}

export async function receivePhoto(
  context: DataContext,
  bucket: PhotoBucket,
  request: Request,
) {
  const viewer = requireViewer(context);
  const type =
    request.headers.get("Content-Type")?.split(";")[0].toLowerCase() ?? "";
  const extension = (
    { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<
      string,
      string
    >
  )[type];
  if (!extension)
    throw new UploadError("Choose a JPEG, PNG, or WebP photo.", 415);
  const body = await readImage(request, type);
  const storagePath = uploadPathFor(viewer.id, `photo.${extension}`);
  const now = new Date();
  const receipt = await context.db
    .prepare(
      `INSERT INTO uploads(storage_path,profile_id,content_type,byte_size,state,created_at,expires_at)
    SELECT ?,?,?,?,'pending',?,? WHERE (SELECT COUNT(*) FROM uploads WHERE profile_id=? AND attached_at IS NULL) < 36`,
    )
    .bind(
      storagePath,
      viewer.id,
      type,
      body.size,
      now.toISOString(),
      new Date(now.getTime() + UPLOAD_LIFETIME_MS).toISOString(),
      viewer.id,
    )
    .run();
  if (!receipt.meta.changes)
    throw new UploadError(
      "Finish your existing uploads before adding more photos.",
      429,
    );
  try {
    const stored = await bucket.put(storagePath, await body.arrayBuffer(), {
      httpMetadata: { contentType: type },
    });
    if (!stored) throw new Error("Photo storage unavailable.");
    await context.db
      .prepare("UPDATE uploads SET state='ready' WHERE storage_path=?")
      .bind(storagePath)
      .run();
  } catch (error) {
    // Leave a deleting receipt if object cleanup itself fails; the scheduled
    // sweeper retries it rather than losing track of a storage object.
    await context.db
      .prepare("UPDATE uploads SET state='deleting' WHERE storage_path=?")
      .bind(storagePath)
      .run();
    await bucket.delete(storagePath);
    await context.db
      .prepare("DELETE FROM uploads WHERE storage_path=? AND state='deleting'")
      .bind(storagePath)
      .run();
    throw error;
  }
  return { storagePath };
}

export async function servePhoto(
  context: DataContext,
  bucket: PhotoBucket,
  key: string,
  request: Request,
): Promise<Response> {
  const visible = await context.db
    .prepare(
      `SELECT p.id FROM photos p JOIN spots s ON s.id=p.spot_id
    WHERE p.storage_path=? AND p.status='published' AND s.status='published'`,
    )
    .bind(key)
    .first();
  if (!visible) return new Response("Not found", { status: 404 });
  const object = await bucket.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type":
      object.httpMetadata?.contentType ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cache-Control": "public, max-age=0, must-revalidate",
    ETag: object.httpEtag,
  });
  if (request.headers.get("If-None-Match") === object.httpEtag) {
    await object.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") {
    await object.body.cancel();
    return new Response(null, { headers });
  }
  return new Response(object.body, { headers });
}
