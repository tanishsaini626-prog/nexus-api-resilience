# NEXUS — Roadmap to Completion

**Definition of "complete":** the engineering is hardened, the presentation is polished, and you can
explain every design decision out loud. That's it — this project is functionally done today; what
remains is hardening and packaging.

Estimated remaining effort: **~15–20 hours**, spread across a few sessions.

---

## Step 0 — finish tonight's loose ends (~30 min)

- [ ] Verify rate limiting: with `npm run dev` running and no keys saved (SIM mode), run
      `node --env-file=.env.local scripts/rate-limit-test.mjs <email> <password>`
      — expect requests #21+ to return `429 Rate limit exceeded`.
- [ ] Create a **new Gemini key in a NEW Google project** (fresh free quota immediately), or wait
      for the daily reset (~12:30 PM IST) and reuse the existing one.
- [ ] Delete the fake OpenAI/Anthropic keys from the dashboard (they cost ~25s per message while
      present).
- [ ] Remove the leftover `ADMIN_ACTION_SECRET` from **Vercel** → Project → Settings →
      Environment Variables (it's already gone from the repo).
- [ ] Add **`NEXUS_ENCRYPTION_KEY`** to Vercel env vars (copy the value from `.env.local`) and
      redeploy — this switches on key encryption in production (Phase 17b).

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

**Still to do on your side:** add `NEXUS_ENCRYPTION_KEY` to **Vercel** env vars (copy the line from
`.env.local`) and redeploy — without it, production stores keys unencrypted with a warning.

### 17c. Move the last global guards to per-user state — ~1–2h

`debounce`, `flapping`, and `lastKnownHealth` are still module-level, so one user's traffic can
affect another's. Same pattern as `optimizationMode`: Redis keys of the form
`nexus:{feature}:{userId}`.

### 17d. Atomic Redis operations with Lua — ~2–3h (advanced, optional)

The circuit breaker and rate limiter use read-modify-write, which has a small race window under
concurrent requests. A Lua script (`redis.eval`) makes check-and-update atomic.

Worth doing mainly because it's excellent interview material — it shows you can identify a
concurrency hazard and reason about the fix.

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
      - What's NOT production-ready yet? (health checks are unauthenticated pings, global guards
        remain process-wide, no Lua atomicity, single env var for key encryption — pick honestly
        from the Limitations list in the README)

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
| Docs | README, `docs/study-guide.md`, `supabase/provider_keys.sql` |
| Tests | 29 Vitest tests, plus real-Redis integration verification of the limiter and the batching |
