import { getEffectiveStatus, isRequestAllowed, recordRequestResult, getApiState } from "../../lib/state";

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.message) return Response.json({ error: "Message required" }, { status: 400 });

    let routedTo = null;
    let response = null;
    let circuitReason = null;

    // Try OpenAI
    const os = getEffectiveStatus("openai");
    const oc = isRequestAllowed("openai");
    if (os !== "DOWN" && oc.allowed) {
      routedTo = "openai";
      try {
        response = await callOpenAI(body.message);
        recordRequestResult("openai", true);
      } catch (e) {
        const r = recordRequestResult("openai", false);
        if (r.transitioned) circuitReason = "Circuit " + r.from + " → " + r.to;
        routedTo = null;
      }
    } else if (!oc.allowed) {
      circuitReason = "OpenAI circuit " + oc.reason;
    }

    // Try Anthropic
    if (!routedTo) {
      const as = getEffectiveStatus("anthropic");
      const ac = isRequestAllowed("anthropic");
      if (as !== "DOWN" && ac.allowed) {
        routedTo = "anthropic";
        if (!circuitReason) circuitReason = "OpenAI blocked, using Anthropic";
        try {
          response = await callAnthropic(body.message);
          recordRequestResult("anthropic", true);
        } catch (e) {
          recordRequestResult("anthropic", false);
          routedTo = null;
        }
      }
    }

    if (!routedTo) {
      return Response.json({ error: "All APIs down", circuitReason }, { status: 503 });
    }

    return Response.json({
      message: response,
      routedTo,
      routedAt: new Date().toISOString(),
      circuitReason,
      apiStatus: getEffectiveStatus(routedTo),
      circuitState: getApiState()[routedTo].circuitState,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function callOpenAI(msg) {
  if (getApiState().openai.status === "DOWN") throw new Error("Down");
  await new Promise((r) => setTimeout(r, 200));
  return "[OpenAI GPT-4o] Received: \"" + msg + "\"";
}

async function callAnthropic(msg) {
  if (getApiState().anthropic.status === "DOWN") throw new Error("Down");
  await new Promise((r) => setTimeout(r, 300));
  return "[Anthropic Claude] Received: \"" + msg + "\"";
}