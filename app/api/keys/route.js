import { getUserFromRequest } from "../../lib/auth";
import { createUserSupabaseClient, maskKey } from "../../lib/keys";

const VALID_PROVIDERS = ["openai", "anthropic", "gemini"];

export async function GET(request) {
  const { user, token, error } = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: error || "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createUserSupabaseClient(token);
    const { data, error: dbError } = await supabase
      .from("provider_keys")
      .select("provider, api_key");

    if (dbError) {
      return Response.json({ error: dbError.message }, { status: 500 });
    }

    return Response.json({
      keys: data.map((row) => ({
        provider: row.provider,
        maskedKey: maskKey(row.api_key),
      })),
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request) {
  const { user, token, error } = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: error || "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { provider, apiKey } = body;

    if (!VALID_PROVIDERS.includes(provider)) {
      return Response.json({ error: "Invalid provider" }, { status: 400 });
    }
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return Response.json({ error: "apiKey is required" }, { status: 400 });
    }
    if (apiKey.length > 1000) {
      return Response.json({ error: "apiKey too long" }, { status: 400 });
    }

    const supabase = createUserSupabaseClient(token);
    const { error: dbError } = await supabase.from("provider_keys").upsert({
      user_id: user.id,
      provider,
      api_key: apiKey,
      updated_at: new Date().toISOString(),
    });

    if (dbError) {
      return Response.json({ error: dbError.message }, { status: 500 });
    }

    return Response.json({
      success: true,
      provider,
      maskedKey: maskKey(apiKey),
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { user, token, error } = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: error || "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { provider } = body;

    if (!VALID_PROVIDERS.includes(provider)) {
      return Response.json({ error: "Invalid provider" }, { status: 400 });
    }

    const supabase = createUserSupabaseClient(token);
    // RLS scopes this delete to the caller's own row — no user filter needed.
    const { error: dbError } = await supabase
      .from("provider_keys")
      .delete()
      .eq("provider", provider);

    if (dbError) {
      return Response.json({ error: dbError.message }, { status: 500 });
    }

    return Response.json({ success: true, provider });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
