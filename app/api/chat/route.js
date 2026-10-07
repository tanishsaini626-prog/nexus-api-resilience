import { getEffectiveStatus, isRequestAllowed, recordRequestResult, getApiState, getRetryConfig, getRetryDelay, checkRateLimit, shouldDebounce, generateIncidentId, getOptimizationMode, API_COSTS } from "../../lib/state";
import { getUserFromRequest } from "../../lib/auth";
import { getProviderKeys } from "../../lib/keys";

const CHAT_REQUEST_TIMEOUT_MS = 10000;
// Free-tier model (Google AI Studio). Swap the string to change models —
// no other code depends on it. (2.0-flash was retired server-side; the API
// itself named 3.8-flash as its replacement.)
const GEMINI_MODEL = "gemini-3.8-flash";
// Cheapest-tier models for the other two providers. These are unverified
// defaults — no key exists to test against yet. If a provider retires one,
// its API error names the replacement (as Gemini's 404 did above), and the
// fix is this one line.
const OPENAI_MODEL = "gpt-4o-mini";
const ANTHROPIC_MODEL = "claude-3-5-haiku-latest";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function POST(request) {
  const { user, token, error } = await getUserFromRequest(request);
  if (!user) {
    return Response.json(
      { error: error || "Unauthorized", incidentId: generateIncidentId() },
      { status: 401 }
    );
  }

  try {
    // EDGE CASE: Rate limiting (per-user, Redis-backed sliding window)
    const rateCheck = await checkRateLimit(user.id);
    if (!rateCheck.allowed) {
      return Response.json({
        error: rateCheck.reason === "daily"
          ? "Daily limit reached (200 messages/day)"
          : "Rate limit exceeded (20 messages/minute)",
        incidentId: generateIncidentId(),
        retryAfter: Math.ceil(rateCheck.resetIn / 1000),
      }, { status: 429 });
    }

    // EDGE CASE: Debounce check
    const debounceCheck = shouldDebounce();
    if (debounceCheck.shouldWait) {
      return Response.json({
        error: "Please slow down and wait a moment before sending another message",
        incidentId: generateIncidentId(),
        retryAfter: Math.ceil(debounceCheck.waitMs / 1000) || 1,
      }, { status: 429 });
    }

    const body = await request.json();
    
    // EDGE CASE: Input validation
    if (!body.message) {
      return Response.json({ error: "Message is required", incidentId: generateIncidentId() }, { status: 400 });
    }
    if (typeof body.message !== "string") {
      return Response.json({ error: "Message must be a string", incidentId: generateIncidentId() }, { status: 400 });
    }
    if (body.message.length > 10000) {
      return Response.json({ error: "Message too long (max 10000 chars)", incidentId: generateIncidentId() }, { status: 400 });
    }

    const config = getRetryConfig();
    let routedTo = null;
    let response = null;
    let circuitReason = null;
    let retryLog = [];

    // BYOK: fetch this user's stored provider keys once per request. A
    // provider without a key runs in simulation mode; a failed key lookup
    // also falls back to simulation (never blocks chat).
    const keys = (await getProviderKeys(token)) || {};

    // Try OpenAI with retries
    const openaiStatus = await getEffectiveStatus(user.id, "openai");
    // Optimizer Agent Routing Logic
    const optimizationMode = await getOptimizationMode(user.id);
    let providers = ["openai", "anthropic", "gemini"];
    const state = await getApiState(user.id);

    if (optimizationMode === "COST") {
      providers.sort((a, b) => API_COSTS[a] - API_COSTS[b]);
    } else if (optimizationMode === "LATENCY") {
      providers.sort((a, b) => (state[a].latency || 9999) - (state[b].latency || 9999));
    }

    const callFn = {
      openai: callOpenAI,
      anthropic: callAnthropic,
      gemini: callGemini
    };

    for (const api of providers) {
      if (routedTo) break;

      const apiStatus = await getEffectiveStatus(user.id, api);
      const circuit = await isRequestAllowed(user.id, api);

      if (apiStatus !== "DOWN" && circuit.allowed) {
        if (!circuitReason && api !== providers[0]) {
          circuitReason = "Primary failed, using " + api;
        }

        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
          // Declared outside try because the catch block must also clear it:
          // a const inside the try block is invisible to catch (block
          // scoping), which made every failed attempt throw a masking
          // ReferenceError instead of recording the real provider error.
          let timeoutId = null;
          try {
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS);

            response = await callFn[api](user.id, body.message, controller.signal, keys);
            clearTimeout(timeoutId);
            await recordRequestResult(user.id, api, true);
            
            if (attempt > 0) {
              retryLog.push({ attempt: attempt + 1, api, success: true, delay: getRetryDelay(attempt - 1) + "ms" });
            }
            routedTo = api;
            break;
          } catch (error) {
            clearTimeout(timeoutId);
            
            const failResult = await recordRequestResult(user.id, api, false);
            if (failResult.transitioned && !circuitReason) {
              circuitReason = "Circuit " + failResult.from + " → " + failResult.to;
            }
            
            if (error.name === "AbortError") {
              retryLog.push({ attempt: attempt + 1, api, success: false, delay: "10000ms", error: "Request timeout (10s)" });
            } else {
              retryLog.push({ attempt: attempt + 1, api, success: false, delay: getRetryDelay(attempt) + "ms", error: error.message });
            }

            if (attempt < config.maxRetries) {
              const delay = getRetryDelay(attempt);
              await sleep(delay);
            } else {
              retryLog.push({ attempt: "exhausted", api, success: false, error: "Max retries reached" });
              break;
            }
          }
        }
      } else if (!circuit.allowed && !circuitReason) {
        circuitReason = api + " circuit " + circuit.reason;
      }
    }

    if (!routedTo && !circuitReason) {
      circuitReason = "All circuits blocked or APIs down";
    }

    // EDGE CASE: All APIs failed
    if (!routedTo) {
      const incidentId = generateIncidentId();
      // The client only shows the summary line; log per-attempt details so
      // the incident is diagnosable from the server log afterwards.
      console.error(`Chat ${incidentId} — all providers failed:`, JSON.stringify(retryLog));
      return Response.json({
        error: "All APIs unavailable after retries",
        incidentId,
        circuitReason,
        retryLog,
        retryConfig: { maxRetries: config.maxRetries, baseDelay: config.baseDelay + "ms", maxDelay: config.maxDelay + "ms" },
      }, { status: 503 });
    }

    const finalState = await getApiState(user.id);

    return Response.json({
      message: response,
      routedTo,
      routedAt: new Date().toISOString(),
      circuitReason,
      retryLog,
      apiStatus: await getEffectiveStatus(user.id, routedTo),
      circuitState: finalState[routedTo].circuitState,
    });
  } catch (error) {
    // Log the real cause — returning "Internal server error" without logging
    // made 500s undiagnosable from the terminal.
    console.error("Chat route error:", error);
    return Response.json({
      error: "Internal server error",
      message: error.message,
      incidentId: generateIncidentId(),
    }, { status: 500 });
  }
}

async function callOpenAI(userId, msg, signal, keys) {
  // SIM mode: no key stored — original simulated behavior so the failover
  // demo works with zero keys configured.
  if (!keys?.openai) {
    if ((await getApiState(userId)).openai.status === "DOWN") throw new Error("API is down");
    if (signal?.aborted) throw new Error("Request timeout");
    if (Math.random() < 0.3) throw new Error("Transient error: Connection reset");
    await sleep(150);
    return "[OpenAI GPT-4o] Received: \"" + msg + "\"";
  }
  return callOpenAIReal(keys.openai, msg, signal);
}

async function callOpenAIReal(apiKey, msg, signal) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: "user", content: msg }],
    }),
    signal,
  });

  if (!response.ok) {
    // Any failure — bad key (401), rate limit (429), provider 5xx — becomes a
    // normal thrown error, so the existing retry + circuit-breaker pipeline
    // reacts to real provider failures exactly like simulated ones.
    let detail = "";
    try {
      const errBody = await response.json();
      detail = errBody?.error?.message || "";
    } catch {
      // non-JSON error body — status code alone is still useful
    }
    throw new Error(`OpenAI API error ${response.status}${detail ? ": " + detail : ""}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned no content");
  return text;
}

async function callAnthropic(userId, msg, signal, keys) {
  // SIM mode: no key stored — original simulated behavior.
  if (!keys?.anthropic) {
    if ((await getApiState(userId)).anthropic.status === "DOWN") throw new Error("API is down");
    if (signal?.aborted) throw new Error("Request timeout");
    await sleep(200);
    return "[Anthropic Claude] Received: \"" + msg + "\"";
  }
  return callAnthropicReal(keys.anthropic, msg, signal);
}

async function callAnthropicReal(apiKey, msg, signal) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: msg }],
    }),
    signal,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const errBody = await response.json();
      detail = errBody?.error?.message || "";
    } catch {
      // non-JSON error body — status code alone is still useful
    }
    throw new Error(`Anthropic API error ${response.status}${detail ? ": " + detail : ""}`);
  }

  const data = await response.json();
  const text = (data?.content || [])
    .map((block) => block.text)
    .filter(Boolean)
    .join("");
  if (!text) throw new Error("Anthropic returned no content");
  return text;
}

async function callGemini(userId, msg, signal, keys) {
  // SIM mode: no key stored — keep the original simulated behavior so the
  // dashboard's failover demo works with zero keys configured.
  if (!keys?.gemini) {
    if ((await getApiState(userId)).gemini.status === "DOWN") throw new Error("API is down");
    if (signal?.aborted) throw new Error("Request timeout");
    await sleep(180);
    return "[Google Gemini] Received: \"" + msg + "\"";
  }
  return callGeminiReal(keys.gemini, msg, signal);
}

async function callGeminiReal(apiKey, msg, signal) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: msg }] }] }),
      signal,
    }
  );

  if (!response.ok) {
    // Any failure — bad key (403), rate limit (429), provider 5xx — becomes a
    // normal thrown error, so the existing retry + circuit-breaker pipeline
    // reacts to real provider failures exactly like simulated ones.
    let detail = "";
    try {
      const errBody = await response.json();
      detail = errBody?.error?.message || "";
    } catch {
      // non-JSON error body — status code alone is still useful
    }
    throw new Error(`Gemini API error ${response.status}${detail ? ": " + detail : ""}`);
  }

  const data = await response.json();
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text)
    .filter(Boolean)
    .join("");
  if (!text) throw new Error("Gemini returned no content");
  return text;
}