export { uploadPathFor } from "./photo-path";

/** Longest edge after downscaling. Enough for a full-width hero on a retina screen. */
export const MAX_IMAGE_EDGE = 2000;

const JPEG_QUALITY = 0.82;

export function targetDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_IMAGE_EDGE) return { width, height };

  const scale = MAX_IMAGE_EDGE / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Downscale in the browser so a 12 MP phone photo does not travel at full size. */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = targetDimensions(bitmap.width, bitmap.height);

  if (
    width === bitmap.width &&
    height === bitmap.height &&
    file.size < 1_500_000
  ) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  return blob ?? file;
}

export interface UploadedPhoto {
  storagePath: string;
  width: number;
  height: number;
}

/**
 * Uploads before the spot exists. An abandoned submission therefore leaves
 * orphaned objects, which spec §10 says a periodic job sweeps — that is the
 * accepted cost of never creating a photo-less spot.
 */
export async function uploadSpotPhoto(file: File): Promise<UploadedPhoto> {
  const bitmap = await createImageBitmap(file);
  const dimensions = targetDimensions(bitmap.width, bitmap.height);
  bitmap.close();

  const body = await downscale(file);
  const response = await fetch("/uploads", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": body.type || "image/jpeg" },
    body,
  });
  const uploaded = (await response.json()) as {
    storagePath?: string;
    error?: string;
  };
  if (!response.ok || !uploaded.storagePath)
    throw new Error(uploaded.error ?? "Could not upload that photo.");
  return {
    storagePath: uploaded.storagePath,
    width: dimensions.width,
    height: dimensions.height,
  };
}
