import { supabase } from "./supabase";

export async function getUserFromRequest(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    return { user: null, token: null, error: "No authorization token provided" };
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, token: null, error: error?.message || "Invalid token" };
  }
  // token is returned alongside user so routes can build a per-request
  // Supabase client whose Postgres queries run under the caller's own RLS.
  return { user: data.user, token, error: null };
}
