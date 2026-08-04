let apiState = {
  openai: {
    status: "HEALTHY",
    latency: 0,
    statusCode: null,
    simulatedDown: false,
    simulatedDegraded: false,
    lastStatusChange: null,
    circuitState: "CLOSED",
    consecutiveFailures: 0,
    circuitOpenedAt: null,
    totalCircuitOpens: 0,
  },
  anthropic: {
    status: "HEALTHY",
    latency: 0,
    statusCode: null,
    simulatedDown: false,
    simulatedDegraded: false,
    lastStatusChange: null,
    circuitState: "CLOSED",
    consecutiveFailures: 0,
    circuitOpenedAt: null,
    totalCircuitOpens: 0,
  },
};

export function getApiState() {
  return apiState;
}

export function getConfig() {
  return { degradedThreshold: 500 };
}

function determineStatus(latency, statusCode, wasError) {
  if (wasError) return "DOWN";
  if (statusCode >= 500) return "DEGRADED";
  if (latency > 500) return "DEGRADED";
  return "HEALTHY";
}

export function updateHealthCheck(apiName, result) {
  const api = apiState[apiName];
  if (api.simulatedDown || api.simulatedDegraded) return;

  const newStatus = determineStatus(result.latency, result.statusCode, result.wasError);
  if (newStatus !== api.status) {
    api.lastStatusChange = new Date().toISOString();
  }
  api.status = newStatus;
  api.latency = result.latency || 0;
  api.statusCode = result.statusCode;
}

export function simulateOutage(api) {
  const current = apiState[api];
  current.simulatedDown = true;
  current.simulatedDegraded = false;
  current.status = "DOWN";
  current.circuitState = "OPEN";
  current.circuitOpenedAt = Date.now();
  current.totalCircuitOpens++;
  current.lastStatusChange = new Date().toISOString();
}

export function simulateDegraded(api) {
  const current = apiState[api];
  current.simulatedDegraded = true;
  current.simulatedDown = false;
  current.status = "DEGRADED";
  current.lastStatusChange = new Date().toISOString();
}

export function restoreApi(api) {
  const current = apiState[api];
  current.simulatedDown = false;
  current.simulatedDegraded = false;
  current.status = "HEALTHY";
  current.circuitState = "CLOSED";
  current.consecutiveFailures = 0;
  current.circuitOpenedAt = null;
  current.lastStatusChange = new Date().toISOString();
}

export function getEffectiveStatus(api) {
  return apiState[api].status;
}

export function isRequestAllowed(apiName) {
  const api = apiState[apiName];
  if (api.circuitState === "CLOSED") return { allowed: true, reason: "CLOSED" };
  if (api.circuitState === "OPEN") return { allowed: false, reason: "OPEN" };
  if (api.circuitState === "HALF_OPEN") return { allowed: true, reason: "HALF_OPEN_TEST" };
  return { allowed: false, reason: "UNKNOWN" };
}

export function recordRequestResult(apiName, success) {
  const api = apiState[apiName];
  if (success) {
    api.consecutiveFailures = 0;
    if (api.circuitState === "HALF_OPEN") {
      api.circuitState = "CLOSED";
      api.lastStatusChange = new Date().toISOString();
      return { transitioned: true, from: "HALF_OPEN", to: "CLOSED" };
    }
  } else {
    api.consecutiveFailures = (api.consecutiveFailures || 0) + 1;
    if (api.circuitState === "CLOSED" && api.consecutiveFailures >= 3) {
      api.circuitState = "OPEN";
      api.circuitOpenedAt = Date.now();
      api.totalCircuitOpens++;
      api.lastStatusChange = new Date().toISOString();
      return { transitioned: true, from: "CLOSED", to: "OPEN" };
    }
    if (api.circuitState === "HALF_OPEN") {
      api.circuitState = "OPEN";
      api.circuitOpenedAt = Date.now();
      api.totalCircuitOpens++;
      api.lastStatusChange = new Date().toISOString();
      return { transitioned: true, from: "HALF_OPEN", to: "OPEN" };
    }
  }
  return { transitioned: false };
}

export function getStatusCounts() {
  let healthy = 0, degraded = 0, down = 0;
  for (const api of ["openai", "anthropic"]) {
    const s = apiState[api].status;
    if (s === "HEALTHY") healthy++;
    else if (s === "DEGRADED") degraded++;
    else if (s === "DOWN") down++;
  }
  return { healthy, degraded, down };
}

export function getCircuitBreakerSummary() {
  return {
    openai: {
      state: apiState.openai.circuitState,
      failures: apiState.openai.consecutiveFailures,
      threshold: 3,
      totalOpens: apiState.openai.totalCircuitOpens,
    },
    anthropic: {
      state: apiState.anthropic.circuitState,
      failures: apiState.anthropic.consecutiveFailures,
      threshold: 3,
      totalOpens: apiState.anthropic.totalCircuitOpens,
    },
    config: { failureThreshold: 3, cooldownDuration: 30000 },
  };
}