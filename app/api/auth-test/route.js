import { getUserFromRequest } from "../../lib/auth";

export async function GET(request) {
  const { user, error } = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ authenticated: false, error }, { status: 401 });
  }
  return Response.json({ authenticated: true, userId: user.id, email: user.email });
}
