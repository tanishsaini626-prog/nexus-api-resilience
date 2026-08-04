import { getEffectiveStatus } from "../../lib/state";

export async function POST(request) {
  try {
    const body = await request.json();
    const userMessage = body.message;

    if (!userMessage) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    const openaiStatus = getEffectiveStatus("openai");
    const anthropicStatus = getEffectiveStatus("anthropic");

    let routedTo = null;
    let response = null;
    let usedDegraded = false; // Track if we used a degraded API

    // ============================================
    // ROUTING LOGIC (updated for three-state)
    // ============================================
    // HEALTHY → Use it (preferred)
    // DEGRADED → Use it (it's slow but not dead)
    // DOWN → Skip it, try fallback
    
    if (openaiStatus !== "DOWN") {
      routedTo = "openai";
      if (openaiStatus === "DEGRADED") usedDegraded = true;
      response = await callOpenAI(userMessage);
    } else if (anthropicStatus !== "DOWN") {
      routedTo = "anthropic";
      if (anthropicStatus === "DEGRADED") usedDegraded = true;
      response = await callAnthropic(userMessage);
    } else {
      return Response.json(
        {
          error: "All APIs are currently down",
          openaiStatus,
          anthropicStatus,
          suggestion: "Enable fallback chain or wait for recovery"
        },
        { status: 503 }
      );
    }

    return Response.json({
      message: response,
      routedTo: routedTo,
      routedAt: new Date().toISOString(),
      usedDegraded: usedDegraded, // New field
      apiStatus: routedTo === "openai" ? openaiStatus : anthropicStatus, // New field
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function callOpenAI(message) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return "[OpenAI GPT-4o] Received: \"" + message + "\". Simulated response.";
}

async function callAnthropic(message) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return "[Anthropic Claude] Received: \"" + message + "\". Simulated response.";
}