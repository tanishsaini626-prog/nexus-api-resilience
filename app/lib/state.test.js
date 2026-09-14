import { describe, it, expect } from "vitest";
import {
  getRetryDelay,
  checkFlapping,
  checkRateLimit,
  shouldDebounce,
  resetDebounce,
  generateIncidentId,
} from "./state.js";

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
