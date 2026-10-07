# NEXUS — AI Provider Resilience Gateway

**A gateway that keeps AI features alive when providers fail.**

NEXUS routes chat requests across **OpenAI, Anthropic, and Gemini**, automatically failing over
using a **circuit breaker**, **retries with exponential backoff**, and **cost/latency-aware
routing** — with per-user state isolation, per-user rate limits, and bring-your-own-key (BYOK)
real provider calls.

🔗 **Live demo:** https://nexus-api-resilience.vercel.app

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Upstash Redis](https://img.shields.io/badge/Upstash-Redis-00E9A3?logo=redis&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20Postgres-3ECF8E?logo=supabase&logoColor=white)
![Tests](https://img.shields.io/badge/tests-17%20passing-6E9F18?logo=vitest&logoColor=white)

> Sign up, optionally add your own provider key, and watch the failover engine work. With no keys
> configured, every provider runs in **simulation mode**, so the whole resilience demo is free.

---

## Why this exists

Any app that ships an AI feature inherits its provider's worst day: outages, rate limits, quota
exhaustion, slow responses. Retrying naively makes it worse — you hammer a struggling service.

NEXUS sits in front of multiple providers and absorbs those failures:

- A dead provider is detected and **skipped instantly** instead of costing every request a timeout.
- Failures are isolated with a **circuit breaker**, so a broken provider recovers on its own.
- Traffic is rerouted to the healthiest or cheapest provider according to the selected strategy.
- When *everything* is down, the client gets a clear, traceable error (with an incident ID) —
  never a hang and never a fake success.

---

## Features

| | |
|---|---|
| **Circuit breaker** | 3 consecutive failures → `OPEN`; 30s cooldown → `HALF_OPEN` probe → `CLOSED` or back to `OPEN` |
| **Retries** | 3 retries with exponential backoff (1s → 2s → 4s, capped at 10s) plus ±20% jitter |
| **Timeout guard** | 10s per attempt via `AbortController` — a hung provider can't hang the request |
| **Routing strategies** | `OFF` (fixed order), `COST` (cheapest first), `LATENCY` (fastest measured first) |
| **Health states** | `HEALTHY` / `DEGRADED` (>500ms or 5xx) / `DOWN`, refreshed every 10s |
| **Flapping detection** | A provider oscillating up/down gets its state locked for 2 minutes |
| **Per-user isolation** | Every piece of state is namespaced by user ID; proven with multiple accounts |
| **BYOK** | Users store their own provider keys — the platform never pays for usage |
| **Rate limiting** | Per user: 20 requests/min (sliding window) + 200/day, enforced in Redis |
| **Observability** | Incident IDs (`INC-2025-XXXX`) correlate the UI, the API response, and server logs |
| **Simulation fallback** | No key stored → that provider simulates, so demos need no credentials |

---

## Architecture

```mermaid
flowchart LR
    UI["Browser dashboard<br/>(Next.js client)"] -->|"Bearer JWT"| API["API routes<br/>(Next.js server)"]
    API -->|"per-user state<br/>circuit breaker · routing mode · rate limits"| R[("Upstash Redis")]
    API -->|"JWT + Row Level Security"| PG[("Supabase Postgres<br/>provider keys")]
    API -->|"BYOK key, or simulated"| P1["OpenAI"]
    API --> P2["Anthropic"]
    API --> P3["Google Gemini"]
    AUTH["Supabase Auth"] -.->|"JWT validation"| API
```

**Request flow for `POST /api/chat`:**

1. Validate the Supabase JWT (`auth.getUser(token)` — server-side revalidation).
2. Guard: per-user rate limit → debounce → input validation.
3. Load the caller's own provider keys from Postgres (RLS-scoped).
4. Order providers according to the caller's routing mode.
5. For each provider: check the circuit breaker, then attempt the call up to 4 times
   (1 + 3 retries) with backoff, jitter, and a 10s timeout per attempt.
6. Record every outcome — success resets the failure count, failures trip the breaker.
7. First success wins, and the response carries the full story (`routedTo`, `retryLog`,
   `circuitReason`).
8. All providers failed → `503` with an incident ID and every provider's real error logged.

### The circuit breaker

```mermaid
stateDiagram-v2
    [*] --> CLOSED
    CLOSED --> OPEN: 3 consecutive failures
    OPEN --> HALF_OPEN: after 30s cooldown
    HALF_OPEN --> CLOSED: probe succeeds
    HALF_OPEN --> OPEN: probe fails
```

The point is *not* wasting time: without the breaker, a request to a dead provider pays the full
retry-and-backoff cost (in testing: ~25 seconds). With it, the dead provider is skipped instantly
and the request fails over.

---

## Bring your own key (BYOK)

Keys are stored in Postgres with **Row Level Security**: the policy
`auth.uid() = user_id` means the database itself rejects any row access that doesn't belong to the
authenticated user. The server builds a per-request Supabase client carrying the caller's own JWT —
**there is no service-role master key anywhere in the app**, and the UI only ever receives masked
tails (`••••abcd`).

> **The key design insight:** a real provider failure is just a failure. A `401` (bad key), `429`
> (quota/rate limit), or `5xx` throws like any simulated error and flows through the *same* retry →
> circuit-breaker → failover machinery. Adding real provider integrations required **zero changes**
> to the resilience engine.

---

## Tech stack

- **Next.js 16** (App Router, Turbopack) + **React 19**
- **Tailwind CSS 4** — dark dashboard UI
- **Recharts** — live latency chart
- **Upstash Redis** — circuit breaker state, routing mode, rate limits (shared across serverless
  instances and surviving restarts)
- **Supabase** — Auth (JWT) + Postgres with RLS (provider keys)
- **Vitest** — unit tests with a mocked Redis
- **Vercel** — deployment (auto-deploys from `main`)

---

## Getting started

```bash
git clone https://github.com/tanishsaini626-prog/nexus-api-resilience.git
cd nexus-api-resilience
npm install
cp .env.example .env.local   # then fill in the four values below
```

**Environment variables**

```bash
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

**Database setup** — create the keys table + RLS policy by running
[`supabase/provider_keys.sql`](supabase/provider_keys.sql) in the Supabase SQL Editor.

**Run**

```bash
npm run dev      # http://localhost:3000
npm test         # Vitest (17 tests)
npm run lint
npm run build
```

Then sign up, and either add a provider key in the **API Keys** panel or leave it empty to stay in
simulation mode.

---

## API reference

All routes require `Authorization: Bearer <supabase access token>`.

| Route | Method | Purpose |
|---|---|---|
| `/api/chat` | `POST` | Routed chat with retries, circuit breaker, and failover |
| `/api/health` | `GET` | Parallel provider health checks, status counts, circuit summary |
| `/api/keys` | `GET` / `PUT` / `DELETE` | Manage the caller's own provider keys (masked tails only) |
| `/api/settings` | `POST` | Set routing mode (`OFF` / `COST` / `LATENCY`) |
| `/api/simulate` | `POST` | Force a provider `down` / `degraded` / `up` for demos |

---

## Engineering notes (bugs that taught the most)

- **Module state doesn't cross serverless routes.** The routing mode was a module variable, so
  `/api/settings` wrote it and `/api/chat` never saw it — invisible in dev, silently broken in
  production. Fix: any state two routes share lives in Redis, keyed per user.
- **`try` and `catch` are separate scopes.** `clearTimeout(timeoutId)` in a `catch` referencing a
  `const` from the `try` threw a masking `ReferenceError` on *every failed attempt*, replacing real
  provider errors with a generic 500. It survived 20+ commits because it only fires on failure
  paths.
- **"Pushed" ≠ "deployed" ≠ "live."** Every Vercel build had been failing (a Supabase URL read at
  build time was missing from the environment), leaving the live site frozen on an old version.
- **Real-world failures are the best tests.** A retired model name (`gemini-2.0-flash` → the API's
  own error named its replacement) and a free-tier quota `429` both exercised the retry, circuit
  breaker, and failover paths against real infrastructure.
- **Undiagnosable errors are a second bug.** The all-providers-failed path now logs every
  provider's exact error alongside the incident ID shown to the user.

See [`docs/study-guide.md`](docs/study-guide.md) for the full deep-dive.

---

## Limitations & next steps

- Health checks ping providers' public endpoints (latency + status); they are not authenticated
  model calls.
- Provider keys are protected by RLS but **stored unencrypted** — encryption at rest is planned.
- Circuit-breaker and rate-limiter updates use read-modify-write Redis patterns with a documented
  small race window; a Lua script would make them atomic.
- `debounce`, `flapping`, and `lastKnownHealth` are still process-global (not yet per-user).
- The health poll makes ~10–12 Redis calls every 10s per open dashboard; batching them is the next
  performance win.
- OpenAI and Anthropic success paths are wired and error-verified, but only exercised with real
  keys once a funded key is available.

---

## Roadmap

- [x] Circuit breaker, retries with backoff/jitter, health states, failover
- [x] Redis-backed shared state (survives restarts, works across serverless instances)
- [x] Supabase auth + per-user data isolation
- [x] BYOK real provider calls (OpenAI, Anthropic, Gemini) with simulation fallback
- [x] Per-user rate limiting (sliding window + daily cap)
- [ ] Batch the health-check Redis reads (~10 calls/poll → ~2)
- [ ] Encrypt provider keys at rest (AES-256-GCM)
- [ ] Atomic Redis operations (Lua) for breaker and limiter
- [ ] Move remaining global guards (debounce, flapping) to per-user state

---

## License

No license specified — all rights reserved by the author.
