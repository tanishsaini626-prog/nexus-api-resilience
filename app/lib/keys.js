import { createClient } from "@supabase/supabase-js";

// Per-request Supabase client that carries the caller's own JWT, so Postgres
// RLS ("auth.uid() = user_id") enforces per-user key isolation. The shared
// anon client in supabase.js cannot read provider_keys at all.
// NOTE: client creation happens inside the function (per request), never at
// module load — a top-level createClient here would crash the build the same
// way supabase.js did before the Vercel env vars existed.
export function createUserSupabaseClient(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}

// Never send a full key back to the client — only an identifying tail.
export function maskKey(apiKey) {
  return "••••" + String(apiKey).slice(-4);
}

// Returns { openai: "...", gemini: "..." } for the caller's own rows (RLS
// scopes the query), {} when no keys are stored, or null if the DB lookup
// itself failed — the caller falls back to simulation so chat keeps working.
export async function getProviderKeys(token) {
  try {
    const supabase = createUserSupabaseClient(token);
    const { data, error } = await supabase
      .from("provider_keys")
      .select("provider, api_key");
    if (error) return null;
    const map = {};
    for (const row of data) map[row.provider] = row.api_key;
    return map;
  } catch {
    return null;
  }
}
