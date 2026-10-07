import { simulateOutage, simulateDegraded, restoreApi, getApiState, generateIncidentId } from "../../lib/state";
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
    const { api, action } = body;

    if (!api || !action) {
      return Response.json({ error: "api and action are required", incidentId: generateIncidentId() }, { status: 400 });
    }

    if (!["openai", "anthropic", "gemini"].includes(api)) {
      return Response.json(
        { error: "api must be 'openai', 'anthropic', or 'gemini'", incidentId: generateIncidentId() },
        { status: 400 }
      );
    }

    // Handle three actions: down, degraded, up
    if (action === "down") {
      await simulateOutage(user.id, api);
    } else if (action === "degraded") {
      await simulateDegraded(user.id, api);
    } else if (action === "up") {
      await restoreApi(user.id, api);
    } else {
      return Response.json(
        { error: "action must be 'down', 'degraded', or 'up'", incidentId: generateIncidentId() },
        { status: 400 }
      );
    }

    const state = await getApiState(user.id);

    return Response.json({
      success: true,
      message: {
        down: api + " marked as DOWN",
        degraded: api + " marked as DEGRADED",
        up: api + " restored to HEALTHY",
      }[action],
      state: {
        openai: state.openai.status,
        anthropic: state.anthropic.status,
        gemini: state.gemini.status,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    return Response.json({ error: error.message, incidentId: generateIncidentId() }, { status: 500 });
  }
}
