import { z } from "zod";
import {
  MAX_PHOTOS_PER_KIND,
  type PhotoInput,
} from "../domain/spots/submission";

const photosSchema = z
  .array(
    z.object({
      storagePath: z.string().min(1).max(1024),
      kind: z.enum(["scouting", "session"]),
      rightsAttested: z.boolean(),
      creditName: z.string().max(200).nullable().optional().default(null),
      creditUrl: z
        .url({ protocol: /^https?$/ })
        .max(2048)
        .nullable()
        .optional()
        .default(null),
      caption: z.string().max(4000).nullable().optional().default(null),
    }),
  )
  .max(MAX_PHOTOS_PER_KIND * 2);

/** Form JSON is untrusted even when it was originally produced by our UI. */
export function readPhotoInputs(
  value: FormDataEntryValue | null,
): PhotoInput[] {
  if (value instanceof File || (value?.length ?? 0) > 100_000) {
    throw new Error("Invalid photo metadata.");
  }
  return photosSchema.parse(JSON.parse(value ?? "[]") as unknown);
}
