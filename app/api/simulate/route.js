import { simulateOutage, simulateDegraded, restoreApi, getApiState, checkRateLimit, generateIncidentId } from "../../lib/state";

export async function POST(request) {
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
      simulateOutage(api);
    } else if (action === "degraded") {
      simulateDegraded(api);
    } else if (action === "up") {
      restoreApi(api);
    } else {
      return Response.json(
        { error: "action must be 'down', 'degraded', or 'up'", incidentId: generateIncidentId() },
        { status: 400 }
      );
    }

    const state = getApiState();

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