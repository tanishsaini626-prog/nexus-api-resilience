import { redis } from "./redis";

function getApiStateKey(userId) {
  return `nexus:apiState:${userId}`;
}

// NOTE: This read-modify-write pattern has a small race condition
// window between the Redis get() and set() calls if two requests
// hit this at the exact same moment. Acceptable for this project's
// scale; a production system at higher concurrency would use Redis
// transactions (WATCH/MULTI) or a Lua script to make this atomic.

const DEGRADED_LATENCY_THRESHOLD_MS = 500;

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

export async function getApiState(userId) {
  const state = await redis.get(getApiStateKey(userId));
  return state || structuredClone(DEFAULT_API_STATE);
}

// Persist a state object the caller already holds in memory. This is what lets
// the health poll read state once, mutate it for all three providers, and write
// it back once — instead of every helper doing its own get/set round-trip.
export async function saveApiState(userId, state) {
  await redis.set(getApiStateKey(userId), state);
}

// Routing mode is stored in Redis PER USER (not in module memory): under
// Turbopack dev each route bundle gets its own copy of this module, and in
// production each API route is a separate serverless function — in both
// cases, in-memory state written by /api/settings is invisible to /api/chat.
export async function getOptimizationMode(userId) {
  const mode = await redis.get(`nexus:optimizationMode:${userId}`);
  return mode || "OFF";
}

export async function setOptimizationMode(userId, mode) {
  if (["OFF", "COST", "LATENCY"].includes(mode)) {
    await redis.set(`nexus:optimizationMode:${userId}`, mode);
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

// Pure: apply one probe result to an in-memory state object. Returns true if it
// changed anything, false when the provider is in a simulated state and must be
// left alone. No Redis — the caller decides when to persist (see saveApiState).
export function applyHealthCheck(state, apiName, result) {
  const api = state[apiName];
  if (api.simulatedDown || api.simulatedDegraded) return false;

  const newStatus = determineStatus(result.latency, result.statusCode, result.wasError);
  if (newStatus !== api.status) {
    api.lastStatusChange = new Date().toISOString();
  }
  api.status = newStatus;
  api.latency = result.latency || 0;
  api.statusCode = result.statusCode;
  return true;
}

// Redis-backed wrapper (unchanged signature) for callers that update a single
// provider in isolation. The batched health poll uses applyHealthCheck directly.
export async function updateHealthCheck(userId, apiName, result) {
  const state = await getApiState(userId);
  if (applyHealthCheck(state, apiName, result)) {
    await redis.set(getApiStateKey(userId), state);
  }
}

export async function simulateOutage(userId, api) {
  const state = await getApiState(userId);
  const current = state[api];
  current.simulatedDown = true;
  current.simulatedDegraded = false;
  current.status = "DOWN";
  current.circuitState = "OPEN";
  current.circuitOpenedAt = Date.now();
  current.totalCircuitOpens++;
  current.lastStatusChange = new Date().toISOString();
  await redis.set(getApiStateKey(userId), state);
}

export async function simulateDegraded(userId, api) {
  const state = await getApiState(userId);
  const current = state[api];
  current.simulatedDegraded = true;
  current.simulatedDown = false;
  current.status = "DEGRADED";
  current.lastStatusChange = new Date().toISOString();
  await redis.set(getApiStateKey(userId), state);
}

export async function restoreApi(userId, api) {
  const state = await getApiState(userId);
  const current = state[api];
  current.simulatedDown = false;
  current.simulatedDegraded = false;
  current.status = "HEALTHY";
  current.circuitState = "CLOSED";
  current.consecutiveFailures = 0;
  current.circuitOpenedAt = null;
  current.lastStatusChange = new Date().toISOString();
  await redis.set(getApiStateKey(userId), state);
}

export async function getEffectiveStatus(userId, api) {
  const state = await getApiState(userId);
  return state[api].status;
}

// How long an OPEN circuit waits before allowing a single test request through
// (the OPEN -> HALF_OPEN transition). Shared with getCircuitBreakerSummary()
// below so the reported config always matches the value actually enforced.
const CIRCUIT_BREAKER_COOLDOWN_MS = 30000;

export async function isRequestAllowed(userId, apiName) {
  const state = await getApiState(userId);
  const api = state[apiName];

  if (api.circuitState === "CLOSED") return { allowed: true, reason: "CLOSED" };

  if (api.circuitState === "OPEN") {
    const elapsed = Date.now() - api.circuitOpenedAt;
    if (elapsed >= CIRCUIT_BREAKER_COOLDOWN_MS) {
      // Cooldown has elapsed: let one request through as a recovery probe.
      api.circuitState = "HALF_OPEN";
      api.lastStatusChange = new Date().toISOString();
      await redis.set(getApiStateKey(userId), state);
      return { allowed: true, reason: "HALF_OPEN_TEST" };
    }
    return { allowed: false, reason: "OPEN", retryAfterMs: CIRCUIT_BREAKER_COOLDOWN_MS - elapsed };
  }

  if (api.circuitState === "HALF_OPEN") return { allowed: true, reason: "HALF_OPEN_TEST" };

  return { allowed: false, reason: "UNKNOWN" };
}

export async function recordRequestResult(userId, apiName, success) {
  const state = await getApiState(userId);
  const api = state[apiName];
  if (success) {
    api.consecutiveFailures = 0;
    if (api.circuitState === "HALF_OPEN") {
      api.circuitState = "CLOSED";
      api.lastStatusChange = new Date().toISOString();
      await redis.set(getApiStateKey(userId), state);
      return { transitioned: true, from: "HALF_OPEN", to: "CLOSED" };
    }
  } else {
    api.consecutiveFailures = (api.consecutiveFailures || 0) + 1;
    if (api.circuitState === "CLOSED" && api.consecutiveFailures >= 3) {
      api.circuitState = "OPEN";
      api.circuitOpenedAt = Date.now();
      api.totalCircuitOpens++;
      api.lastStatusChange = new Date().toISOString();
      await redis.set(getApiStateKey(userId), state);
      return { transitioned: true, from: "CLOSED", to: "OPEN" };
    }
    if (api.circuitState === "HALF_OPEN") {
      api.circuitState = "OPEN";
      api.circuitOpenedAt = Date.now();
      api.totalCircuitOpens++;
      api.lastStatusChange = new Date().toISOString();
      await redis.set(getApiStateKey(userId), state);
      return { transitioned: true, from: "HALF_OPEN", to: "OPEN" };
    }
  }
  await redis.set(getApiStateKey(userId), state);
  return { transitioned: false };
}

// Pure: tally statuses from an in-memory state object (no Redis).
export function computeStatusCounts(state) {
  let healthy = 0, degraded = 0, down = 0;
  for (const api of ["openai", "anthropic", "gemini"]) {
    const s = state[api].status;
    if (s === "HEALTHY") healthy++;
    else if (s === "DEGRADED") degraded++;
    else if (s === "DOWN") down++;
  }
  return { healthy, degraded, down };
}

export async function getStatusCounts(userId) {
  const state = await getApiState(userId);
  return computeStatusCounts(state);
}

// Pure: build the circuit-breaker summary from an in-memory state object.
export function computeCircuitBreakerSummary(state) {
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

export async function getCircuitBreakerSummary(userId) {
  const state = await getApiState(userId);
  return computeCircuitBreakerSummary(state);
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

// Flapping detection (rapid UP/DOWN transitions).
//
// The counter lives INSIDE each provider's entry in the per-user apiState
// object: state[api].flapping. That makes it per-user and per-provider for
// free — the health poll already reads and writes that object once — and it
// survives restarts. Before Phase 17c this was a module-level global, which
// meant one user's flapping could lock another user's status updates.
const FLAPPING_CONFIG = {
  maxTransitions: 5,       // Max state changes in window
  windowMs: 60000,        // 1 minute window
  lockDurationMs: 120000,  // Lock state for 2 minutes if flapping
};

// Pure w.r.t. Redis: mutates the flapping counter on the state object the
// caller owns (which saveApiState persists). oldStatus comes from the state
// itself, so callers can't disagree with it.
export function checkFlapping(state, apiName, newStatus) {
  const api = state[apiName];
  const oldStatus = api.status;
  if (oldStatus === newStatus) return { isFlapping: false, locked: false };

  if (!api.flapping) {
    api.flapping = { transitions: 0, lastTransitionTime: null, locked: false, lockedUntil: null };
  }
  const flapping = api.flapping;
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

// ============================================
// PER-USER RATE LIMITING (Phase 15; atomic via Lua since Phase 17d)
// ============================================

// Sliding window per user, stored in Redis so it works across route bundles
// and serverless instances and survives restarts. Two windows:
//   - per-minute: sorted set of request timestamps (true sliding window)
//   - per-day: a counter with a TTL, keyed by UTC date
//
// The whole decision runs as ONE Lua EVAL. The original JS flow (zrem → zcard
// → incr → zadd → expire, each a separate REST round-trip) raced under
// concurrent requests: two requests could both count 19, both pass the check,
// and both be admitted, letting a burst exceed the limit. EVAL runs
// sequentially and isolated on the Redis side, so exactly RATE_LIMIT_PER_MINUTE
// requests can pass per window no matter how many arrive at once.
const RATE_LIMIT_PER_MINUTE = 20;
const RATE_LIMIT_PER_DAY = 200;
const MINUTE_WINDOW_MS = 60000;

const RATE_LIMIT_SCRIPT = `-- NEXUS_RATE_LIMIT_V1
-- KEYS[1] = minute sliding-window sorted set
-- KEYS[2] = daily counter
-- ARGV[1]=now(ms) [2]=window(ms) [3]=minuteLimit [4]=dayLimit [5]=dayTtl(s)
-- ARGV[6]=unique member for this request [7]=ms until the daily cap resets
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local minuteLimit = tonumber(ARGV[3])
local dayLimit = tonumber(ARGV[4])

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= minuteLimit then
  return cjson.encode({ allowed = false, reason = 'minute', remaining = 0, resetIn = window })
end

local dayCount = redis.call('INCR', KEYS[2])
if dayCount == 1 then
  redis.call('EXPIRE', KEYS[2], tonumber(ARGV[5]))
end
if dayCount > dayLimit then
  return cjson.encode({ allowed = false, reason = 'daily', remaining = 0, resetIn = tonumber(ARGV[7]) })
end

redis.call('ZADD', KEYS[1], now, ARGV[6])
redis.call('EXPIRE', KEYS[1], 120)
return cjson.encode({ allowed = true, reason = 'ok', remaining = minuteLimit - count - 1, resetIn = 0 })
`;

// The EVAL result comes back as a JSON string (cjson.encode in the script);
// newer clients may hand it over pre-parsed, so accept both.
function parseEvalResult(result) {
  if (typeof result === "string") return JSON.parse(result);
  return result;
}

function dailyResetInMs(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

function getRateLimitMinuteKey(userId) {
  return `nexus:rateLimit:minute:${userId}`;
}

function getRateLimitDayKey(userId) {
  return `nexus:rateLimit:day:${userId}:${new Date().toISOString().slice(0, 10)}`;
}

export async function checkRateLimit(userId) {
  const now = Date.now();
  const result = parseEvalResult(
    await redis.eval(
      RATE_LIMIT_SCRIPT,
      [getRateLimitMinuteKey(userId), getRateLimitDayKey(userId)],
      [
        String(now),
        String(MINUTE_WINDOW_MS),
        String(RATE_LIMIT_PER_MINUTE),
        String(RATE_LIMIT_PER_DAY),
        String(90000), // 25h daily-counter TTL
        `${now}-${Math.random().toString(36).slice(2, 8)}`,
        String(dailyResetInMs(now)),
      ]
    )
  );
  return {
    allowed: Boolean(result.allowed),
    remaining: result.remaining,
    resetIn: result.resetIn,
    reason: result.reason,
  };
}

// Last known health state (for crash recovery).
//
// Deliberately NOT stored in Redis: this cache exists for the case where the
// health computation throws — which includes Redis itself being unreachable —
// so persisting it there would defeat its purpose. It is a per-instance,
// best-effort cache, so it's keyed by user: user A's fallback payload must
// never be served in user B's response.
const lastKnownHealthByUser = new Map();

export function setLastKnownHealth(userId, data) {
  lastKnownHealthByUser.set(userId, { ...data, savedAt: new Date().toISOString() });
}

export function getLastKnownHealth(userId) {
  return lastKnownHealthByUser.get(userId) || null;
}

// Debounce: reject a second message from the same user within 500ms.
// Redis-backed and per-user (Phase 17c): the old module-level timestamp was
// shared by every user on the instance, so one person's traffic could make
// another person's message look like a double-send.
const DEBOUNCE_MIN_INTERVAL_MS = 500;

function getDebounceKey(userId) {
  return `nexus:debounce:${userId}`;
}

export async function shouldDebounce(userId) {
  const now = Date.now();
  const lastSendTime = Number(await redis.get(getDebounceKey(userId))) || 0;
  const elapsed = now - lastSendTime;

  if (elapsed < DEBOUNCE_MIN_INTERVAL_MS) {
    return { shouldWait: true, waitMs: DEBOUNCE_MIN_INTERVAL_MS - elapsed };
  }

  // TTL self-cleans the key once it can no longer affect anything.
  await redis.set(getDebounceKey(userId), now, { ex: 60 });
  return { shouldWait: false, waitMs: 0 };
}

export async function resetDebounce(userId) {
  await redis.del(getDebounceKey(userId));
}