import { updateHealthCheck, getApiState, getStatusCounts, getConfig, getCircuitBreakerSummary } from "../../lib/state";

export async function GET() {
  try {
    const results = {};

    // Check OpenAI
    try {
      const start = Date.now();
      const res = await fetch("https://api.openai.com/", { method: "GET", signal: AbortSignal.timeout(5000) });
      const latency = Date.now() - start;
      if (!getApiState().openai.simulatedDown && !getApiState().openai.simulatedDegraded) {
        updateHealthCheck("openai", { latency, statusCode: res.status, wasError: false });
      }
      results.openai = { status: getApiState().openai.status, latency, statusCode: res.status };
    } catch (e) {
      if (!getApiState().openai.simulatedDown && !getApiState().openai.simulatedDegraded) {
        updateHealthCheck("openai", { latency: null, statusCode: null, wasError: true });
      }
      results.openai = { status: getApiState().openai.status, latency: null };
    }

    // Check Anthropic
    try {
      const start = Date.now();
      const res = await fetch("https://api.anthropic.com/", { method: "GET", signal: AbortSignal.timeout(5000) });
      const latency = Date.now() - start;
      if (!getApiState().anthropic.simulatedDown && !getApiState().anthropic.simulatedDegraded) {
        updateHealthCheck("anthropic", { latency, statusCode: res.status, wasError: false });
      }
      results.anthropic = { status: getApiState().anthropic.status, latency, statusCode: res.status };
    } catch (e) {
      if (!getApiState().anthropic.simulatedDown && !getApiState().anthropic.simulatedDegraded) {
        updateHealthCheck("anthropic", { latency: null, statusCode: null, wasError: true });
      }
      results.anthropic = { status: getApiState().anthropic.status, latency: null };
    }

    results.checkedAt = new Date().toISOString();
    results.statusCounts = getStatusCounts();
    results.config = { degradedThreshold: getConfig().degradedThreshold + "ms" };
    results.circuitBreaker = getCircuitBreakerSummary();

    return Response.json(results);
  } catch (error) {
    return Response.json({ error: error.message, checkedAt: new Date().toISOString() });
  }
}