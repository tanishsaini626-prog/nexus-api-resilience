import { simulateOutage, simulateDegraded, restoreApi, getApiState } from "../../lib/state";

export async function POST(request) {
  try {
    const body = await request.json();
    const { api, action } = body;

    if (!api || !action) {
      return Response.json({ error: "api and action are required" }, { status: 400 });
    }

    if (!["openai", "anthropic", "gemini"].includes(api)) {
      return Response.json(
        { error: "api must be 'openai', 'anthropic', or 'gemini'" },
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
        { error: "action must be 'down', 'degraded', or 'up'" },
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
    return Response.json({ error: error.message }, { status: 500 });
  }
}