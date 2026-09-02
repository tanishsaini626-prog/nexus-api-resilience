import { updateHealthCheck, getApiState, getStatusCounts, getConfig, getCircuitBreakerSummary, setLastKnownHealth, getLastKnownHealth, checkFlapping, getOptimizationMode, generateIncidentId } from "../../lib/state";

const HEALTH_CHECK_TIMEOUT_MS = 5000;

async function checkProviderHealth(name, url) {
  let flapping = false;
  const state = await getApiState();
  try {
    const start = Date.now();
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
    const latency = Date.now() - start;

    if (!state[name].simulatedDown && !state[name].simulatedDegraded) {
      const oldStatus = state[name].status;
      const flapResult = checkFlapping(name, oldStatus, "HEALTHY");
      flapping = flapResult.isFlapping;
      if (!flapResult.isFlapping) {
        await updateHealthCheck(name, { latency, statusCode: res.status, wasError: false });
      }
    }
    const finalState = await getApiState();
    return { status: finalState[name].status, latency, statusCode: res.status, flapping };
  } catch (e) {
    if (!state[name].simulatedDown && !state[name].simulatedDegraded) {
      const oldStatus = state[name].status;
      const flapResult = checkFlapping(name, oldStatus, "DOWN");
      flapping = flapResult.isFlapping;
      if (!flapResult.isFlapping) {
        await updateHealthCheck(name, { latency: null, statusCode: null, wasError: true });
      }
    }
    const finalState = await getApiState();
    return { status: finalState[name].status, latency: null, flapping };
  }
}

export async function GET() {
  try {
    const [openaiResult, anthropicResult, geminiResult] = await Promise.all([
      checkProviderHealth("openai", "https://api.openai.com/"),
      checkProviderHealth("anthropic", "https://api.anthropic.com/"),
      checkProviderHealth("gemini", "https://generativelanguage.googleapis.com/"),
    ]);

    const results = {
      openai: openaiResult,
      anthropic: anthropicResult,
      gemini: geminiResult,
    };

    results.checkedAt = new Date().toISOString();
    results.statusCounts = await getStatusCounts();
    results.optimizationMode = getOptimizationMode();
    results.config = { degradedThreshold: getConfig().degradedThreshold + "ms" };
    results.circuitBreaker = await getCircuitBreakerSummary();

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
        incidentId: generateIncidentId(),
        checkedAt: new Date().toISOString(),
      });
    }
    return Response.json({
      error: "Health check failed",
      message: error.message,
      incidentId: generateIncidentId(),
      checkedAt: new Date().toISOString(),
    });
  }
}