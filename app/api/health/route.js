import { updateHealthCheck, getApiState, getStatusCounts, getConfig, getCircuitBreakerSummary, setLastKnownHealth, getLastKnownHealth, checkFlapping, getOptimizationMode } from "../../lib/state";

const HEALTH_CHECK_TIMEOUT_MS = 5000;

async function checkProviderHealth(name, url) {
  let flapping = false;
  try {
    const start = Date.now();
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
    const latency = Date.now() - start;

    if (!getApiState()[name].simulatedDown && !getApiState()[name].simulatedDegraded) {
      const oldStatus = getApiState()[name].status;
      const flapResult = checkFlapping(name, oldStatus, "HEALTHY");
      flapping = flapResult.isFlapping;
      if (!flapResult.isFlapping) {
        updateHealthCheck(name, { latency, statusCode: res.status, wasError: false });
      }
    }
    return { status: getApiState()[name].status, latency, statusCode: res.status, flapping };
  } catch (e) {
    if (!getApiState()[name].simulatedDown && !getApiState()[name].simulatedDegraded) {
      const oldStatus = getApiState()[name].status;
      const flapResult = checkFlapping(name, oldStatus, "DOWN");
      flapping = flapResult.isFlapping;
      if (!flapResult.isFlapping) {
        updateHealthCheck(name, { latency: null, statusCode: null, wasError: true });
      }
    }
    return { status: getApiState()[name].status, latency: null, flapping };
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
    results.statusCounts = getStatusCounts();
    results.optimizationMode = getOptimizationMode();
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