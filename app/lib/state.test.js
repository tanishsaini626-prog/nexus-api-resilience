import { vi, describe, it, expect, beforeEach } from "vitest";

// ============================================================================
// Redis Mock Setup (In-Memory Fake Store)
// ============================================================================
let fakeStore = {};
let fakeZsets = {};

function fakeZset(key) {
  if (!fakeZsets[key]) fakeZsets[key] = [];
  return fakeZsets[key];
}

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key) => fakeStore[key] ?? null),
    set: vi.fn(async (key, value) => {
      fakeStore[key] = value;
    }),
    incr: vi.fn(async (key) => {
      fakeStore[key] = (Number(fakeStore[key]) || 0) + 1;
      return fakeStore[key];
    }),
    del: vi.fn(async (key) => {
      const existed = key in fakeStore || key in fakeZsets;
      delete fakeStore[key];
      delete fakeZsets[key];
      return existed ? 1 : 0;
    }),
    expire: vi.fn(async () => 1),
    zadd: vi.fn(async (key, { score, member }) => {
      fakeZset(key).push({ score, member });
      return 1;
    }),
    zcard: vi.fn(async (key) => fakeZset(key).length),
    zremrangebyscore: vi.fn(async (key, min, max) => {
      const before = fakeZset(key).length;
      fakeZsets[key] = fakeZset(key).filter((e) => e.score < min || e.score > max);
      return before - fakeZsets[key].length;
    }),
  },
}));

import {
  getRetryDelay,
  checkFlapping,
  checkRateLimit,
  shouldDebounce,
  resetDebounce,
  generateIncidentId,
  getApiState,
  isRequestAllowed,
  recordRequestResult,
  simulateOutage,
  simulateDegraded,
  restoreApi,
  getEffectiveStatus,
  getStatusCounts,
  getCircuitBreakerSummary,
  applyHealthCheck,
  computeStatusCounts,
  computeCircuitBreakerSummary,
  setLastKnownHealth,
  getLastKnownHealth,
} from "./state.js";
import { redis } from "./redis";

// ============================================================================
// SECTION 1: Pure Synchronous Functions (Existing Suite)
// ============================================================================
describe("state.js - Pure Synchronous Functions", () => {
  // --------------------------------------------------------------------------
  // getRetryDelay(attempt)
  // Base delay: 1000ms, Multiplier: 2^attempt, Cap: 10000ms, Jitter: ±20%
  // --------------------------------------------------------------------------
  describe("getRetryDelay", () => {
    it("roughly doubles delay with each attempt (exponential backoff within jitter bounds)", () => {
      // Attempt 0: 1000 * 2^0 = 1000ms ± 20% => [800, 1200]
      const delay0 = getRetryDelay(0);
      expect(delay0).toBeGreaterThanOrEqual(800);
      expect(delay0).toBeLessThanOrEqual(1200);

      // Attempt 1: 1000 * 2^1 = 2000ms ± 20% => [1600, 2400]
      const delay1 = getRetryDelay(1);
      expect(delay1).toBeGreaterThanOrEqual(1600);
      expect(delay1).toBeLessThanOrEqual(2400);

      // Attempt 2: 1000 * 2^2 = 4000ms ± 20% => [3200, 4800]
      const delay2 = getRetryDelay(2);
      expect(delay2).toBeGreaterThanOrEqual(3200);
      expect(delay2).toBeLessThanOrEqual(4800);

      // Attempt 3: 1000 * 2^3 = 8000ms ± 20% => [6400, 9600]
      const delay3 = getRetryDelay(3);
      expect(delay3).toBeGreaterThanOrEqual(6400);
      expect(delay3).toBeLessThanOrEqual(9600);
    });

    it("never exceeds maxDelay (10000ms + jitter) even at high attempt numbers", () => {
      // With base delay capped at maxDelay (10000ms) and ±20% jitter,
      // the returned delay should never exceed 12000ms or fall below 8000ms
      for (const attempt of [4, 5, 10, 50, 100]) {
        const delay = getRetryDelay(attempt);
        expect(delay).toBeGreaterThanOrEqual(8000);
        expect(delay).toBeLessThanOrEqual(12000);
      }
    });
  });

  // --------------------------------------------------------------------------
  // checkFlapping(state, apiName, newStatus)
  // FLAPPING_CONFIG: maxTransitions: 5, windowMs: 60000, lockDurationMs: 120000
  // Pure: the counter lives on the per-user state object (state[api].flapping),
  // not in a module global — that's what keeps users isolated (Phase 17c).
  // --------------------------------------------------------------------------
  describe("checkFlapping", () => {
    function stateWith(status) {
      return { openai: { status }, anthropic: { status }, gemini: { status } };
    }

    it("does not trigger flapping when the probe agrees with the recorded status", () => {
      // Stable status returns immediately without modifying transition state
      const result1 = checkFlapping(stateWith("HEALTHY"), "openai", "HEALTHY");
      expect(result1).toEqual({ isFlapping: false, locked: false });

      const result2 = checkFlapping(stateWith("DOWN"), "anthropic", "DOWN");
      expect(result2).toEqual({ isFlapping: false, locked: false });
    });

    it("triggers isFlapping: true and locked: true after 5 rapid transitions", () => {
      // Threshold is maxTransitions: 5 within 60000ms window
      const state = stateWith("HEALTHY");
      const transitions = [
        ["HEALTHY", "DOWN"], // transition 1
        ["DOWN", "HEALTHY"], // transition 2
        ["HEALTHY", "DOWN"], // transition 3
        ["DOWN", "HEALTHY"], // transition 4
      ];

      for (const [oldStatus, newStatus] of transitions) {
        state.gemini.status = oldStatus;
        const res = checkFlapping(state, "gemini", newStatus);
        expect(res.isFlapping).toBe(false);
        expect(res.locked).toBe(false);
      }

      // 5th rapid transition reaches the threshold (maxTransitions = 5)
      state.gemini.status = "HEALTHY";
      const res5 = checkFlapping(state, "gemini", "DOWN");
      expect(res5.isFlapping).toBe(true);
      expect(res5.locked).toBe(true);

      // Subsequent calls while locked return locked state
      state.gemini.status = "DOWN";
      const resLocked = checkFlapping(state, "gemini", "HEALTHY");
      expect(resLocked.isFlapping).toBe(true);
      expect(resLocked.locked).toBe(true);
    });

    it("counts transitions per user and per provider (no cross-user leakage)", () => {
      // User A's gemini flips five times and locks...
      const userA = stateWith("HEALTHY");
      for (let i = 0; i < 5; i++) {
        userA.gemini.status = i % 2 === 0 ? "HEALTHY" : "DOWN";
        checkFlapping(userA, "gemini", i % 2 === 0 ? "DOWN" : "HEALTHY");
      }
      expect(userA.gemini.flapping.locked).toBe(true);

      // ...but that must not lock the same provider for another user (the bug
      // this refactor fixed: the counter used to be a module-level global).
      const userB = stateWith("HEALTHY");
      const other = checkFlapping(userB, "gemini", "DOWN");
      expect(other.isFlapping).toBe(false);
      expect(other.locked).toBe(false);

      // Nor does it affect a different provider on the same state object.
      const sameUserOtherProvider = checkFlapping(userA, "openai", "DOWN");
      expect(sameUserOtherProvider.isFlapping).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // generateIncidentId()
  // Format: "INC-2025-XXXX" with 4-digit padded counter
  // --------------------------------------------------------------------------
  describe("generateIncidentId", () => {
    it("returns an ID matching the expected format and produces unique IDs on successive calls", () => {
      const id1 = generateIncidentId();
      const id2 = generateIncidentId();

      // Format: starts with INC-2025- followed by at least 4 digits
      expect(id1).toMatch(/^INC-2025-\d{4,}$/);
      expect(id2).toMatch(/^INC-2025-\d{4,}$/);

      // Successive calls produce different IDs
      expect(id1).not.toBe(id2);
    });
  });
});

// ============================================================================
// SECTION 2: Redis-Dependent Circuit Breaker & State Functions
// ============================================================================
describe("state.js - Redis-Dependent Circuit Breaker & State Functions", () => {
  // All Redis-backed state functions are per-user: userId is the first argument
  // and state.js embeds it in the Redis key. The seeded fakeStore key below must
  // stay identical to the format state.js's getApiStateKey() actually produces.
  const USER_ID = "test-user-1";
  const API_STATE_KEY = `nexus:apiState:${USER_ID}`;

  beforeEach(() => {
    fakeStore = {}; // reset the fake Redis before every single test
  });

  // 1. Default state when store is empty
  it("returns default state with all providers HEALTHY and CLOSED when fakeStore is empty", async () => {
    const state = await getApiState(USER_ID);
    expect(fakeStore[API_STATE_KEY]).toBeUndefined();

    for (const provider of ["openai", "anthropic", "gemini"]) {
      expect(state[provider]).toBeDefined();
      expect(state[provider].status).toBe("HEALTHY");
      expect(state[provider].circuitState).toBe("CLOSED");
      expect(state[provider].consecutiveFailures).toBe(0);
      expect(state[provider].simulatedDown).toBe(false);
      expect(state[provider].simulatedDegraded).toBe(false);
    }
  });

  // 2. 3 consecutive failures on a CLOSED circuit trips it to OPEN
  it("trips circuit from CLOSED to OPEN after 3 consecutive failures", async () => {
    // 1st failure
    const res1 = await recordRequestResult(USER_ID, "openai", false);
    expect(res1).toEqual({ transitioned: false });
    let state = await getApiState(USER_ID);
    expect(state.openai.consecutiveFailures).toBe(1);
    expect(state.openai.circuitState).toBe("CLOSED");

    // 2nd failure
    const res2 = await recordRequestResult(USER_ID, "openai", false);
    expect(res2).toEqual({ transitioned: false });
    state = await getApiState(USER_ID);
    expect(state.openai.consecutiveFailures).toBe(2);
    expect(state.openai.circuitState).toBe("CLOSED");

    // 3rd failure: reaches failureThreshold (3)
    const res3 = await recordRequestResult(USER_ID, "openai", false);
    expect(res3).toEqual({ transitioned: true, from: "CLOSED", to: "OPEN" });
    state = await getApiState(USER_ID);
    expect(state.openai.consecutiveFailures).toBe(3);
    expect(state.openai.circuitState).toBe("OPEN");
    expect(state.openai.circuitOpenedAt).toBeTypeOf("number");
    expect(state.openai.totalCircuitOpens).toBe(1);
  });

  // 3. Immediately after tripping to OPEN, requests are not allowed
  it("disallows requests immediately after tripping to OPEN because cooldown has not elapsed", async () => {
    // Trip the circuit to OPEN
    await recordRequestResult(USER_ID, "openai", false);
    await recordRequestResult(USER_ID, "openai", false);
    await recordRequestResult(USER_ID, "openai", false);

    const check = await isRequestAllowed(USER_ID, "openai");
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe("OPEN");
    expect(check.retryAfterMs).toBeGreaterThan(0);
    expect(check.retryAfterMs).toBeLessThanOrEqual(30000);
  });

  // 4. Test cooldown elapsed: transitions to HALF_OPEN and allows request
  it("transitions circuit from OPEN to HALF_OPEN and allows request after cooldown elapses", async () => {
    // Cooldown duration is 30,000ms (CIRCUIT_BREAKER_COOLDOWN_MS).
    // Directly seed fakeStore with an OPEN state opened 40,000ms ago.
    const defaultState = await getApiState(USER_ID);
    defaultState.openai.circuitState = "OPEN";
    defaultState.openai.circuitOpenedAt = Date.now() - 40000;
    fakeStore[API_STATE_KEY] = defaultState;

    const check = await isRequestAllowed(USER_ID, "openai");
    expect(check.allowed).toBe(true);
    expect(check.reason).toBe("HALF_OPEN_TEST");

    // Confirm state persistence in fakeStore: now HALF_OPEN
    const state = await getApiState(USER_ID);
    expect(state.openai.circuitState).toBe("HALF_OPEN");
  });

  // 5. Successful call while HALF_OPEN transitions to CLOSED
  it("transitions circuit from HALF_OPEN to CLOSED on a successful request", async () => {
    const defaultState = await getApiState(USER_ID);
    defaultState.openai.circuitState = "HALF_OPEN";
    defaultState.openai.consecutiveFailures = 3;
    fakeStore[API_STATE_KEY] = defaultState;

    const result = await recordRequestResult(USER_ID, "openai", true);
    expect(result).toEqual({ transitioned: true, from: "HALF_OPEN", to: "CLOSED" });

    const state = await getApiState(USER_ID);
    expect(state.openai.circuitState).toBe("CLOSED");
    expect(state.openai.consecutiveFailures).toBe(0);
  });

  // 6. Failed call while HALF_OPEN transitions back to OPEN
  it("transitions circuit from HALF_OPEN back to OPEN on a failed request", async () => {
    const defaultState = await getApiState(USER_ID);
    defaultState.openai.circuitState = "HALF_OPEN";
    defaultState.openai.totalCircuitOpens = 1;
    fakeStore[API_STATE_KEY] = defaultState;

    const result = await recordRequestResult(USER_ID, "openai", false);
    expect(result).toEqual({ transitioned: true, from: "HALF_OPEN", to: "OPEN" });

    const state = await getApiState(USER_ID);
    expect(state.openai.circuitState).toBe("OPEN");
    expect(state.openai.totalCircuitOpens).toBe(2);
    expect(state.openai.circuitOpenedAt).toBeTypeOf("number");
  });

  // 7. simulateOutage, simulateDegraded, restoreApi
  it("correctly sets status and circuitState fields in simulateOutage, simulateDegraded, and restoreApi", async () => {
    // simulateOutage: DOWN, circuitState OPEN, simulatedDown true
    await simulateOutage(USER_ID, "openai");
    let state = await getApiState(USER_ID);
    expect(state.openai.status).toBe("DOWN");
    expect(state.openai.circuitState).toBe("OPEN");
    expect(state.openai.simulatedDown).toBe(true);
    expect(state.openai.simulatedDegraded).toBe(false);
    expect(await getEffectiveStatus(USER_ID, "openai")).toBe("DOWN");

    // simulateDegraded: DEGRADED, simulatedDegraded true, simulatedDown false
    await simulateDegraded(USER_ID, "openai");
    state = await getApiState(USER_ID);
    expect(state.openai.status).toBe("DEGRADED");
    expect(state.openai.simulatedDegraded).toBe(true);
    expect(state.openai.simulatedDown).toBe(false);
    expect(await getEffectiveStatus(USER_ID, "openai")).toBe("DEGRADED");

    // restoreApi: HEALTHY, circuitState CLOSED, simulated flags cleared, failures reset
    await restoreApi(USER_ID, "openai");
    state = await getApiState(USER_ID);
    expect(state.openai.status).toBe("HEALTHY");
    expect(state.openai.circuitState).toBe("CLOSED");
    expect(state.openai.simulatedDown).toBe(false);
    expect(state.openai.simulatedDegraded).toBe(false);
    expect(state.openai.consecutiveFailures).toBe(0);
    expect(state.openai.circuitOpenedAt).toBeNull();
    expect(await getEffectiveStatus(USER_ID, "openai")).toBe("HEALTHY");
  });

  // 8. getStatusCounts and getCircuitBreakerSummary
  it("correctly calculates status counts and circuit breaker summary for configured states", async () => {
    const state = await getApiState(USER_ID);
    state.openai.status = "DOWN";
    state.openai.circuitState = "OPEN";
    state.openai.consecutiveFailures = 3;
    state.openai.totalCircuitOpens = 1;

    state.anthropic.status = "DEGRADED";
    state.anthropic.circuitState = "CLOSED";
    state.anthropic.consecutiveFailures = 1;
    state.anthropic.totalCircuitOpens = 0;

    state.gemini.status = "HEALTHY";
    state.gemini.circuitState = "CLOSED";
    state.gemini.consecutiveFailures = 0;
    state.gemini.totalCircuitOpens = 0;

    fakeStore[API_STATE_KEY] = state;

    // Verify getStatusCounts
    const counts = await getStatusCounts(USER_ID);
    expect(counts).toEqual({ healthy: 1, degraded: 1, down: 1 });

    // Verify getCircuitBreakerSummary
    const summary = await getCircuitBreakerSummary(USER_ID);
    expect(summary).toEqual({
      openai: {
        state: "OPEN",
        failures: 3,
        threshold: 3,
        totalOpens: 1,
      },
      anthropic: {
        state: "CLOSED",
        failures: 1,
        threshold: 3,
        totalOpens: 0,
      },
      gemini: {
        state: "CLOSED",
        failures: 0,
        threshold: 3,
        totalOpens: 0,
      },
      config: {
        failureThreshold: 3,
        cooldownDuration: 30000,
      },
    });
  });

  // 9. shouldDebounce / resetDebounce — Redis-backed and per-user (Phase 17c)
  describe("shouldDebounce and resetDebounce", () => {
    it("requires rapid succession calls to wait, and allows an immediate call after resetDebounce", async () => {
      await resetDebounce(USER_ID);

      // First call should not need to wait
      const firstCall = await shouldDebounce(USER_ID);
      expect(firstCall.shouldWait).toBe(false);
      expect(firstCall.waitMs).toBe(0);

      // Second call immediately after should need to wait (< 500ms interval)
      const secondCall = await shouldDebounce(USER_ID);
      expect(secondCall.shouldWait).toBe(true);
      expect(secondCall.waitMs).toBeGreaterThan(0);
      expect(secondCall.waitMs).toBeLessThanOrEqual(500);

      // resetDebounce clears the recorded timestamp
      await resetDebounce(USER_ID);

      const afterResetCall = await shouldDebounce(USER_ID);
      expect(afterResetCall.shouldWait).toBe(false);
      expect(afterResetCall.waitMs).toBe(0);
    });

    it("tracks users independently — one user's recent send never blocks another's", async () => {
      // The old module-level timestamp was shared by every user on the instance,
      // so a burst from one account could make another account look like it was
      // double-sending. State now lives in Redis under a per-user key.
      await shouldDebounce("user-a");

      const blockedA = await shouldDebounce("user-a");
      expect(blockedA.shouldWait).toBe(true);

      const allowedB = await shouldDebounce("user-b");
      expect(allowedB.shouldWait).toBe(false);
      expect(allowedB.waitMs).toBe(0);
    });

    it("persists the last send time in Redis so it survives across instances", async () => {
      await shouldDebounce(USER_ID);

      // Simulate another instance/request cycle: the value must be readable
      // from the shared store, not from module memory.
      const stored = Number(fakeStore[`nexus:debounce:${USER_ID}`]);
      expect(stored).toBeGreaterThan(0);
      expect(Date.now() - stored).toBeLessThan(1000);
    });
  });

  // 10. lastKnownHealth crash-recovery cache — per-user (Phase 17c)
  describe("lastKnownHealth cache", () => {
    it("never serves one user's cached payload in another user's response", () => {
      // Health responses include per-user fields (optimizationMode, provider
      // statuses), so the fallback cache must be keyed by user.
      setLastKnownHealth("user-a", { marker: "A" });
      setLastKnownHealth("user-b", { marker: "B" });

      expect(getLastKnownHealth("user-a").marker).toBe("A");
      expect(getLastKnownHealth("user-b").marker).toBe("B");
      expect(getLastKnownHealth("user-c")).toBeNull();
    });

    it("stamps savedAt so a stale fallback is identifiable", () => {
      setLastKnownHealth("user-d", { marker: "D" });

      const cached = getLastKnownHealth("user-d");
      expect(cached.savedAt).toBeTypeOf("string");
      expect(Date.now() - Date.parse(cached.savedAt)).toBeLessThan(5000);
    });
  });
});

// ============================================================================
// SECTION 3: Per-User Rate Limiting (Redis sliding window + daily cap)
// ============================================================================
describe("state.js - Per-User Rate Limiting", () => {
  const RATE_USER = "rate-limit-user-1";

  beforeEach(() => {
    fakeStore = {};
    fakeZsets = {};
  });

  it("allows 20 requests per minute, then blocks the 21st (remaining counts down)", async () => {
    for (let i = 0; i < 20; i++) {
      const result = await checkRateLimit(RATE_USER);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(20 - (i + 1));
    }

    const rejected = await checkRateLimit(RATE_USER);
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.reason).toBe("minute");
    expect(rejected.resetIn).toBeGreaterThan(0);
  });

  it("tracks users independently — one user's limit never affects another", async () => {
    for (let i = 0; i < 20; i++) {
      await checkRateLimit("user-a");
    }
    const blockedA = await checkRateLimit("user-a");
    expect(blockedA.allowed).toBe(false);

    const allowedB = await checkRateLimit("user-b");
    expect(allowedB.allowed).toBe(true);
    expect(allowedB.remaining).toBe(19);
  });

  it("enforces the 200/day cap even when the minute window is clear", async () => {
    for (let i = 0; i < 200; i++) {
      fakeZsets = {}; // clear minute windows to isolate the daily cap
      const result = await checkRateLimit("daily-user");
      expect(result.allowed).toBe(true);
    }

    fakeZsets = {};
    const rejected = await checkRateLimit("daily-user");
    expect(rejected.allowed).toBe(false);
    expect(rejected.reason).toBe("daily");
    expect(rejected.resetIn).toBeGreaterThan(0);
  });
});

// ============================================================================
// SECTION 4: Batched Health Helpers Are Pure (Phase 17a)
// ============================================================================
// The health poll now reads state once and writes once. For that to actually
// cut Redis traffic, the helpers it reuses must operate purely on an in-memory
// object and add ZERO Redis calls. These tests assert exactly that by watching
// the mocked redis.get/redis.set call counts across each helper.
describe("state.js - Batched health helpers are pure", () => {
  function sampleState() {
    return {
      openai: { status: "DOWN", latency: 0, statusCode: null, circuitState: "OPEN", consecutiveFailures: 3, totalCircuitOpens: 1, simulatedDown: false, simulatedDegraded: false, lastStatusChange: null },
      anthropic: { status: "DEGRADED", latency: 0, statusCode: null, circuitState: "CLOSED", consecutiveFailures: 1, totalCircuitOpens: 0, simulatedDown: false, simulatedDegraded: false, lastStatusChange: null },
      gemini: { status: "HEALTHY", latency: 0, statusCode: null, circuitState: "CLOSED", consecutiveFailures: 0, totalCircuitOpens: 0, simulatedDown: false, simulatedDegraded: false, lastStatusChange: null },
    };
  }

  it("computeStatusCounts tallies statuses without touching Redis", () => {
    const gets = redis.get.mock.calls.length;
    const sets = redis.set.mock.calls.length;

    expect(computeStatusCounts(sampleState())).toEqual({ healthy: 1, degraded: 1, down: 1 });

    expect(redis.get.mock.calls.length).toBe(gets);
    expect(redis.set.mock.calls.length).toBe(sets);
  });

  it("computeCircuitBreakerSummary mirrors state without touching Redis", () => {
    const gets = redis.get.mock.calls.length;
    const sets = redis.set.mock.calls.length;

    const summary = computeCircuitBreakerSummary(sampleState());
    expect(summary.openai).toEqual({ state: "OPEN", failures: 3, threshold: 3, totalOpens: 1 });
    expect(summary.gemini).toEqual({ state: "CLOSED", failures: 0, threshold: 3, totalOpens: 0 });
    expect(summary.config).toEqual({ failureThreshold: 3, cooldownDuration: 30000 });

    expect(redis.get.mock.calls.length).toBe(gets);
    expect(redis.set.mock.calls.length).toBe(sets);
  });

  it("applyHealthCheck mutates the object in place, skips simulated providers, and never touches Redis", () => {
    const gets = redis.get.mock.calls.length;
    const sets = redis.set.mock.calls.length;

    const state = sampleState();

    // A fast, healthy probe records latency/status on gemini in place.
    const changed = applyHealthCheck(state, "gemini", { latency: 42, statusCode: 200, wasError: false });
    expect(changed).toBe(true);
    expect(state.gemini.status).toBe("HEALTHY");
    expect(state.gemini.latency).toBe(42);

    // A simulated provider is left untouched and reports no change.
    state.openai.simulatedDown = true;
    const changedSim = applyHealthCheck(state, "openai", { latency: 10, statusCode: 200, wasError: false });
    expect(changedSim).toBe(false);
    expect(state.openai.status).toBe("DOWN");

    expect(redis.get.mock.calls.length).toBe(gets);
    expect(redis.set.mock.calls.length).toBe(sets);
  });
});
