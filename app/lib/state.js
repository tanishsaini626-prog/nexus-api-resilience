import { redis } from "./redis";

const API_STATE_KEY = "nexus:apiState";

// NOTE: This read-modify-write pattern has a small race condition
// window between the Redis get() and set() calls if two requests
// hit this at the exact same moment. Acceptable for this project's
// scale; a production system at higher concurrency would use Redis
// transactions (WATCH/MULTI) or a Lua script to make this atomic.

const DEGRADED_LATENCY_THRESHOLD_MS = 500;

let optimizationMode = "OFF"; // "OFF" | "COST" | "LATENCY"

const DEFAULT_API_STATE = {
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
  gemini: {
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

export async function getApiState() {
  const state = await redis.get(API_STATE_KEY);
  return state || structuredClone(DEFAULT_API_STATE);
}

export function getOptimizationMode() {
  return optimizationMode;
}

export function setOptimizationMode(mode) {
  if (["OFF", "COST", "LATENCY"].includes(mode)) {
    optimizationMode = mode;
  }
}

// Relative token costs
export const API_COSTS = {
  gemini: 1, // Cheapest
  anthropic: 3,
  openai: 5, // Most expensive
};

export function getConfig() {
  return { degradedThreshold: DEGRADED_LATENCY_THRESHOLD_MS };
}

function determineStatus(latency, statusCode, wasError) {
  if (wasError) return "DOWN";
  if (statusCode >= 500) return "DEGRADED";
  if (latency > DEGRADED_LATENCY_THRESHOLD_MS) return "DEGRADED";
  return "HEALTHY";
}

export async function updateHealthCheck(apiName, result) {
  const state = await getApiState();
  const api = state[apiName];
  if (api.simulatedDown || api.simulatedDegraded) return;

  const newStatus = determineStatus(result.latency, result.statusCode, result.wasError);
  if (newStatus !== api.status) {
    api.lastStatusChange = new Date().toISOString();
  }
  api.status = newStatus;
  api.latency = result.latency || 0;
  api.statusCode = result.statusCode;
  await redis.set(API_STATE_KEY, state);
}

export async function simulateOutage(api) {
  const state = await getApiState();
  const current = state[api];
  current.simulatedDown = true;
  current.simulatedDegraded = false;
  current.status = "DOWN";
  current.circuitState = "OPEN";
  current.circuitOpenedAt = Date.now();
  current.totalCircuitOpens++;
  current.lastStatusChange = new Date().toISOString();
  await redis.set(API_STATE_KEY, state);
}

export async function simulateDegraded(api) {
  const state = await getApiState();
  const current = state[api];
  current.simulatedDegraded = true;
  current.simulatedDown = false;
  current.status = "DEGRADED";
  current.lastStatusChange = new Date().toISOString();
  await redis.set(API_STATE_KEY, state);
}

export async function restoreApi(api) {
  const state = await getApiState();
  const current = state[api];
  current.simulatedDown = false;
  current.simulatedDegraded = false;
  current.status = "HEALTHY";
  current.circuitState = "CLOSED";
  current.consecutiveFailures = 0;
  current.circuitOpenedAt = null;
  current.lastStatusChange = new Date().toISOString();
  await redis.set(API_STATE_KEY, state);
}

export async function getEffectiveStatus(api) {
  const state = await getApiState();
  return state[api].status;
}

// How long an OPEN circuit waits before allowing a single test request through
// (the OPEN -> HALF_OPEN transition). Shared with getCircuitBreakerSummary()
// below so the reported config always matches the value actually enforced.
const CIRCUIT_BREAKER_COOLDOWN_MS = 30000;

export async function isRequestAllowed(apiName) {
  const state = await getApiState();
  const api = state[apiName];

  if (api.circuitState === "CLOSED") return { allowed: true, reason: "CLOSED" };

  if (api.circuitState === "OPEN") {
    const elapsed = Date.now() - api.circuitOpenedAt;
    if (elapsed >= CIRCUIT_BREAKER_COOLDOWN_MS) {
      // Cooldown has elapsed: let one request through as a recovery probe.
      api.circuitState = "HALF_OPEN";
      api.lastStatusChange = new Date().toISOString();
      await redis.set(API_STATE_KEY, state);
      return { allowed: true, reason: "HALF_OPEN_TEST" };
    }
    return { allowed: false, reason: "OPEN", retryAfterMs: CIRCUIT_BREAKER_COOLDOWN_MS - elapsed };
  }

  if (api.circuitState === "HALF_OPEN") return { allowed: true, reason: "HALF_OPEN_TEST" };

  return { allowed: false, reason: "UNKNOWN" };
}

export async function recordRequestResult(apiName, success) {
  const state = await getApiState();
  const api = state[apiName];
  if (success) {
    api.consecutiveFailures = 0;
    if (api.circuitState === "HALF_OPEN") {
      api.circuitState = "CLOSED";
      api.lastStatusChange = new Date().toISOString();
      await redis.set(API_STATE_KEY, state);
      return { transitioned: true, from: "HALF_OPEN", to: "CLOSED" };
    }
  } else {
    api.consecutiveFailures = (api.consecutiveFailures || 0) + 1;
    if (api.circuitState === "CLOSED" && api.consecutiveFailures >= 3) {
      api.circuitState = "OPEN";
      api.circuitOpenedAt = Date.now();
      api.totalCircuitOpens++;
      api.lastStatusChange = new Date().toISOString();
      await redis.set(API_STATE_KEY, state);
      return { transitioned: true, from: "CLOSED", to: "OPEN" };
    }
    if (api.circuitState === "HALF_OPEN") {
      api.circuitState = "OPEN";
      api.circuitOpenedAt = Date.now();
      api.totalCircuitOpens++;
      api.lastStatusChange = new Date().toISOString();
      await redis.set(API_STATE_KEY, state);
      return { transitioned: true, from: "HALF_OPEN", to: "OPEN" };
    }
  }
  await redis.set(API_STATE_KEY, state);
  return { transitioned: false };
}

export async function getStatusCounts() {
  const state = await getApiState();
  let healthy = 0, degraded = 0, down = 0;
  for (const api of ["openai", "anthropic", "gemini"]) {
    const s = state[api].status;
    if (s === "HEALTHY") healthy++;
    else if (s === "DEGRADED") degraded++;
    else if (s === "DOWN") down++;
  }
  return { healthy, degraded, down };
}

export async function getCircuitBreakerSummary() {
  const state = await getApiState();
  return {
    openai: {
      state: state.openai.circuitState,
      failures: state.openai.consecutiveFailures,
      threshold: 3,
      totalOpens: state.openai.totalCircuitOpens,
    },
    anthropic: {
      state: state.anthropic.circuitState,
      failures: state.anthropic.consecutiveFailures,
      threshold: 3,
      totalOpens: state.anthropic.totalCircuitOpens,
    },
    gemini: {
      state: state.gemini.circuitState,
      failures: state.gemini.consecutiveFailures,
      threshold: 3,
      totalOpens: state.gemini.totalCircuitOpens,
    },
    config: { failureThreshold: 3, cooldownDuration: CIRCUIT_BREAKER_COOLDOWN_MS },
  };
}
// ============================================
// RETRY CONFIG (Day 9)
// ============================================

const retryConfig = {
  maxRetries: 3,           // Max retry attempts before giving up
  baseDelay: 1000,         // 1 second base delay
  maxDelay: 10000,         // Cap at 10 seconds
  jitter: true,            // Add randomness to prevent thundering herd
};

export function getRetryConfig() {
  return retryConfig;
}

// Calculate delay for a given attempt number (0-indexed)
export function getRetryDelay(attempt) {
  let delay = retryConfig.baseDelay * Math.pow(2, attempt);
  
  // Cap at maxDelay
  delay = Math.min(delay, retryConfig.maxDelay);
  
  // Add jitter (±20% randomness) to prevent all retries hitting at once
  if (retryConfig.jitter) {
    const jitter = delay * 0.2;
    delay = delay + (Math.random() * jitter * 2 - jitter);
  }
  
  return Math.round(delay);
}
// ============================================
// EDGE CASE DATA (Day 10)
// ============================================

// Incident counter for unique error IDs
let incidentCounter = 1;

export function generateIncidentId() {
  const id = incidentCounter++;
  return "INC-2025-" + String(id).padStart(4, "0");
}

// Flapping detection (rapid UP/DOWN transitions)
const flappingState = {
  openai: { transitions: 0, lastTransitionTime: null, locked: false, lockedUntil: null },
  anthropic: { transitions: 0, lastTransitionTime: null, locked: false, lockedUntil: null },
  gemini: { transitions: 0, lastTransitionTime: null, locked: false, lockedUntil: null },
};

const FLAPPING_CONFIG = {
  maxTransitions: 5,       // Max state changes in window
  windowMs: 60000,        // 1 minute window
  lockDurationMs: 120000,  // Lock state for 2 minutes if flapping
};

export function checkFlapping(apiName, oldStatus, newStatus) {
  if (oldStatus === newStatus) return { isFlapping: false, locked: false };

  const flapping = flappingState[apiName];
  const now = Date.now();

  // If locked, don't change status
  if (flapping.locked) {
    if (now > flapping.lockedUntil) {
      // Unlock after lock duration
      flapping.locked = false;
      flapping.transitions = 0;
      flapping.lastTransitionTime = null;
      return { isFlapping: false, locked: false, justUnlocked: true };
    }
    return { isFlapping: true, locked: true };
  }

  // Reset window if too much time has passed
  if (flapping.lastTransitionTime && (now - flapping.lastTransitionTime > FLAPPING_CONFIG.windowMs)) {
    flapping.transitions = 0;
    flapping.lastTransitionTime = null;
  }

  // Record this transition
  flapping.transitions++;
  flapping.lastTransitionTime = now;

  // Check if flapping
  if (flapping.transitions >= FLAPPING_CONFIG.maxTransitions) {
    flapping.locked = true;
    flapping.lockedUntil = now + FLAPPING_CONFIG.lockDurationMs;
    return { isFlapping: true, locked: true };
  }

  return { isFlapping: false, locked: false };
}

// Rate limiting for chat
const rateLimitState = {
  timestamps: [],
  maxPerMinute: 20,
};

export function checkRateLimit() {
  const now = Date.now();
  // Remove timestamps older than 1 minute
  rateLimitState.timestamps = rateLimitState.timestamps.filter((t) => now - t < 60000);

  if (rateLimitState.timestamps.length >= rateLimitState.maxPerMinute) {
    return { allowed: false, remaining: 0, resetIn: 60000 - (now - rateLimitState.timestamps[0]) };
  }

  rateLimitState.timestamps.push(now);
  return { allowed: true, remaining: rateLimitState.maxPerMinute - rateLimitState.timestamps.length };
}

// Last known health state (for crash recovery)
let lastKnownHealth = null;

export function setLastKnownHealth(data) {
  lastKnownHealth = { ...data, savedAt: new Date().toISOString() };
}

export function getLastKnownHealth() {
  return lastKnownHealth;
}

// Debounce tracker
const debounceState = { lastSendTime: 0, minInterval: 500 };

export function shouldDebounce() {
  const now = Date.now();
  if (now - debounceState.lastSendTime < debounceState.minInterval) {
    return { shouldWait: true, waitMs: debounceState.minInterval - (now - debounceState.lastSendTime) };
  }
  debounceState.lastSendTime = now;
  return { shouldWait: false, waitMs: 0 };
}

export function resetDebounce() {
  debounceState.lastSendTime = 0;
}