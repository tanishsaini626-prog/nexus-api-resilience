// scripts/verify-prod-encryption.mjs
// Answers one question: is the LIVE deployment encrypting provider keys before
// they reach the database?
//
// Usage (from the repo root, after adding NEXUS_ENCRYPTION_KEY on Vercel and redeploying):
//   node --env-file=.env.local scripts/verify-prod-encryption.mjs <email> <password>
//
// To check a local dev server instead of production:
//   NEXUS_LIVE_URL=http://localhost:3000 node --env-file=.env.local scripts/verify-prod-encryption.mjs <email> <password>
//
// What it does, in order:
//   1. Signs in to your Supabase project (the same project the live site uses).
//   2. Reads which provider keys you already have, straight from Postgres
//      (RLS lets you read your own rows) so nothing is overwritten silently.
//   3. Saves a throwaway test key through the LIVE site's /api/keys.
//   4. Reads the raw stored value back and checks whether it starts with
//      "enc:v1:" (encrypted) or is the plaintext key.
//   5. Puts your account back exactly as it was — byte-for-byte if it had to
//      borrow an occupied slot.

const [, , email, password] = process.argv;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const LIVE = (process.env.NEXUS_LIVE_URL || "https://nexus-api-resilience.vercel.app").replace(/\/+$/, "");
const TEST_KEY = "sk-nexus-encryption-verify-not-a-real-key";
const PROVIDERS = ["openai", "anthropic", "gemini"];

const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { console.log("  FAIL  " + m); process.exitCode = 1; };
const step = (m) => console.log("\n> " + m);

// NOTE: this script deliberately never calls process.exit(). Exiting while fetch
// sockets are still open trips a libuv assertion on Windows, so it sets
// process.exitCode and returns instead.
async function main() {
  let token = null;

  // Read/write your own rows directly, bypassing the app, so the script can
  // inspect (and later restore) exactly what is stored.
  async function readRows() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/provider_keys?select=provider,api_key,updated_at`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`could not read provider_keys: HTTP ${res.status} ${await res.text()}`);
    return res.json();
  }

  async function restoreRawValue(provider, rawValue) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/provider_keys?provider=eq.${provider}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${token}`, Prefer: "return=minimal" },
      body: JSON.stringify({ api_key: rawValue }),
    });
    return res.status;
  }

  // --- 1. sign in ----------------------------------------------------------
  step(`Signing in as ${email}`);
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const auth = await authRes.json();
  if (!auth.access_token) {
    bad("login failed: " + JSON.stringify(auth).slice(0, 200));
    console.error("  Check the email/password (and confirm the account's email if confirmation is on).");
    return;
  }
  token = auth.access_token;
  console.log("  signed in OK");

  const authedHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // --- 2. see what's already stored ----------------------------------------
  step("Reading your currently stored keys");
  const before = await readRows();
  for (const row of before) {
    const raw = String(row.api_key);
    const kind = raw.startsWith("enc:v1:") ? "encrypted" : "PLAINTEXT (legacy row)";
    console.log(`  ${row.provider.padEnd(9)} ${kind.padEnd(22)} stored prefix: ${raw.slice(0, 8)}...`);
  }
  if (before.length === 0) console.log("  (no keys stored yet)");

  // --- pick a slot ---------------------------------------------------------
  const freeProvider = PROVIDERS.find((p) => !before.some((r) => r.provider === p));
  const borrowedRow = freeProvider ? null : before.find((r) => r.provider === "openai") || before[0];
  const target = freeProvider || borrowedRow.provider;
  const originalRaw = borrowedRow ? String(borrowedRow.api_key) : null;

  if (borrowedRow) {
    console.log(`\n  All providers have keys, so the test will temporarily use "${target}"`);
    console.log("  and restore its original value byte-for-byte afterwards.");
  } else {
    console.log(`\n  Using the free slot "${target}" — your existing keys are untouched.`);
  }

  // --- 3. save a test key through the LIVE site ----------------------------
  step(`Saving a throwaway key through ${LIVE}`);
  const putRes = await fetch(`${LIVE}/api/keys`, {
    method: "PUT",
    headers: authedHeaders,
    body: JSON.stringify({ provider: target, apiKey: TEST_KEY }),
  });
  const putBody = await putRes.json().catch(() => ({}));
  console.log(`  HTTP ${putRes.status} ${JSON.stringify(putBody)}`);

  let verdict;
  if (!putRes.ok) {
    bad("the live site refused to save the key — cannot verify encryption");
    verdict = "inconclusive";
  } else {
    // --- 4. inspect what was actually stored ------------------------------
    step("Checking what was actually written to the database");
    const after = await readRows();
    const stored = String(after.find((r) => r.provider === target)?.api_key ?? "");
    console.log(`  stored value: ${stored.slice(0, 16)}... (length ${stored.length})`);

    if (stored.startsWith("enc:v1:")) {
      ok("encryption is ACTIVE — the row is AES-256-GCM ciphertext, not your key");
      verdict = "encrypted";
    } else if (stored === TEST_KEY) {
      bad("the key was stored in PLAINTEXT — NEXUS_ENCRYPTION_KEY is not active on this deployment");
      console.error("  Usual cause: the variable is missing on Vercel, or it was added after the");
      console.error("  current deployment was built (env changes need a new deployment).");
      verdict = "plaintext";
    } else {
      bad(`unexpected stored format: ${stored.slice(0, 40)}`);
      verdict = "inconclusive";
    }
  }

  // --- 5. put everything back ----------------------------------------------
  step("Restoring your account");
  if (originalRaw === null) {
    const delRes = await fetch(`${LIVE}/api/keys`, {
      method: "DELETE",
      headers: authedHeaders,
      body: JSON.stringify({ provider: target }),
    });
    console.log(`  deleted the test row (HTTP ${delRes.status})`);
  } else {
    const status = await restoreRawValue(target, originalRaw);
    console.log(`  restored "${target}" to its exact previous value (HTTP ${status})`);
  }

  const finalRows = await readRows();
  console.log(`  keys stored now: ${finalRows.length ? finalRows.map((r) => r.provider).join(", ") : "(none)"}`);

  console.log("\n" + "=".repeat(62));
  if (verdict === "encrypted") {
    console.log("RESULT: production key encryption is working. Nothing left to do.");
  } else if (verdict === "plaintext") {
    console.log("RESULT: encryption is NOT active yet. Add NEXUS_ENCRYPTION_KEY on Vercel");
    console.log("(Production + Preview), redeploy, and run this script again.");
  } else {
    console.log("RESULT: inconclusive — read the messages above.");
  }
  console.log("=".repeat(62));
}

if (!email || !password) {
  console.error("Usage: node --env-file=.env.local scripts/verify-prod-encryption.mjs <email> <password>");
  process.exitCode = 1;
} else {
  try {
    await main();
  } catch (err) {
    console.error("\n  ERROR: " + err.message);
    process.exitCode = 1;
  }
}
