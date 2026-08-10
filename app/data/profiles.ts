import type { SupabaseClient } from "@supabase/supabase-js";

export interface Profile {
  id: string;
  displayName: string;
  role: "user" | "admin";
  avatarUrl: string | null;
  bio: string | null;
  websiteUrl: string | null;
  instagram: string | null;
}

const COLUMNS = "id, display_name, role, avatar_url, bio, website_url, instagram";

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
  supabase: SupabaseClient,
  id: string,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? toProfile(data as ProfileRow) : null;
}

export async function getCurrentProfile(
  supabase: SupabaseClient,
): Promise<Profile | null> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return getProfile(supabase, data.user.id);
}
