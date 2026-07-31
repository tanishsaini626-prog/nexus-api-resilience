import { updateHealthCheck, getApiState } from "../../lib/state";

export async function GET() {
  const results = {};
  const state = getApiState();

  // Check OpenAI (but don't update if simulated down)
  try {
    const openaiStart = Date.now();
    const response = await fetch("https://api.openai.com/", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    
    // Only update real status if NOT simulated down
    if (!state.openai.simulatedDown) {
      results.openai = {
        status: "UP",
        latency: Date.now() - openaiStart,
        statusCode: response.status,
      };
    } else {
      results.openai = {
        status: "DOWN",
        latency: null,
        statusCode: null,
        note: "Simulated outage active",
      };
    }
  } catch (error) {
    results.openai = {
      status: "DOWN",
      latency: null,
      error: error.message,
    };
  }

  // Check Anthropic (but don't update if simulated down)
  try {
    const anthropicStart = Date.now();
    const response = await fetch("https://api.anthropic.com/", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    
    if (!state.anthropic.simulatedDown) {
      results.anthropic = {
        status: "UP",
        latency: Date.now() - anthropicStart,
        statusCode: response.status,
      };
    } else {
      results.anthropic = {
        status: "DOWN",
        latency: null,
        statusCode: null,
        note: "Simulated outage active",
      };
    }
  } catch (error) {
    results.anthropic = {
      status: "DOWN",
      latency: null,
      error: error.message,
    };
  }

  results.checkedAt = new Date().toISOString();

  return Response.json(results);
}