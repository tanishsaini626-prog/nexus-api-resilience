import { simulateOutage, restoreApi, getApiState } from "../../lib/state";

export async function POST(request) {
  try {
    const body = await request.json();
    const { api, action } = body;

    if (!api || !action) {
      return Response.json({ error: "api and action are required" }, { status: 400 });
    }

    if (action === "down") {
      simulateOutage(api);
    } else if (action === "up") {
      restoreApi(api);
    } else {
      return Response.json({ error: "action must be down or up" }, { status: 400 });
    }

    const state = getApiState();

    return Response.json({
      success: true,
      message: action === "down" ? api + " marked as DOWN" : api + " restored to UP",
      state: { openai: state.openai.status, anthropic: state.anthropic.status },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}