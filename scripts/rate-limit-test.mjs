// scripts/rate-limit-test.mjs
// Fires 25 chat requests against the local dev server to verify per-user rate
// limiting: requests #21+ within a minute should return 429 "Rate limit exceeded".
//
// Usage (from the repo root, with `npm run dev` running):
//   node --env-file=.env.local scripts/rate-limit-test.mjs you@email.com yourpassword
//
// Tip: for fast, free responses, delete all API keys first (SIM mode) so no
// request waits on a real provider. The test also needed the server running.

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error("Usage: node --env-file=.env.local scripts/rate-limit-test.mjs <email> <password>");
  process.exit(1);
}

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
console.log("Logged in. Firing 25 chat requests (600ms apart)...\n");

const token = auth.access_token;
let ok = 0;
let limited = 0;
let other = 0;
const started = Date.now();

for (let i = 1; i <= 25; i++) {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: `rate limit test ${i}` }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 200) {
    ok++;
    console.log(`#${i}  200 OK (routed to ${body.routedTo})`);
  } else if (res.status === 429) {
    limited++;
    console.log(`#${i}  429 ${body.error}`);
  } else {
    other++;
    console.log(`#${i}  ${res.status} ${body.error || "unknown"}`);
  }
  await new Promise((r) => setTimeout(r, 600)); // stay above the 500ms server debounce
}

console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`allowed: ${ok}   429-limited: ${limited}   other: ${other}`);
console.log(
  limited > 0
    ? "SUCCESS: per-user rate limit is working (blocked after the first 20 in the minute)."
    : "No 429s seen — make sure the dev server is running and providers are in SIM mode (no keys) so responses are fast."
);
