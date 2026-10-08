import { applyHealthCheck, getApiState, saveApiState, computeStatusCounts, getConfig, computeCircuitBreakerSummary, setLastKnownHealth, getLastKnownHealth, checkFlapping, getOptimizationMode, generateIncidentId } from "../../lib/state";
import { getUserFromRequest } from "../../lib/auth";

const HEALTH_CHECK_TIMEOUT_MS = 5000;

const PROVIDERS = [
  { name: "openai", url: "https://api.openai.com/" },
  { name: "anthropic", url: "https://api.anthropic.com/" },
  { name: "gemini", url: "https://generativelanguage.googleapis.com/" },
];

// Probe one provider and fold the result into the SHARED in-memory state object.
// Each call only touches its own slice (state[name]), so running all three in
// Promise.all can't clobber — and nothing here hits Redis, so the whole poll
// reads state once and writes once (see GET below).
async function probeProvider(state, name, url) {
  let flapping = false;
  const api = state[name];
  try {
    const start = Date.now();
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
    const latency = Date.now() - start;

    if (!api.simulatedDown && !api.simulatedDegraded) {
      const flapResult = checkFlapping(name, api.status, "HEALTHY");
      flapping = flapResult.isFlapping;
      if (!flapResult.isFlapping) {
        applyHealthCheck(state, name, { latency, statusCode: res.status, wasError: false });
      }
    }
    return { status: state[name].status, latency, statusCode: res.status, flapping };
  } catch {
    if (!api.simulatedDown && !api.simulatedDegraded) {
      const flapResult = checkFlapping(name, api.status, "DOWN");
      flapping = flapResult.isFlapping;
      if (!flapResult.isFlapping) {
        applyHealthCheck(state, name, { latency: null, statusCode: null, wasError: true });
      }
    }
    return { status: state[name].status, latency: null, flapping };
  }
}

export async function GET(request) {
  const { user, error } = await getUserFromRequest(request);
  if (!user) {
    return Response.json(
      { error: error || "Unauthorized", incidentId: generateIncidentId() },
      { status: 401 }
    );
  }

  try {
    // Read the per-user state ONCE up front...
    const state = await getApiState(user.id);

    // ...probe all three providers against that single object concurrently...
    const [openaiResult, anthropicResult, geminiResult] = await Promise.all(
      PROVIDERS.map((p) => probeProvider(state, p.name, p.url))
    );

    // ...then write the mutated state back ONCE. Previously each provider did
    // its own get + update + get, and each summary re-read: ~15 Redis ops per
    // poll. Now it's 2 reads (state + routing mode) + 1 write.
    await saveApiState(user.id, state);

    const results = {
      openai: openaiResult,
      anthropic: anthropicResult,
      gemini: geminiResult,
    };

    results.checkedAt = new Date().toISOString();
    results.statusCounts = computeStatusCounts(state);
    results.optimizationMode = await getOptimizationMode(user.id);
    results.config = { degradedThreshold: getConfig().degradedThreshold + "ms" };
    results.circuitBreaker = computeCircuitBreakerSummary(state);

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
