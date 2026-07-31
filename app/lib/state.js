// This file stores the "effective" health status of our APIs.
// All API routes can read from and write to this.

// The actual health check updates this
// The simulate outage button can override this
// The chat endpoint reads this to decide where to route

let apiState = {
  openai: {
    status: "UP",
    latency: 0,
    simulatedDown: false, // When true, we pretend it's DOWN
  },
  anthropic: {
    status: "UP",
    latency: 0,
    simulatedDown: false,
  },
};

// Get current state
export function getApiState() {
  return apiState;
}

// Update from real health check
export function updateHealthCheck(results) {
  if (results.openai) {
    apiState.openai.status = results.openai.status;
    apiState.openai.latency = results.openai.latency || 0;
  }
  if (results.anthropic) {
    apiState.anthropic.status = results.anthropic.status;
    apiState.anthropic.latency = results.anthropic.latency || 0;
  }
}

// Simulate outage (for demo)
export function simulateOutage(api) {
  if (api === "openai") {
    apiState.openai.simulatedDown = true;
    apiState.openai.status = "DOWN";
  } else if (api === "anthropic") {
    apiState.anthropic.simulatedDown = true;
    apiState.anthropic.status = "DOWN";
  }
}

// Restore from outage (for demo)
export function restoreApi(api) {
  if (api === "openai") {
    apiState.openai.simulatedDown = false;
    apiState.openai.status = "UP";
  } else if (api === "anthropic") {
    apiState.anthropic.simulatedDown = false;
    apiState.anthropic.status = "UP";
  }
}

// Get the EFFECTIVE status (real or simulated)
export function getEffectiveStatus(api) {
  const state = apiState[api];
  return state.simulatedDown ? "DOWN" : state.status;
}