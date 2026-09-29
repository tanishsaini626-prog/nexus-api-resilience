import { supabase } from "../../lib/supabase";

export async function GET() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return Response.json({ connected: true, session: data.session });
  } catch (error) {
    return Response.json({ connected: false, error: error.message }, { status: 500 });
  }
}
