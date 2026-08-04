// ============================================
// NEXUS STATE MANAGEMENT
// ============================================
// 
// Three health states:
//   HEALTHY  → Latency < threshold, no errors
//   DEGRADED → Latency > threshold OR intermittent errors
//   DOWN     → No response at all
//
// Threshold is configurable (default: 500ms)
// ============================================

let apiState = {
  openai: {
    status: "HEALTHY",        // HEALTHY | DEGRADED | DOWN
    latency: 0,               // Last measured latency
    statusCode: null,          // Last HTTP status code
    simulatedDown: false,      // For demo: pretend it's down
    simulatedDegraded: false,  // For demo: pretend it's degraded
    consecutiveFailures: 0,    // For circuit breaker (Day 8)
    lastFailureTime: null,     // For circuit breaker (Day 8)
    lastStatusChange: null,    // When did status last change?
  },
  anthropic: {
    status: "HEALTHY",
    latency: 0,
    statusCode: null,
    simulatedDown: false,
    simulatedDegraded: false,
    consecutiveFailures: 0,
    lastFailureTime: null,
    lastStatusChange: null,
  },
};

// Configuration (will move to config file in Day 12)
const config = {
  degradedThreshold: 500,  // ms — above this = DEGRADED
  healthyThreshold: 200,   // ms — below this = definitely HEALTHY
};

// Get current state
export function getApiState() {
  return apiState;
}

// Get config
export function getConfig() {
  return config;
}

// Update config
export function updateConfig(newConfig) {
  Object.assign(config, newConfig);
}

// Determine health status from a single check
function determineStatus(latency, statusCode, wasError) {
  // If there was an error (no response)
  if (wasError) return "DOWN";
  
  // If we got a response but it was an error status code
  if (statusCode >= 500) return "DEGRADED"; // Server error = degraded
  
  // If latency is very high
  if (latency > config.degradedThreshold) return "DEGRADED";
  
  // If latency is normal
  if (latency <= config.degradedThreshold) return "HEALTHY";
  
  return "HEALTHY";
}

// Update from real health check
export function updateHealthCheck(api, result) {
  const apiName = api; // "openai" or "anthropic"
  const current = apiState[apiName];
  
  // Don't update if simulated
  if (current.simulatedDown) return;
  if (current.simulatedDegraded) return;
  
  // Determine new status
  const newStatus = determineStatus(
    result.latency,
    result.statusCode,
    result.wasError
  );
  
  // Track status changes
  if (newStatus !== current.status) {
    current.lastStatusChange = new Date().toISOString();
  }
  
  // Update state
  current.status = newStatus;
  current.latency = result.latency || 0;
  current.statusCode = result.statusCode;
  
  // Track failures for circuit breaker (Day 8)
  if (newStatus === "DOWN" || newStatus === "DEGRADED") {
    current.consecutiveFailures += 1;
    current.lastFailureTime = new Date().toISOString();
  } else {
    current.consecutiveFailures = 0;
  }
}

// Simulate outage (for demo)
export function simulateOutage(api) {
  const current = apiState[api];
  current.simulatedDown = true;
  current.simulatedDegraded = false;
  current.status = "DOWN";
  current.lastStatusChange = new Date().toISOString();
}

// Simulate degraded (for demo) — NEW
export function simulateDegraded(api) {
  const current = apiState[api];
  current.simulatedDegraded = true;
  current.simulatedDown = false;
  current.status = "DEGRADED";
  current.lastStatusChange = new Date().toISOString();
}

// Restore API (for demo)
export function restoreApi(api) {
  const current = apiState[api];
  current.simulatedDown = false;
  current.simulatedDegraded = false;
  current.status = "HEALTHY";
  current.lastStatusChange = new Date().toISOString();
}

// Get the EFFECTIVE status (respects simulation)
export function getEffectiveStatus(api) {
  return apiState[api].status;
}

// Get all status counts
export function getStatusCounts() {
  let healthy = 0, degraded = 0, down = 0;
  
  for (const api of ["openai", "anthropic"]) {
    const status = apiState[api].status;
    if (status === "HEALTHY") healthy++;
    else if (status === "DEGRADED") degraded++;
    else if (status === "DOWN") down++;
  }
  
  return { healthy, degraded, down };
}