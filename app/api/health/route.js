import { updateHealthCheck, getApiState, getStatusCounts, getConfig, getCircuitBreakerSummary, setLastKnownHealth, getLastKnownHealth, checkFlapping } from "../../lib/state";

export async function GET() {
  try {
    const results = {};

    // Check OpenAI
    let openaiFlapping = false;
    try {
      const start = Date.now();
      const res = await fetch("https://api.openai.com/", { method: "GET", signal: AbortSignal.timeout(5000) });
      const latency = Date.now() - start;
      
      if (!getApiState().openai.simulatedDown && !getApiState().openai.simulatedDegraded) {
        const oldStatus = getApiState().openai.status;
        const flapping = checkFlapping("openai", oldStatus, "HEALTHY");
        openaiFlapping = flapping.isFlapping;
        if (!flapping.isFlapping) {
          updateHealthCheck("openai", { latency, statusCode: res.status, wasError: false });
        }
      }
      results.openai = { status: getApiState().openai.status, latency, statusCode: res.status, flapping: openaiFlapping };
    } catch (e) {
      if (!getApiState().openai.simulatedDown && !getApiState().openai.simulatedDegraded) {
        const oldStatus = getApiState().openai.status;
        const flapping = checkFlapping("openai", oldStatus, "DOWN");
        openaiFlapping = flapping.isFlapping;
        if (!flapping.isFlapping) {
          updateHealthCheck("openai", { latency: null, statusCode: null, wasError: true });
        }
      }
      results.openai = { status: getApiState().openai.status, latency: null, flapping: openaiFlapping };
    }

    // Check Anthropic
    let anthropicFlapping = false;
    try {
      const start = Date.now();
      const res = await fetch("https://api.anthropic.com/", { method: "GET", signal: AbortSignal.timeout(5000) });
      const latency = Date.now() - start;
      
      if (!getApiState().anthropic.simulatedDown && !getApiState().anthropic.simulatedDegraded) {
        const oldStatus = getApiState().anthropic.status;
        const flapping = checkFlapping("anthropic", oldStatus, "HEALTHY");
        anthropicFlapping = flapping.isFlapping;
        if (!flapping.isFlapping) {
          updateHealthCheck("anthropic", { latency, statusCode: res.status, wasError: false });
        }
      }
      results.anthropic = { status: getApiState().anthropic.status, latency, statusCode: res.status, flapping: anthropicFlapping };
    } catch (e) {
      if (!getApiState().anthropic.simulatedDown && !getApiState().anthropic.simulatedDegraded) {
        const oldStatus = getApiState().anthropic.status;
        const flapping = checkFlapping("anthropic", oldStatus, "DOWN");
        anthropicFlapping = flapping.isFlapping;
        if (!flapping.isFlapping) {
          updateHealthCheck("anthropic", { latency: null, statusCode: null, wasError: true });
        }
      }
      results.anthropic = { status: getApiState().anthropic.status, latency: null, flapping: anthropicFlapping };
    }

    // Check Gemini
    let geminiFlapping = false;
    try {
      const start = Date.now();
      const res = await fetch("https://generativelanguage.googleapis.com/", { method: "GET", signal: AbortSignal.timeout(5000) });
      const latency = Date.now() - start;
      
      if (!getApiState().gemini.simulatedDown && !getApiState().gemini.simulatedDegraded) {
        const oldStatus = getApiState().gemini.status;
        const flapping = checkFlapping("gemini", oldStatus, "HEALTHY");
        geminiFlapping = flapping.isFlapping;
        if (!flapping.isFlapping) {
          updateHealthCheck("gemini", { latency, statusCode: res.status, wasError: false });
        }
      }
      results.gemini = { status: getApiState().gemini.status, latency, statusCode: res.status, flapping: geminiFlapping };
    } catch (e) {
      if (!getApiState().gemini.simulatedDown && !getApiState().gemini.simulatedDegraded) {
        const oldStatus = getApiState().gemini.status;
        const flapping = checkFlapping("gemini", oldStatus, "DOWN");
        geminiFlapping = flapping.isFlapping;
        if (!flapping.isFlapping) {
          updateHealthCheck("gemini", { latency: null, statusCode: null, wasError: true });
        }
      }
      results.gemini = { status: getApiState().gemini.status, latency: null, flapping: geminiFlapping };
    }

    results.checkedAt = new Date().toISOString();
    results.statusCounts = getStatusCounts();
    results.config = { degradedThreshold: getConfig().degradedThreshold + "ms" };
    results.circuitBreaker = getCircuitBreakerSummary();

    // Save for crash recovery
    setLastKnownHealth(results);

    return Response.json(results);

  } catch (error) {
    // If EVERYTHING crashes, return last known good state
    const lastKnown = getLastKnownHealth();
    if (lastKnown) {
      return Response.json({
        ...lastKnown,
        degraded: true,
        note: "Health check failed, showing last known state",
        error: error.message,
        checkedAt: new Date().toISOString(),
      });
    }
    return Response.json({
      error: "Health check failed",
      message: error.message,
      incidentId: "INC-" + Date.now().toString(36).slice(-6),
      checkedAt: new Date().toISOString(),
    });
  }
}