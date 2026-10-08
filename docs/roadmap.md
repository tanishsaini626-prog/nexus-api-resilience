# NEXUS — Roadmap to Completion

**Definition of "complete":** the engineering is hardened, the presentation is polished, and you can
explain every design decision out loud. That's it — this project is functionally done today; what
remains is hardening and packaging.

Estimated remaining effort: **~15–20 hours**, spread across a few sessions.

---

## Step 0 — finish tonight's loose ends (~30 min)

- [x] Verify rate limiting — done, twice. First run exposed a flaw in the *test*: pacing by
      response time let ~9s provider latency spread 25 requests over 4 minutes, never putting 20
      inside the 60s window. The script now paces by send time (700ms apart); request #21+ then
      returned `429 Rate limit exceeded (20 messages/minute)` exactly as designed.
- [ ] Optional: create a **new Gemini key in a NEW Google project** if the current one is still
      hitting free-tier quota limits.
- [x] Delete the fake OpenAI/Anthropic keys from the dashboard — done (only the real Gemini key
      remains).
- [x] Remove the leftover `ADMIN_ACTION_SECRET` from **Vercel** — done (Production + Preview).
- [x] Add **`NEXUS_ENCRYPTION_KEY`** to Vercel and redeploy — done, and verified against the
      deployed site (see 17b).

---

## Phase 17 — Production hardening (the real remaining engineering)

### 17a. Batch the health-check Redis reads — ✅ DONE (15 → 3 commands per poll, measured)

**Problem:** every 10 seconds, each open dashboard made ~10–12 Redis round-trips.

**Fix (shipped):** `applyHealthCheck()`, `computeStatusCounts()` and `computeCircuitBreakerSummary()`
are now pure functions over an in-memory state object, plus a `saveApiState()` writer. `/api/health`
reads state once, probes all three providers against that one object concurrently, and writes once.
The old Redis-backed signatures remain as thin wrappers, so nothing else changed.

**Measured against real Upstash** with a counting proxy wrapped around the client: **15 → 3 commands
per poll (80% fewer)**, verified by re-reading the persisted state. Bonus: the three concurrent
per-provider read-modify-write cycles on one key are gone, removing a race that could lose updates.

### 17b. Encrypt provider keys at rest — ✅ DONE (AES-256-GCM)

**Problem:** keys were protected by RLS but stored as plaintext. A database dump would expose them.

**Fix (shipped):** `app/lib/crypto.js` encrypts with AES-256-GCM and a fresh random IV per row
(`enc:v1:` prefix). `PUT /api/keys` encrypts; `getProviderKeys()` decrypts. Rows without the prefix
are legacy plaintext and pass through, so existing keys keep working. An unreadable row (rotated key)
fails only itself — that provider drops to simulation and the dashboard shows `UNREADABLE`.

**Tradeoff, documented in the README:** rotating or losing `NEXUS_ENCRYPTION_KEY` makes existing rows
unreadable — that's the point of encryption, but it has to be said out loud.

**How it was verified (end to end, against production):** the live deployment was rebuilt with the
variable set, a throwaway key was saved through the deployed site and read back out of Postgres as
`enc:v1:` ciphertext, and the existing Gemini key was then re-saved through the app and read back
via `GET /api/keys` — proving both encryption *and* decryption work on production with a real key.

**One design note learned the hard way:** the variable had never actually been saved to the Vercel
project (three redeploys changed nothing because there was nothing to pick up). `scripts/verify-prod-encryption.mjs`
is the check that finally proved it, and the Vercel CLI (`vercel env ls`) is what revealed the truth
in one command — worth reaching for before a fourth redeploy.

### 17c. Move the last global guards to per-user state — ✅ DONE

`debounce`, `flapping`, and `lastKnownHealth` were module-level, so one user's traffic could affect
another's. All three are now scoped per user — with three deliberately different mechanisms:

- **`flapping`** moved *inside* the per-user `apiState` object (`state[api].flapping`), so it's
  per-user and per-provider at **zero extra Redis cost** — the health poll already reads and writes
  that object once. (This is how it should work: the counter is part of the state, not a side table.)
- **`debounce`** moved to Redis (`nexus:debounce:{userId}`) with a 60s TTL, because the chat route
  doesn't otherwise read state and a cross-instance double-send is exactly what it exists to stop.
- **`lastKnownHealth`** stayed in module memory but is now **keyed by user** — and that's a design
  decision, not an omission: the cache exists for when the health computation throws, *including
  Redis being unreachable*, so storing it in Redis would defeat its purpose. Per-instance and
  best-effort is the correct trade-off.

**Verified:** the flapping counter persisting inside `apiState` and the debounce key's real
number/TTL/per-user isolation were both confirmed against real Upstash, not just the mock.

### 17d. Atomic Redis operations with Lua — ✅ DONE for the rate limiter (breaker deliberately not Lua-ized)

**The measured bug:** the limiter's JS flow was six sequential REST commands (zrem → zcard → incr →
expire → zadd → expire). Fired 25 times concurrently against real Upstash, every request counted
the window before any `zadd` landed: **25 of 25 admitted** — the limit didn't exist for parallel
traffic.

**The fix (shipped):** `checkRateLimit` now runs as ONE Lua `EVAL` (`NEXUS_RATE_LIMIT_V1` in
`app/lib/state.js`) — cleanup, both limit checks, both writes and the TTL in a single sequential,
isolated execution. Same 25-request race after the change: **exactly 20 admitted, 5 blocked with
`reason: "minute"`, stored window size 20.** Daily cap (200) re-verified through the script too.
Bonus: each chat request's limiter cost dropped from 6 Redis commands to 1. Also verified
end-to-end through the running app: `scripts/rate-limit-test.mjs` returns 429s from #21 exactly as
before.

**Why the circuit breaker was NOT Lua-ized — a scope call worth explaining in interviews:** the
breaker's state is one JSON blob written from several JS paths (record result, simulate, health
poll, admission gate). Making only the admission gate atomic doesn't compose — JS writers would
still race with it — and its remaining races are self-healing: a duplicate HALF_OPEN probe or an
extra counted failure changes the outcome nothing. Full atomicity means Lua for *every* writer or
RedisJSON + transactions; the honest state is documented in the README's Limitations section.

---

## Phase 10 — Presentation (2–4h)

- [ ] **Add a dashboard screenshot or GIF to the README** — the single biggest visual upgrade.
      (Record a short screen capture of: kill a provider → watch retries/circuit/failover.)
- [ ] Set the GitHub **repo description** and **topics**: `nextjs`, `redis`, `circuit-breaker`,
      `resilience`, `supabase`, `byok`, `ai-gateway`, `upstash`.
- [ ] Pin the repo on your GitHub profile.
- [ ] Optional: custom domain on Vercel.

---

## Phase 11 — Interview prep (3–5h, spread over a few sittings)

- [ ] **Numbers cold:** 3 failures → OPEN; 30s cooldown; 3 retries at 1s/2s/4s (cap 10s, ±20%
      jitter); 10s timeout; >500ms = DEGRADED; 20/min + 200/day per user.
- [ ] **Draw the flow from memory:** client → JWT → guards → keys → routing order → per-provider
      retry/circuit → response. (60 seconds, on a whiteboard.)
- [ ] **Rehearse the six war stories** (see `docs/study-guide.md` §6) — each as
      *symptom → diagnosis → fix → lesson*.
- [ ] **Prepare the likely questions:**
      - Why Redis instead of in-memory state? (serverless + restarts + shared state)
      - Why a circuit breaker instead of just retries? (stop wasting time, let it recover)
      - Why BYOK? (no billing, matches OpenRouter/LiteLLM, real calls)
      - How do you isolate users? (namespaced keys + Postgres RLS, no service key)
      - What's the biggest bug you hit and how did you find it? (the masking `ReferenceError`)
      - What would break at 1000× scale? (races → Lua, batching, provider quotas, sharding)
      - What's NOT production-ready yet? (health checks are unauthenticated pings, breaker state
        updates are still read-modify-write by design, single env var for key encryption — pick
        honestly from the Limitations list in the README)

---

## Explicitly closed — decided *not* to do

- **Phase 16, billing** — skipped. BYOK means the platform never pays for provider usage, so
  there's nothing to bill for. Keeping it closed is a deliberate design decision, not an omission.
- **Streaming responses, multi-turn memory, team/org accounts** — nice-to-have features, not part
  of "complete". Only add if a specific opportunity calls for them.

---

## What's already done (for reference)

| | |
|---|---|
| Phases 1–9 | Stability, architecture, API, Redis state, security, frontend, testing, deployment |
| Phases 12–13 | Supabase auth, per-user isolation (proven with two accounts) |
| Phase 14 | BYOK: key storage + real OpenAI/Anthropic/Gemini calls + simulation fallback |
| Phase 15 | Per-user rate limiting: 20/min sliding window + 200/day cap |
| Phase 17a | Batched health poll: 15 → 3 Redis commands per poll (measured on real Upstash) |
| Phase 17b | Provider keys encrypted at rest (AES-256-GCM, versioned format, legacy rows readable) |
| Phase 17c | Per-user flapping, debounce, crash-recovery cache (verified on real Upstash) |
| Phase 17d | Atomic rate limiter via Lua EVAL: 25/25 concurrent admitted → exactly 20 |
| Docs | README, `docs/study-guide.md`, `supabase/provider_keys.sql` |
| Tests | 35 Vitest tests, plus real-Redis integration verification of the limiter, batching, guards and Lua atomicity |
