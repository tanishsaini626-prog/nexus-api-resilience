import { getEffectiveStatus, isRequestAllowed, recordRequestResult, getApiState, getRetryConfig, getRetryDelay, checkRateLimit, shouldDebounce, generateIncidentId, getOptimizationMode, API_COSTS } from "../../lib/state";

const CHAT_REQUEST_TIMEOUT_MS = 10000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function POST(request) {
  try {
    // EDGE CASE: Rate limiting
    const rateCheck = checkRateLimit();
    if (!rateCheck.allowed) {
      return Response.json({
        error: "Rate limit exceeded",
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

    // Try OpenAI with retries
    const openaiStatus = await getEffectiveStatus("openai");
    // Optimizer Agent Routing Logic
    const optimizationMode = getOptimizationMode();
    let providers = ["openai", "anthropic", "gemini"];
    const state = await getApiState();

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

      const apiStatus = await getEffectiveStatus(api);
      const circuit = await isRequestAllowed(api);

      if (apiStatus !== "DOWN" && circuit.allowed) {
        if (!circuitReason && api !== providers[0]) {
          circuitReason = "Primary failed, using " + api;
        }

        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS);
            
            response = await callFn[api](body.message, controller.signal);
            clearTimeout(timeoutId);
            await recordRequestResult(api, true);
            
            if (attempt > 0) {
              retryLog.push({ attempt: attempt + 1, api, success: true, delay: getRetryDelay(attempt - 1) + "ms" });
            }
            routedTo = api;
            break;
          } catch (error) {
            clearTimeout(timeoutId);
            
            const failResult = await recordRequestResult(api, false);
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
      return Response.json({
        error: "All APIs unavailable after retries",
        incidentId,
        circuitReason,
        retryLog,
        retryConfig: { maxRetries: config.maxRetries, baseDelay: config.baseDelay + "ms", maxDelay: config.maxDelay + "ms" },
      }, { status: 503 });
    }

    const finalState = await getApiState();

    return Response.json({
      message: response,
      routedTo,
      routedAt: new Date().toISOString(),
      circuitReason,
      retryLog,
      apiStatus: await getEffectiveStatus(routedTo),
      circuitState: finalState[routedTo].circuitState,
    });
  } catch (error) {
    return Response.json({
      error: "Internal server error",
      message: error.message,
      incidentId: generateIncidentId(),
    }, { status: 500 });
  }
}

async function callOpenAI(msg, signal) {
  if ((await getApiState()).openai.status === "DOWN") throw new Error("API is down");
  if (signal?.aborted) throw new Error("Request timeout");
  if (Math.random() < 0.3) throw new Error("Transient error: Connection reset");
  await sleep(150);
  return "[OpenAI GPT-4o] Received: \"" + msg + "\"";
}

async function callAnthropic(msg, signal) {
  if ((await getApiState()).anthropic.status === "DOWN") throw new Error("API is down");
  if (signal?.aborted) throw new Error("Request timeout");
  await sleep(200);
  return "[Anthropic Claude] Received: \"" + msg + "\"";
}

async function callGemini(msg, signal) {
  if ((await getApiState()).gemini.status === "DOWN") throw new Error("API is down");
  if (signal?.aborted) throw new Error("Request timeout");
  await sleep(180);
  return "[Google Gemini] Received: \"" + msg + "\"";
}