// scripts/rate-limit-test.mjs
// Fires 25 chat requests against the local dev server to verify per-user rate
// limiting: request #21+ within a minute should return 429 "Rate limit exceeded".
//
// Sends are paced by SEND time (one every --interval ms, default 700), not by
// response time — with a real provider key, a single request can take ~9s
// (quota 429s + retry backoff + failover), and pacing by response would spread
// 25 requests across 4 minutes, never putting 20 inside the 60s window. 700ms
// also stays above the server's 500ms per-user debounce so any 429 you see is
// the rate limiter, not the debouncer.
//
// Usage (from the repo root, with `npm run dev` running):
//   node --env-file=.env.local scripts/rate-limit-test.mjs <email> <password> [intervalMs=700]

const [, , email, password, intervalArg] = process.argv;
if (!email || !password) {
  console.error("Usage: node --env-file=.env.local scripts/rate-limit-test.mjs <email> <password> [intervalMs=700]");
  process.exit(1);
}
const INTERVAL_MS = Number(intervalArg) || 700;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CHAT_URL = "http://localhost:3000/api/chat";

const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const auth = await authRes.json();
if (!auth.access_token) {
  console.error("Login failed:", JSON.stringify(auth).slice(0, 300));
  process.exit(1);
}
console.log(`Logged in. Firing 25 chat requests, one every ${INTERVAL_MS}ms (send-paced)...\n`);

const token = auth.access_token;
const started = Date.now();

const jobs = [];
for (let i = 1; i <= 25; i++) {
  // Schedule each send at a fixed offset so slow responses never stretch the burst.
  jobs.push(
    (async () => {
      await new Promise((r) => setTimeout(r, (i - 1) * INTERVAL_MS));
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: `rate limit test ${i}` }),
      });
      const body = await res.json().catch(() => ({}));
      const sent = ((Date.now() - started) / 1000).toFixed(1);
      if (res.status === 200) {
        console.log(`#${String(i).padStart(2)}  t+${sent}s  200 OK (routed to ${body.routedTo})`);
        return "ok";
      }
      if (res.status === 429) {
        console.log(`#${String(i).padStart(2)}  t+${sent}s  429 ${body.error}`);
        return "limited";
      }
      console.log(`#${String(i).padStart(2)}  t+${sent}s  ${res.status} ${body.error || "unknown"}`);
      return "other";
    })()
  );
}

const results = await Promise.all(jobs);
const ok = results.filter((r) => r === "ok").length;
const limited = results.filter((r) => r === "limited").length;
const other = results.filter((r) => r === "other").length;

console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`allowed: ${ok}   429-limited: ${limited}   other: ${other}`);
console.log(
  limited > 0
    ? "SUCCESS: per-user rate limit is working (blocked after the first 20 in the minute)."
    : "No 429s seen — make sure the dev server is running, and note the limiter needs 20+ sends inside 60s (lower --interval if needed)."
);
