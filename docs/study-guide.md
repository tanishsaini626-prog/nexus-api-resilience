# NEXUS — Study Guide & Revision Notes

**Updated:** 2026-10-08, after Phase 15 (per-user rate limiting).

**One sentence:** NEXUS is an AI provider resilience gateway — it routes chat requests across
OpenAI, Anthropic, and Gemini, automatically failing over when one is down, using a circuit
breaker, retries with exponential backoff, and cost/latency-aware routing. Multi-user with
per-account isolation, and users bring their own provider API keys (BYOK).

---

## 0. The 30-second pitch (interview version)

"Apps that depend on AI providers break when those providers fail — outages, rate limits,
quotas, slow responses. NEXUS sits in front of three providers as a gateway. It tracks
per-provider health, retries with exponential backoff and jitter, trips a circuit breaker
after repeated failures so it stops hammering a broken provider, and reroutes to the next
healthy provider according to the selected strategy (cost or latency). State lives in Redis,
so it survives restarts and is shared correctly across serverless instances; accounts and
API keys live in Postgres behind row-level security, so every user's data is fully isolated.
Users plug in their own provider keys, so the app makes real calls without the platform
paying for usage."

---

## 1. The problem (the basics)

- An app that hardcodes one AI provider has a single point of failure. When that provider
  has a bad day, the app has a bad day.
- Naively retrying forever is worse — you hammer a struggling service and make the outage
  worse for everyone (including yourself).
- Missing piece in most hobby projects: **a layer that absorbs provider failures** so the
  user still gets an answer, or gets a clear, traceable error when truly everything is down.

NEXUS is that layer. Analogy: air-traffic control. Planes (requests) don't care which runway
(provider) they land on — the tower watches runway conditions and redirects traffic.

---

## 2. How one chat request flows (the whole system in 9 steps)

1. User types in `ChatPanel` → `POST /api/chat` with header `Authorization: Bearer <supabase JWT>`.
2. Route authenticates: `getUserFromRequest` → `supabase.auth.getUser(token)` (server-side
   revalidation — NOT `getSession()`, which trusts the client).
3. Guards: rate limit (per-user: 20/min + 200/day, Redis-backed), debounce (500ms minimum
   between sends), input validation (message required, string, ≤10,000 chars).
4. Load the user's stored provider keys from Postgres once per request (RLS-scoped to them).
5. Decide provider order from the routing mode (stored in Redis, per user):
   - `OFF` → openai → anthropic → gemini
   - `COST` → gemini (1) → anthropic (3) → openai (5) — relative cost units
   - `LATENCY` → lowest live measured latency first
6. For each provider in order: check the circuit breaker (`isRequestAllowed`). If allowed,
   attempt the call up to 4 times (1 initial + 3 retries) with exponential backoff
   (1s → 2s → 4s, capped 10s, ±20% jitter) and a 10s timeout per attempt.
7. Record every outcome (`recordRequestResult`): success resets failures; a failure counts,
   and 3 consecutive failures trip the circuit CLOSED → OPEN.
8. First success wins. The response includes `routedTo`, `retryLog`, and `circuitReason`
   (e.g. "Circuit CLOSED → OPEN") so the UI can show the whole story.
9. If every provider fails: HTTP 503 with an incident ID, the full retry log, and a
   server-side log entry with every provider's actual error.

---

## 3. The resilience engine — five concepts

### 3.1 Health states

Per provider: `HEALTHY` (fast), `DEGRADED` (latency > 500ms, or HTTP 5xx), `DOWN` (request
error), plus a `FLAPPING` lock. Health checks run every 10s from the dashboard and update
state via `updateHealthCheck`. Simulated down/degraded states override real checks.

### 3.2 Circuit breaker (the core pattern)

- `CLOSED` — normal, requests allowed.
- 3 consecutive failures → `OPEN` — requests blocked; we stop wasting time on a broken provider.
- After a 30s cooldown → `HALF_OPEN` — exactly one probe request is allowed through.
- Probe succeeds → back to `CLOSED`. Probe fails → straight back to `OPEN` for another 30s.

Analogy: the fuse box in your house. When a circuit keeps shorting, the breaker flips and
cuts power so the house doesn't burn. You don't leave it off forever — after a cooldown you
flip it once to test.

Why it matters: without this, every request pays the full retry+timeout cost against a dead
provider (in our real test: ~25 seconds of pointless retries per message). With it, requests
skip dead providers instantly and fail over.

### 3.3 Retries with exponential backoff + jitter

Attempts at ~1s, 2s, 4s delays (capped at 10s). Why the shape:

- **Backoff** — a busy service needs breathing room; retrying instantly is rude and useless.
- **Cap** — unbounded doubling would mean minute-long waits.
- **Jitter (±20%)** — if 1,000 clients all retry at exactly 1s, they stampede. Jitter spreads
  them out. (Term to know: *thundering herd*.)

### 3.4 Routing modes (the "Optimizer Agent")

`OFF` / `COST` / `LATENCY`, stored per-user in Redis. COST orders by relative token cost
(gemini 1 < anthropic 3 < openai 5). LATENCY orders by the live measured latency from health
checks. Note: in COST mode a provider with a key that fails will still be retried/tripped
before falling through — the mode changes *order*, not the failure handling.

### 3.5 Edge guards

- **Rate limit** — per-user, Redis-backed: 20 requests/min (sliding window of timestamps) plus
  a 200 requests/day cap (UTC-day counter). Chat only; other routes are auth-guarded but unlimited.
- **Debounce** — server-side 500ms minimum interval between chat sends (the client button
  disable is only a UX nicety, not real protection).
- **Flapping detection** — 5 state transitions within 60s locks the provider's state for 2
  minutes, so a provider that oscillates UP/DOWN doesn't cause status churn.
- **Incident IDs** — every error response carries `INC-2025-XXXX`, and the same ID appears in
  the server log, so a user-reported problem can be traced to exact server-side details.
- **Timeouts** — 10s per attempt via `AbortController`; a hung provider can't hang the request.

---

## 4. Infrastructure decisions (and the big lessons)

### 4.1 Redis (Upstash) — fast shared state

Circuit breaker state, routing mode, and (soon) rate limits live in Redis, not in process
memory. Two reasons: it survives server restarts, and it is shared across serverless
instances.

**THE lesson of the project:** module-level variables do NOT cross route bundles. In Next.js
dev, each API route gets its own copy of a module; on Vercel, each route is a separate
serverless function. A variable set by `/api/settings` was invisible to `/api/chat` — the
toggle appeared to work in the UI while the server kept routing as if it hadn't. Any mutable
state that two routes share must live in an external store (Redis), keyed per user.

Redis key patterns:
- `nexus:apiState:{userId}` — all provider states + circuit breakers for that user
- `nexus:optimizationMode:{userId}` — routing mode for that user
- `nexus:rateLimit:minute:{userId}` — sliding-window request timestamps (20/min limit)
- `nexus:rateLimit:day:{userId}:{YYYY-MM-DD}` — daily request counter (200/day cap)

### 4.2 Accounts & auth (Supabase)

- Users sign up / log in via Supabase Auth on `/signup` and `/login`.
- Every protected API call sends `Authorization: Bearer <access_token>`.
- The server validates with `supabase.auth.getUser(token)` — this revalidates server-side.
  `getSession()` was tried first and caused a real bug (it trusts local client state; a stale
  session logged users out across tabs).

### 4.3 Per-user isolation (Phase 13)

Every state key is namespaced by user ID. Proven with two real accounts: simulate an outage
on account A, account B sees nothing. The old shared-admin-password model (and its
`ADMIN_ACTION_SECRET`) was fully removed.

### 4.4 Postgres + Row Level Security (BYOK storage, Phase 14)

- Table `provider_keys (user_id, provider, api_key, created_at, updated_at)`, primary key
  `(user_id, provider)`.
- RLS policy: `auth.uid() = user_id` on ALL operations. The database itself enforces
  isolation — the anon API key alone can read nothing.
- The server creates a per-request Supabase client carrying the caller's own JWT, so
  Postgres evaluates RLS as that user. No service-role master key exists anywhere.
- The UI only ever sees masked tails (`••••abcd`), never full keys back.

**Lesson:** `createClient()` throws immediately if its URL is missing. Because pages/routes
import the Supabase client, every Vercel build since Phase 12 failed with
`Error: supabaseUrl is required` — the live site was silently frozen on the old version.
Lesson: "pushed" ≠ "deployed" ≠ "live". Check the deploy status.

---

## 5. Phase 14 — real AI calls via BYOK

- **Decision:** BYOK (bring your own key). Users supply provider API keys; NEXUS never pays
  for anyone's usage. Same model as OpenRouter/LiteLLM. This sidesteps billing entirely.
- **Simulation fallback kept:** no key stored → that provider runs the original simulated
  behavior. The dashboard demo (kill/slow/fix buttons, failover theater) works with zero keys.
- **The key insight:** a real provider failure is *just a failure*. A 401 (bad key), 429
  (quota/rate limit), or 5xx throws like any simulated error — and flows through the exact
  same retry → circuit breaker → failover machinery. **Zero changes were needed in the
  resilience engine itself.** That's the payoff of the earlier architecture.
- **Implementation:** `callOpenAIReal` / `callAnthropicReal` / `callGeminiReal` use `fetch`
  with the user's key; error bodies are parsed for human-readable detail; model names are
  constants at the top of `app/api/chat/route.js` (swap one line to change).
- **Verification without paying:** save a *fake* key → the real provider endpoint rejects it
  with a real 401 → proves the wiring end-to-end. Verified against OpenAI and Anthropic
  (both returned 401 with our fake keys). Then a real Gemini key returned a real answer.
  Then real quota exhaustion (429) produced a real circuit trip + failover. All verified.

---

## 6. War stories — bugs that taught the most

1. **The masking ReferenceError (Day-10 bug, found by accident).** `clearTimeout(timeoutId)`
   in the `catch` block referenced a `const` declared inside the `try` block — invisible
   because `try` and `catch` are separate scopes. Every *failed* provider attempt threw
   `ReferenceError: timeoutId is not defined`, which replaced the real provider error with
   a generic 500. It survived 20+ commits because it only fires on failure paths.
   *Lesson: error paths deserve testing as much as success paths.*
2. **Module state vs serverless.** See 4.1 — the routing-mode bug that was invisible in dev
   and silently broken in production.
3. **Zombie dev servers.** Repeated restarts left old Node processes squatting on port 3000,
   serving a stale route manifest → new API routes returned an HTML 404 page → the client's
   `response.json()` exploded with `Unexpected token '<'`. *Lesson: kill all node, restart
   once, cleanly; "works on my machine" can be "the wrong server is running".*
4. **Retired models.** Google retired `gemini-2.0-flash` mid-project; the API's own error
   named its replacement (`gemini-3.8-flash`). *Lesson: pin model names in one constant and
   let the provider's error guide the fix.*
5. **Silent failures.** The all-providers-failed path returned a 503 without logging why.
   Now it logs every provider's exact error with the incident ID, and the dashboard UI,
   DB, and server log can all be correlated. *Lesson: an undiagnosable error is a second bug.*
6. **Free-tier quota (429).** After a day of heavy testing, Gemini's free quota ran out.
   The system treated it exactly like any provider failure: retries, circuit trip, failover,
   and a clear incident report. *Lesson: quotas are a failure mode; handle them like outages.*
7. **The test that defeated itself (Phase 15 verification).** The rate-limit script paced
   requests by *response* time — with a real provider key, each request took ~9s (quota 429s,
   backoff, failover), so 25 "rapid" requests spread across 4 minutes and never put 20 inside
   the 60-second window. The limiter looked broken while working perfectly. *Lesson: when a
   test disagrees with the code, check the test's own assumptions first — pace by send time,
   not response time.*
8. **The limit that wasn't there (Phase 17d).** The limiter's six sequential Redis commands
   raced: 25 concurrent requests all counted the window before any write landed, so **25 of 25
   were admitted** — the limit simply didn't exist for parallel traffic. One Lua `EVAL` made
   the whole check-and-update atomic: exactly 20 of 25 admitted. *Lesson: read-modify-write
   over a REST API is not atomic, and "works when tested sequentially" says nothing about
   concurrency.*
9. **The env var that was never saved (Phase 17b production).** Three redeploys changed
   nothing because `NEXUS_ENCRYPTION_KEY` had never actually been saved to the Vercel project.
   `vercel env ls` revealed it in one command; a verification script that reads the raw DB row
   proved what the UI couldn't. *Lesson: verify the artifact, not the intention — "I added it"
   isn't true until something reads it back.*

---

## 7. Reference card

**API routes**
| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Parallel provider health checks + counts + circuit summary |
| `/api/chat` | POST | Routed chat with retries/circuit/failover (sim or real per key) |
| `/api/simulate` | POST | Force provider down / degraded / up / flapping demo |
| `/api/settings` | POST | Set routing mode (OFF / COST / LATENCY) |
| `/api/keys` | GET/PUT/DELETE | Manage the caller's own provider keys (masked tails only) |
| `/api/{redis,supabase,auth}-test` | GET | Diagnostic routes — safe to delete (cleanup pending) |

**Config numbers** — degraded >500ms; 3 failures → OPEN; 30s cooldown; retries 1s/2s/4s
(cap 10s, ±20% jitter); 10s timeout/attempt; rate limit 20/min + 200/day per user (Redis);
500ms debounce; flap lock 5/60s → 2min.

**Env vars** — `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. (`ADMIN_ACTION_SECRET` is dead.)

**Commands** — `npm run dev` / `test` / `lint` / `build`. Tests: Vitest, 15 tests in
`app/lib/state.test.js`, Redis mocked with an in-memory fake store.

**Gotchas** — PowerShell's `curl` is `Invoke-WebRequest` (use `Invoke-RestMethod`); zombie
Node processes squat on port 3000; LF→CRLF git warnings are harmless.

---

## 8. Demo script (portfolio / interview)

1. **Dashboard tour** — health cards, circuit states, latency chart, event log, retry config.
2. **Simulated outage** — Simulate → Kill OpenAI → watch events, failover, recovery.
3. **Real AI call** — COST mode + real Gemini key → genuine AI answer (routedTo: gemini).
4. **The fake-key trick** — save `sk-fake-...` for OpenAI/Anthropic, send in OFF mode →
   real 401s from real providers → retry log theater → circuit trips → failover to Gemini.
   *(Proves the gateway works against real internet failures with zero cost.)*
5. **Flapping demo** — spam Kill/Fix → provider state locks, event log shows it.
6. **Incident traceability** — trigger an error, take the INC id, `grep` it in the server log.

---

## 9. Roadmap & open items

- ✅ Phases 1–9 (original roadmap; Phase 7 tests now pass), 12–14 (auth, isolation, BYOK+real calls).
- ✅ **Phase 15 — per-user rate limits/quotas**: `checkRateLimit` is now Redis-backed and
  per-user — 20/min sliding window + 200/day cap, scoped to chat. Remaining globals:
  debounce, flapping, lastKnownHealth (revisit in a later phase).
- ⬜ Phase 16 — billing (optional; BYOK makes it skippable).
- ⬜ Phase 17 — production hardening: encrypt keys at rest, atomic Redis ops (Lua), batch
  Redis reads (health endpoint does ~9 commands per poll — matters on free tier), remove
  diagnostic routes.
- ⬜ Phase 10 docs / 11 interview prep — deferred until the product stabilizes.
- Open items: Gemini free-tier quota (new key in a NEW Google project, or wait for reset);
  delete the fake keys from the dashboard when done demoing. (Cleanup done: dead admin secret
  removed; diagnostic test routes deleted.)

---

## 10. Glossary

- **API gateway** — a single entry point in front of multiple backend services; routes,
  guards, and observes traffic.
- **Circuit breaker** — a failure-isolation pattern: closed (normal) → open (blocked) →
  half-open (test one request). Named after the electrical fuse.
- **Exponential backoff** — increasing wait between retries (1s, 2s, 4s…).
- **Jitter** — small random variation added to delays to avoid synchronized retries.
- **Thundering herd** — many clients retrying simultaneously and overwhelming a service.
- **Serverless function** — a stateless, independently deployed unit; no shared memory
  between invocations or between different functions. (Hence Redis.)
- **JWT** — JSON Web Token; a signed token proving who the user is; sent as a Bearer header.
- **RLS (Row Level Security)** — Postgres enforcing per-row access rules at the database
  level using the caller's identity, independent of application code.
- **BYOK** — Bring Your Own Key; users supply their own provider credentials.
- **Health states** — HEALTHY / DEGRADED / DOWN / FLAPPING, based on latency, status codes,
  and errors.
