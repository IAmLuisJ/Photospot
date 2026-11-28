import { slugCandidates } from "../app/domain/spots/slug";
import { backfillScores } from "../app/jobs/scores";
import { createLocalResources, isMain } from "./local-resources";

interface SeedSpot {
  name: string;
  lng: number;
  lat: number;
  description: string;
  shootTypes: string[];
  walkMinutes: number;
  terrain: string[];
  accessibility: string[];
  costType: string;
  hue: number;
}

const SPOTS: SeedSpot[] = [
  {
    name: "Millennium Park Meadow",
    lng: -85.7267,
    lat: 42.9214,
    description:
      "Wide open meadow with long sightlines. Best an hour before sunset.",
    shootTypes: ["family", "engagement"],
    walkMinutes: 12,
    terrain: ["gravel", "grass"],
    accessibility: ["restrooms", "stroller"],
    costType: "free",
    hue: 96,
  },
  {
    name: "Blue Bridge",
    lng: -85.6784,
    lat: 42.9636,
    description:
      "Steel pedestrian bridge over the Grand. Downtown skyline behind.",
    shootTypes: ["engagement", "senior-portrait"],
    walkMinutes: 2,
    terrain: ["paved"],
    accessibility: ["wheelchair", "stroller"],
    costType: "free",
    hue: 205,
  },
  {
    name: "John Ball Park Overlook",
    lng: -85.7011,
    lat: 42.9631,
    description:
      "Hilltop view over the west side. Steep path — not for grandparents.",
    shootTypes: ["senior-portrait"],
    walkMinutes: 15,
    terrain: ["steep", "grass"],
    accessibility: [],
    costType: "free",
    hue: 28,
  },
  {
    name: "Riverside Park Birches",
    lng: -85.6553,
    lat: 43.0123,
    description:
      "Stand of birches along the river path. Dappled light all afternoon.",
    shootTypes: ["family", "maternity"],
    walkMinutes: 6,
    terrain: ["paved", "grass"],
    accessibility: ["restrooms", "stroller", "shade"],
    costType: "free",
    hue: 140,
  },
  {
    name: "Ah-Nab-Awen Park",
    lng: -85.6742,
    lat: 42.9689,
    description: "Grass terraces by the river with the museum behind.",
    shootTypes: ["family", "engagement", "wedding"],
    walkMinutes: 3,
    terrain: ["paved", "grass"],
    accessibility: ["wheelchair", "stroller", "restrooms"],
    costType: "free",
    hue: 262,
  },
  {
    name: "Fish Ladder Park",
    lng: -85.6771,
    lat: 42.976,
    description:
      "Concrete sculpture and rushing water. Loud, but the texture is worth it.",
    shootTypes: ["senior-portrait", "branding"],
    walkMinutes: 1,
    terrain: ["paved", "stairs"],
    accessibility: [],
    costType: "free",
    hue: 12,
  },
];

/** A deterministic placeholder image, so seeding needs no network. */
const svg = (label: string, hue: number, tone: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="hsl(${hue} 45% ${tone}%)"/>
    <stop offset="100%" stop-color="hsl(${(hue + 40) % 360} 35% ${Math.max(tone - 22, 12)}%)"/>
  </linearGradient></defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <text x="40" y="560" font-family="system-ui,sans-serif" font-size="34" fill="rgba(255,255,255,.92)">${label}</text>
</svg>`;

export async function seed(
  db: D1Database,
  bucket: {
    put(
      key: string,
      body: string,
      options: { httpMetadata: { contentType: string } },
    ): Promise<unknown>;
  },
): Promise<number> {
  const author = "photospots-seed";
  const now = Date.now();
  await db
    .prepare(
      'INSERT OR IGNORE INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?, ?, ?, 0, ?, ?)',
    )
    .bind(author, "Photospots community", "seed@photospots.invalid", now, now)
    .run();
  const { results: types } = await db
    .prepare("SELECT id,slug FROM shoot_types")
    .all<{ id: number; slug: string }>();
  let count = 0;
  for (const s of SPOTS) {
    const slug = slugCandidates(s.name, "Grand Rapids", "MI")[0];
    if (
      await db.prepare("SELECT id FROM spots WHERE slug=?").bind(slug).first()
    ) {
      // Refresh only our deterministic development images. This also repairs
      // older fixture markup without recreating spots, photos or counters.
      for (const kind of ["scouting", "session"] as const) {
        await bucket.put(
          "seed/" + slug + "-" + kind + ".svg",
          svg(s.name + " — " + kind, s.hue, kind === "session" ? 62 : 46),
          { httpMetadata: { contentType: "image/svg+xml" } },
        );
      }
      continue;
    }
    const id = crypto.randomUUID();
    const statements = [
      db
        .prepare(
          "INSERT INTO spots(id,kind,name,slug,description,lat,lng,created_by,locality,region,walk_minutes,terrain,accessibility,cost_type) VALUES (?,'outdoor',?,?,?,?,?,?,'Grand Rapids','MI',?,?,?,?)",
        )
        .bind(
          id,
          s.name,
          slug,
          s.description,
          s.lat,
          s.lng,
          author,
          s.walkMinutes,
          JSON.stringify(s.terrain),
          JSON.stringify(s.accessibility),
          s.costType,
        ),
    ];
    for (const type of s.shootTypes) {
      const found = types.find((t) => t.slug === type);
      if (!found) throw new Error("Missing shoot type: " + type);
      statements.push(
        db
          .prepare("INSERT INTO spot_shoot_types VALUES (?,?)")
          .bind(id, found.id),
      );
    }
    for (const kind of ["scouting", "session"] as const) {
      const key = "seed/" + slug + "-" + kind + ".svg";
      await bucket.put(
        key,
        svg(s.name + " — " + kind, s.hue, kind === "session" ? 62 : 46),
        { httpMetadata: { contentType: "image/svg+xml" } },
      );
      statements.push(
        db
          .prepare(
            "INSERT INTO photos(id,spot_id,profile_id,kind,storage_path,rights_attested,credit_name) VALUES (?,?,?,?,?,1,?)",
          )
          .bind(
            crypto.randomUUID(),
            id,
            author,
            kind,
            key,
            "Photospots development placeholder",
          ),
      );
    }
    await db.batch(statements);
    count++;
  }
  await backfillScores(db);
  return count;
}
if (isMain(import.meta.url)) {
  const local = await createLocalResources();
  try {
    console.log("Seeded " + (await seed(local.db, local.photos)) + " spots.");
  } finally {
    await local.close();
  }
}
