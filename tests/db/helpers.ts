import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const rawUrl = process.env.SUPABASE_URL;
const rawAnonKey = process.env.SUPABASE_ANON_KEY;
const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!rawUrl || !rawAnonKey || !rawServiceKey) {
  throw new Error(
    "Database tests need SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. Run `npx supabase start` and populate .env.",
  );
}

// Re-bind as plain `string`. TypeScript's control-flow narrowing from the
// guard above isn't retained across a *function declaration* boundary (only
// across arrow-function closures defined in the same scope), so
// `createTestUser` below would otherwise see `string | undefined` again.
const url: string = rawUrl;
const anonKey: string = rawAnonKey;
const serviceKey: string = rawServiceKey;

/** Bypasses RLS. Use for setup and teardown only, never to assert access rules. */
export const serviceClient = (): SupabaseClient =>
  createClient(url, serviceKey, { auth: { persistSession: false } });

/** Logged-out visitor. */
export const anonClient = (): SupabaseClient =>
  createClient(url, anonKey, { auth: { persistSession: false } });

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

let counter = 0;

/** Creates a confirmed user and returns a client authenticated as them. */
export async function createTestUser(displayName = "Test User"): Promise<TestUser> {
  const admin = serviceClient();
  const email = `test-${Date.now()}-${counter++}@example.com`;
  const password = "test-password-12345";

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error) throw error;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { id: data.user.id, email, client };
}

export async function deleteTestUser(id: string): Promise<void> {
  await serviceClient().auth.admin.deleteUser(id);
}
