import { setOptimizationMode, getOptimizationMode, checkRateLimit, generateIncidentId } from "../../lib/state";

export async function POST(request) {
  const adminSecret = request.headers.get("x-admin-secret");
  if (!adminSecret || adminSecret !== process.env.ADMIN_ACTION_SECRET) {
    return Response.json(
      { error: "Unauthorized", incidentId: generateIncidentId() },
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
      setOptimizationMode(mode);
    }

    return Response.json({
      success: true,
      optimizationMode: getOptimizationMode(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ error: "Invalid request", incidentId: generateIncidentId() }, { status: 400 });
  }
}
