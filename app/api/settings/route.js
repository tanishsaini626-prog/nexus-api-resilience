import { setOptimizationMode, getOptimizationMode, checkRateLimit, generateIncidentId } from "../../lib/state";
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
    const rateCheck = checkRateLimit();
    if (!rateCheck.allowed) {
      return Response.json({
        error: "Rate limit exceeded",
        incidentId: generateIncidentId(),
        retryAfter: Math.ceil(rateCheck.resetIn / 1000),
      }, { status: 429 });
    }

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
