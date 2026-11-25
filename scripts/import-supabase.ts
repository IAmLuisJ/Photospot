import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { createLocalResources, isMain } from "./local-resources";

const userSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  name: z.string().optional(),
  email_verified: z.boolean(),
  created_at: z.string().optional(),
});
const snapshotSchema = z
  .object({
    users: z.array(userSchema),
    identities: z
      .array(
        z.object({
          user_id: z.string(),
          provider: z.string(),
          provider_id: z.string().nullable(),
        }),
      )
      .default([]),
  })
  .catchall(z.array(z.record(z.string(), z.unknown())));

const columns = {
  shoot_types: "id,slug,label,sort_order",
  profiles:
    "id,display_name,role,avatar_url,bio,website_url,instagram,created_at",
  spots:
    "id,kind,name,slug,description,lat,lng,locality,region,created_by,owner_profile_id,status,score,hot_score,cost_type,cost_notes,permit_url,hours_notes,best_light,best_seasons,walk_minutes,parking_notes,terrain,accessibility,max_group_size,dog_friendly,created_at,updated_at",
  spot_shoot_types: "spot_id,shoot_type_id",
  signals: "id,spot_id,profile_id,kind,shoot_type_id,value,created_at",
  photos:
    "id,spot_id,profile_id,kind,storage_path,caption,shoot_type_id,rights_attested,credit_name,credit_url,width,height,blurhash,status,created_at",
  spot_gallery_links:
    "id,spot_id,profile_id,url,title,shoot_type_id,created_at",
  comments: "id,spot_id,profile_id,body,status,created_at",
  studio_details:
    "spot_id,hourly_rate_cents,booking_url,contact_email,claimed_by,claimed_at,created_at,updated_at",
  reports:
    "id,target_type,target_id,profile_id,reason,note,status,resolved_by,created_at",
} as const;
const arrays = new Set([
  "best_light",
  "best_seasons",
  "terrain",
  "accessibility",
]);
const numbers = new Set([
  "lat",
  "lng",
  "score",
  "hot_score",
  "hourly_rate_cents",
]);

/** Same commands for a local rehearsal and a reviewed cf d1 query --batch file. */
export function buildImportBatch(
  input: unknown,
): { sql: string; params: (string | number | null)[] }[] {
  const snapshot = snapshotSchema.parse(input);
  const statements: { sql: string; params: (string | number | null)[] }[] = [];
  const command = (sql: string, ...params: (string | number | null)[]) => {
    statements.push({ sql, params });
  };
  // This check stays inside the batch so a concurrent sign-in cannot slip
  // between the empty-target check and the import.
  command(
    "CREATE TABLE _photospots_import_guard (existing INTEGER CHECK(existing=0))",
  );
  command(
    'INSERT INTO _photospots_import_guard SELECT (SELECT COUNT(*) FROM "user") + (SELECT COUNT(*) FROM spots)',
  );
  command("DROP TABLE _photospots_import_guard");
  for (const user of snapshot.users) {
    const created = user.created_at
      ? new Date(user.created_at).getTime()
      : Date.now();
    if (!Number.isFinite(created)) throw new Error("Invalid user timestamp.");
    command(
      'INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)',
      user.id,
      user.name || user.email.split("@")[0],
      user.email,
      Number(user.email_verified),
      created,
      created,
    );
  }
  for (const identity of snapshot.identities) {
    if (identity.provider === "email") continue;
    if (identity.provider !== "google" || !identity.provider_id)
      throw new Error(
        "Only Google and passwordless email identities are supported by this migration.",
      );
    command(
      "INSERT INTO account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES (?,?,'google',?,?,?)",
      crypto.randomUUID(),
      identity.provider_id,
      identity.user_id,
      Date.now(),
      Date.now(),
    );
  }
  for (const [table, allowed] of Object.entries(columns)) {
    const rows = snapshot[table] as Record<string, unknown>[] | undefined;
    if (!rows?.length) continue;
    if (table === "shoot_types") command("DELETE FROM shoot_types");
    for (const sourceRow of rows) {
      const user =
        table === "profiles"
          ? snapshot.users.find((user) => user.id === sourceRow.id)
          : undefined;
      if (table === "profiles" && !user)
        throw new Error("Profile is missing its auth user.");
      const row = user
        ? { display_name: user.name || user.email.split("@")[0], ...sourceRow }
        : sourceRow;
      const keys = allowed.split(",").filter((key) => row[key] !== undefined);
      if (!keys.length) throw new Error(`Empty ${table} row.`);
      const values = keys.map((key) => {
        const value = row[key];
        if (value === null) return null;
        if (arrays.has(key))
          return Array.isArray(value) ? JSON.stringify(value) : String(value);
        if (key.endsWith("_at")) {
          const date = new Date(String(value));
          if (!Number.isFinite(date.getTime()))
            throw new Error(`Invalid ${table}.${key} timestamp.`);
          return date.toISOString();
        }
        if (typeof value === "boolean") return Number(value);
        if (numbers.has(key)) {
          if (!Number.isFinite(Number(value)))
            throw new Error(`Invalid ${table}.${key} number.`);
          return Number(value);
        }
        if (typeof value === "string" || typeof value === "number")
          return value;
        throw new Error(`Unsupported ${table}.${key} value.`);
      });
      const updates = keys
        .filter((key) => key !== "id")
        .map((key) => `${key}=excluded.${key}`)
        .join(",");
      const conflict =
        table === "profiles"
          ? ` ON CONFLICT(id) DO ${updates ? `UPDATE SET ${updates}` : "NOTHING"}`
          : "";
      command(
        `INSERT INTO ${table}(${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})${conflict}`,
        ...values,
      );
    }
  }
  return statements;
}

/** Import into an empty staging D1, retaining the application's stable IDs. */
export async function importSnapshot(
  db: D1Database,
  input: unknown,
): Promise<void> {
  const existing = await db
    .prepare(
      'SELECT (SELECT COUNT(*) FROM "user") + (SELECT COUNT(*) FROM spots) AS n',
    )
    .first<number>("n");
  if (existing)
    throw new Error(
      "Legacy import requires an empty target. Do not seed or enable sign-in before importing.",
    );
  await db.batch(
    buildImportBatch(input).map((c) => db.prepare(c.sql).bind(...c.params)),
  );
}

if (isMain(import.meta.url)) {
  const file = process.argv[2];
  if (!file)
    throw new Error(
      "Usage: npm run import:legacy -- snapshot.json [--batch-file output.json]",
    );
  const snapshot: unknown = JSON.parse(await readFile(file, "utf8"));
  if (process.argv[3] === "--batch-file" && process.argv[4]) {
    await writeFile(
      process.argv[4],
      JSON.stringify(buildImportBatch(snapshot), null, 2),
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "Wrote the migration batch for review. No database was changed.",
    );
  } else {
    if (process.argv.length > 3)
      throw new Error(
        "Expected --batch-file output.json, or no additional arguments for a local import.",
      );
    const local = await createLocalResources();
    try {
      await importSnapshot(local.db, snapshot);
      console.log(
        "Imported the legacy snapshot into local D1. Copy photo objects before deployment.",
      );
    } finally {
      await local.close();
    }
  }
}
