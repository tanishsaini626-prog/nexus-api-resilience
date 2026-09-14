import { vi, describe, it, expect, beforeEach } from "vitest";

// ============================================================================
// Redis Mock Setup (In-Memory Fake Store)
// ============================================================================
let fakeStore = {};

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key) => fakeStore[key] ?? null),
    set: vi.fn(async (key, value) => {
      fakeStore[key] = value;
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
} from "./state.js";

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
  // checkFlapping(apiName, oldStatus, newStatus)
  // FLAPPING_CONFIG: maxTransitions: 5, windowMs: 60000, lockDurationMs: 120000
  // Note: Uses module-level flappingState across calls within the test process.
  // --------------------------------------------------------------------------
  describe("checkFlapping", () => {
    it("does not trigger flapping when status is stable and unchanging", () => {
      // Stable status returns immediately without modifying transition state
      const result1 = checkFlapping("openai", "HEALTHY", "HEALTHY");
      expect(result1).toEqual({ isFlapping: false, locked: false });

      const result2 = checkFlapping("anthropic", "DOWN", "DOWN");
      expect(result2).toEqual({ isFlapping: false, locked: false });
    });

    it("triggers isFlapping: true and locked: true after 5 rapid transitions", () => {
      // Threshold is maxTransitions: 5 within 60000ms window
      // Using 'gemini' so its transition count starts clean at 0
      const transitions = [
        ["HEALTHY", "DOWN"], // transition 1
        ["DOWN", "HEALTHY"], // transition 2
        ["HEALTHY", "DOWN"], // transition 3
        ["DOWN", "HEALTHY"], // transition 4
      ];

      for (const [oldStatus, newStatus] of transitions) {
        const res = checkFlapping("gemini", oldStatus, newStatus);
        expect(res.isFlapping).toBe(false);
        expect(res.locked).toBe(false);
      }

      // 5th rapid transition reaches the threshold (maxTransitions = 5)
      const res5 = checkFlapping("gemini", "HEALTHY", "DOWN");
      expect(res5.isFlapping).toBe(true);
      expect(res5.locked).toBe(true);

      // Subsequent calls while locked return locked state
      const resLocked = checkFlapping("gemini", "DOWN", "HEALTHY");
      expect(resLocked.isFlapping).toBe(true);
      expect(resLocked.locked).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // checkRateLimit()
  // maxPerMinute: 20
  // Note: Uses module-level rateLimitState.timestamps without a reset function.
  // Ordering is deliberate: all 20 allowed requests run first, followed by the
  // 21st rejected request.
  // --------------------------------------------------------------------------
  describe("checkRateLimit", () => {
    it("allows requests up to maxPerMinute (20) and rejects subsequent requests", () => {
      const maxPerMinute = 20;

      // First 20 calls must be allowed, remaining count decreasing from 19 down to 0
      for (let i = 0; i < maxPerMinute; i++) {
        const result = checkRateLimit();
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(maxPerMinute - (i + 1));
      }

      // 21st call within the same 1-minute window should be rejected
      const rejected = checkRateLimit();
      expect(rejected.allowed).toBe(false);
      expect(rejected.remaining).toBe(0);
      expect(rejected.resetIn).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // shouldDebounce() / resetDebounce()
  // minInterval: 500ms
  // Note: Uses module-level debounceState. Calling resetDebounce() resets lastSendTime.
  // --------------------------------------------------------------------------
  describe("shouldDebounce and resetDebounce", () => {
    it("requires rapid succession calls to wait, and allows immediate call after resetDebounce", () => {
      // Ensure clean state before testing
      resetDebounce();

      // First call should not need to wait
      const firstCall = shouldDebounce();
      expect(firstCall.shouldWait).toBe(false);
      expect(firstCall.waitMs).toBe(0);

      // Second call immediately after should need to wait (< 500ms interval)
      const secondCall = shouldDebounce();
      expect(secondCall.shouldWait).toBe(true);
      expect(secondCall.waitMs).toBeGreaterThan(0);
      expect(secondCall.waitMs).toBeLessThanOrEqual(500);

      // Calling resetDebounce clears the recorded timestamp
      resetDebounce();

      // Call immediately after reset should succeed without waiting
      const afterResetCall = shouldDebounce();
      expect(afterResetCall.shouldWait).toBe(false);
      expect(afterResetCall.waitMs).toBe(0);
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
  const API_STATE_KEY = "nexus:apiState";

  beforeEach(() => {
    fakeStore = {}; // reset the fake Redis before every single test
  });

  // 1. Default state when store is empty
  it("returns default state with all providers HEALTHY and CLOSED when fakeStore is empty", async () => {
    const state = await getApiState();
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
    const res1 = await recordRequestResult("openai", false);
    expect(res1).toEqual({ transitioned: false });
    let state = await getApiState();
    expect(state.openai.consecutiveFailures).toBe(1);
    expect(state.openai.circuitState).toBe("CLOSED");

    // 2nd failure
    const res2 = await recordRequestResult("openai", false);
    expect(res2).toEqual({ transitioned: false });
    state = await getApiState();
    expect(state.openai.consecutiveFailures).toBe(2);
    expect(state.openai.circuitState).toBe("CLOSED");

    // 3rd failure: reaches failureThreshold (3)
    const res3 = await recordRequestResult("openai", false);
    expect(res3).toEqual({ transitioned: true, from: "CLOSED", to: "OPEN" });
    state = await getApiState();
    expect(state.openai.consecutiveFailures).toBe(3);
    expect(state.openai.circuitState).toBe("OPEN");
    expect(state.openai.circuitOpenedAt).toBeTypeOf("number");
    expect(state.openai.totalCircuitOpens).toBe(1);
  });

  // 3. Immediately after tripping to OPEN, requests are not allowed
  it("disallows requests immediately after tripping to OPEN because cooldown has not elapsed", async () => {
    // Trip the circuit to OPEN
    await recordRequestResult("openai", false);
    await recordRequestResult("openai", false);
    await recordRequestResult("openai", false);

    const check = await isRequestAllowed("openai");
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe("OPEN");
    expect(check.retryAfterMs).toBeGreaterThan(0);
    expect(check.retryAfterMs).toBeLessThanOrEqual(30000);
  });

  // 4. Test cooldown elapsed: transitions to HALF_OPEN and allows request
  it("transitions circuit from OPEN to HALF_OPEN and allows request after cooldown elapses", async () => {
    // Cooldown duration is 30,000ms (CIRCUIT_BREAKER_COOLDOWN_MS).
    // Directly seed fakeStore with an OPEN state opened 40,000ms ago.
    const defaultState = await getApiState();
    defaultState.openai.circuitState = "OPEN";
    defaultState.openai.circuitOpenedAt = Date.now() - 40000;
    fakeStore[API_STATE_KEY] = defaultState;

    const check = await isRequestAllowed("openai");
    expect(check.allowed).toBe(true);
    expect(check.reason).toBe("HALF_OPEN_TEST");

    // Confirm state persistence in fakeStore: now HALF_OPEN
    const state = await getApiState();
    expect(state.openai.circuitState).toBe("HALF_OPEN");
  });

  // 5. Successful call while HALF_OPEN transitions to CLOSED
  it("transitions circuit from HALF_OPEN to CLOSED on a successful request", async () => {
    const defaultState = await getApiState();
    defaultState.openai.circuitState = "HALF_OPEN";
    defaultState.openai.consecutiveFailures = 3;
    fakeStore[API_STATE_KEY] = defaultState;

    const result = await recordRequestResult("openai", true);
    expect(result).toEqual({ transitioned: true, from: "HALF_OPEN", to: "CLOSED" });

    const state = await getApiState();
    expect(state.openai.circuitState).toBe("CLOSED");
    expect(state.openai.consecutiveFailures).toBe(0);
  });

  // 6. Failed call while HALF_OPEN transitions back to OPEN
  it("transitions circuit from HALF_OPEN back to OPEN on a failed request", async () => {
    const defaultState = await getApiState();
    defaultState.openai.circuitState = "HALF_OPEN";
    defaultState.openai.totalCircuitOpens = 1;
    fakeStore[API_STATE_KEY] = defaultState;

    const result = await recordRequestResult("openai", false);
    expect(result).toEqual({ transitioned: true, from: "HALF_OPEN", to: "OPEN" });

    const state = await getApiState();
    expect(state.openai.circuitState).toBe("OPEN");
    expect(state.openai.totalCircuitOpens).toBe(2);
    expect(state.openai.circuitOpenedAt).toBeTypeOf("number");
  });

  // 7. simulateOutage, simulateDegraded, restoreApi
  it("correctly sets status and circuitState fields in simulateOutage, simulateDegraded, and restoreApi", async () => {
    // simulateOutage: DOWN, circuitState OPEN, simulatedDown true
    await simulateOutage("openai");
    let state = await getApiState();
    expect(state.openai.status).toBe("DOWN");
    expect(state.openai.circuitState).toBe("OPEN");
    expect(state.openai.simulatedDown).toBe(true);
    expect(state.openai.simulatedDegraded).toBe(false);
    expect(await getEffectiveStatus("openai")).toBe("DOWN");

    // simulateDegraded: DEGRADED, simulatedDegraded true, simulatedDown false
    await simulateDegraded("openai");
    state = await getApiState();
    expect(state.openai.status).toBe("DEGRADED");
    expect(state.openai.simulatedDegraded).toBe(true);
    expect(state.openai.simulatedDown).toBe(false);
    expect(await getEffectiveStatus("openai")).toBe("DEGRADED");

    // restoreApi: HEALTHY, circuitState CLOSED, simulated flags cleared, failures reset
    await restoreApi("openai");
    state = await getApiState();
    expect(state.openai.status).toBe("HEALTHY");
    expect(state.openai.circuitState).toBe("CLOSED");
    expect(state.openai.simulatedDown).toBe(false);
    expect(state.openai.simulatedDegraded).toBe(false);
    expect(state.openai.consecutiveFailures).toBe(0);
    expect(state.openai.circuitOpenedAt).toBeNull();
    expect(await getEffectiveStatus("openai")).toBe("HEALTHY");
  });

  // 8. getStatusCounts and getCircuitBreakerSummary
  it("correctly calculates status counts and circuit breaker summary for configured states", async () => {
    const state = await getApiState();
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
    const counts = await getStatusCounts();
    expect(counts).toEqual({ healthy: 1, degraded: 1, down: 1 });

    // Verify getCircuitBreakerSummary
    const summary = await getCircuitBreakerSummary();
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
});
