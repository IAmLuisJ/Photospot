import type { DataContext } from "./context";

export interface Profile {
  id: string;
  displayName: string;
  role: "user" | "admin";
  avatarUrl: string | null;
  bio: string | null;
  websiteUrl: string | null;
  instagram: string | null;
}

const COLUMNS =
  "id, display_name, role, avatar_url, bio, website_url, instagram";

interface ProfileRow {
  id: string;
  display_name: string;
  role: "user" | "admin";
  avatar_url: string | null;
  bio: string | null;
  website_url: string | null;
  instagram: string | null;
}

/** Database shape stops here — routes only ever see Profile. */
const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  displayName: row.display_name,
  role: row.role,
  avatarUrl: row.avatar_url,
  bio: row.bio,
  websiteUrl: row.website_url,
  instagram: row.instagram,
});

export async function getProfile(
  context: DataContext,
  id: string,
): Promise<Profile | null> {
  const row = await context.db
    .prepare(`SELECT ${COLUMNS} FROM profiles WHERE id=?`)
    .bind(id)
    .first<ProfileRow>();
  return row ? toProfile(row) : null;
}

export async function getCurrentProfile(
  context: DataContext,
): Promise<Profile | null> {
  return context.viewer ? getProfile(context, context.viewer.id) : null;
}
