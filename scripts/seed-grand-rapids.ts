import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SPOT_PHOTO_BUCKET } from "../app/lib/photo-url";

/**
 * Development seed. Real Grand Rapids locations with plausible metadata, so the
 * explore view has something in it before submission exists (plan 3).
 *
 * Photos are generated SVGs rather than downloads: the script must work offline
 * and must not embed anyone's copyrighted work in the repo.
 */
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
    lng: -85.7267, lat: 42.9214,
    description: "Wide open meadow with long sightlines. Best an hour before sunset.",
    shootTypes: ["family", "engagement"],
    walkMinutes: 12, terrain: ["gravel", "grass"],
    accessibility: ["restrooms", "stroller"], costType: "free", hue: 96,
  },
  {
    name: "Blue Bridge",
    lng: -85.6784, lat: 42.9636,
    description: "Steel pedestrian bridge over the Grand. Downtown skyline behind.",
    shootTypes: ["engagement", "senior-portrait"],
    walkMinutes: 2, terrain: ["paved"],
    accessibility: ["wheelchair", "stroller"], costType: "free", hue: 205,
  },
  {
    name: "John Ball Park Overlook",
    lng: -85.7011, lat: 42.9631,
    description: "Hilltop view over the west side. Steep path — not for grandparents.",
    shootTypes: ["senior-portrait"],
    walkMinutes: 15, terrain: ["steep", "grass"],
    accessibility: [], costType: "free", hue: 28,
  },
  {
    name: "Riverside Park Birches",
    lng: -85.6553, lat: 43.0123,
    description: "Stand of birches along the river path. Dappled light all afternoon.",
    shootTypes: ["family", "maternity"],
    walkMinutes: 6, terrain: ["paved", "grass"],
    accessibility: ["restrooms", "stroller", "shade"], costType: "free", hue: 140,
  },
  {
    name: "Ah-Nab-Awen Park",
    lng: -85.6742, lat: 42.9689,
    description: "Grass terraces by the river with the museum behind.",
    shootTypes: ["family", "engagement", "wedding"],
    walkMinutes: 3, terrain: ["paved", "grass"],
    accessibility: ["wheelchair", "stroller", "restrooms"], costType: "free", hue: 262,
  },
  {
    name: "Fish Ladder Park",
    lng: -85.6771, lat: 42.9760,
    description: "Concrete sculpture and rushing water. Loud, but the texture is worth it.",
    shootTypes: ["senior-portrait", "branding"],
    walkMinutes: 1, terrain: ["paved", "stairs"],
    accessibility: [], costType: "free", hue: 12,
  },
];

/** A deterministic placeholder image, so seeding needs no network. */
const svg = (label: string, hue: number, tone: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="hsl(${hue} 45% ${tone}%)"/>
    <stop offset="100%" stop-color="hsl(${(hue + 40) % 360} 35% ${Math.max(tone - 22, 12)}%)"/>
  </gradient></defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <text x="40" y="560" font-family="system-ui,sans-serif" font-size="34" fill="rgba(255,255,255,.92)">${label}</text>
</svg>`;

async function uploadPhoto(
  supabase: SupabaseClient,
  path: string,
  label: string,
  hue: number,
  tone: number,
): Promise<void> {
  const { error } = await supabase.storage
    .from(SPOT_PHOTO_BUCKET)
    .upload(path, new Blob([svg(label, hue, tone)], { type: "image/svg+xml" }), {
      contentType: "image/svg+xml",
      upsert: true,
    });
  if (error) throw error;
}

export async function seed(supabase: SupabaseClient): Promise<number> {
  const email = "seed@photospots.local";

  // Reuse the seed author across runs so re-seeding does not pile up users.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("display_name", "Photospots Seed")
    .maybeSingle();

  let authorId = existing?.id as string | undefined;
  if (!authorId) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { display_name: "Photospots Seed" },
    });
    if (error) throw error;
    authorId = data.user!.id;
  }

  const { data: types, error: typeError } = await supabase.from("shoot_types").select("id, slug");
  if (typeError) throw typeError;
  const typeId = new Map((types ?? []).map((t) => [t.slug as string, t.id as number]));

  let created = 0;
  for (const s of SPOTS) {
    const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const { data: already } = await supabase
      .from("spots")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (already) continue;

    const { data: spot, error } = await supabase
      .from("spots")
      .insert({
        kind: "outdoor",
        name: s.name,
        slug,
        description: s.description,
        location: `POINT(${s.lng} ${s.lat})`,
        created_by: authorId,
        locality: "Grand Rapids",
        region: "MI",
        walk_minutes: s.walkMinutes,
        terrain: s.terrain,
        accessibility: s.accessibility,
        cost_type: s.costType,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { error: linkError } = await supabase.from("spot_shoot_types").insert(
      s.shootTypes
        .filter((t) => typeId.has(t))
        .map((t) => ({ spot_id: spot!.id, shoot_type_id: typeId.get(t)! })),
    );
    if (linkError) throw linkError;

    const scoutPath = `${spot!.id}/scouting.svg`;
    const sessionPath = `${spot!.id}/session.svg`;
    await uploadPhoto(supabase, scoutPath, `${s.name} — scouting`, s.hue, 46);
    await uploadPhoto(supabase, sessionPath, `${s.name} — session`, s.hue, 62);

    // Errors are returned, not thrown, by supabase-js. Without this check a
    // failed insert leaves spots with no photos and the seed still reports
    // success — which is exactly what happened the first time this ran.
    // Every object must carry the SAME keys. On a bulk insert PostgREST takes
    // the union of keys across the array and explicitly sets missing ones to
    // null, which bypasses column defaults — so omitting rights_attested on the
    // scouting row sends null and trips its NOT NULL constraint.
    const { error: photoError } = await supabase.from("photos").insert([
      {
        spot_id: spot!.id,
        profile_id: authorId,
        kind: "scouting",
        storage_path: scoutPath,
        rights_attested: false,
        credit_name: null,
      },
      {
        spot_id: spot!.id,
        profile_id: authorId,
        kind: "session",
        storage_path: sessionPath,
        rights_attested: true,
        credit_name: "Photospots Seed",
      },
    ]);
    if (photoError) throw photoError;

    created += 1;
  }

  return created;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const created = await seed(supabase);
  console.log(`Seeded ${created} spots.`);
}

if (process.argv[1]?.endsWith("seed-grand-rapids.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
