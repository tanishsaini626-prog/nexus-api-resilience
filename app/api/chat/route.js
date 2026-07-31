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

    if (openaiStatus === "UP") {
      routedTo = "openai";
      response = await callOpenAI(userMessage);
    } else if (anthropicStatus === "UP") {
      routedTo = "anthropic";
      response = await callAnthropic(userMessage);
    } else {
      return Response.json(
        { error: "All APIs are currently down", openaiStatus, anthropicStatus },
        { status: 503 }
      );
    }

    return Response.json({
      message: response,
      routedTo: routedTo,
      routedAt: new Date().toISOString(),
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