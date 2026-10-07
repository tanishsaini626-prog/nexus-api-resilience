import { setOptimizationMode, getOptimizationMode, generateIncidentId } from "../../lib/state";
import { getUserFromRequest } from "../../lib/auth";

export async function POST(request) {
  const { user, error } = await getUserFromRequest(request);
  if (!user) {
    return Response.json(
      { error: error || "Unauthorized", incidentId: generateIncidentId() },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { mode } = body;

    if (["OFF", "COST", "LATENCY"].includes(mode)) {
      await setOptimizationMode(user.id, mode);
    }

    return Response.json({
      success: true,
      optimizationMode: await getOptimizationMode(user.id),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ error: "Invalid request", incidentId: generateIncidentId() }, { status: 400 });
  }
}
