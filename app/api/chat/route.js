import { getEffectiveStatus, isRequestAllowed, recordRequestResult, getApiState, getRetryConfig, getRetryDelay, checkRateLimit, shouldDebounce, generateIncidentId } from "../../lib/state";

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
    const openaiStatus = getEffectiveStatus("openai");
    const openaiCircuit = isRequestAllowed("openai");

    if (openaiStatus !== "DOWN" && openaiCircuit.allowed) {
      for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
          // EDGE CASE: Request timeout (don't wait forever)
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second hard timeout
          
          response = await callOpenAI(body.message, controller.signal);
          clearTimeout(timeoutId);
          recordRequestResult("openai", true);
          
          if (attempt > 0) {
            retryLog.push({ attempt: attempt + 1, api: "openai", success: true, delay: getRetryDelay(attempt - 1) + "ms" });
          }
          routedTo = "openai";
          break;
        } catch (error) {
          clearTimeout(timeoutId); // Clear timeout if we failed before it
          
          const failResult = recordRequestResult("openai", false);
          if (failResult.transitioned) {
            circuitReason = "Circuit " + failResult.from + " → " + failResult.to;
          }
          if (error.name === "AbortError") {
            retryLog.push({ attempt: attempt + 1, api: "openai", success: false, delay: "10000ms", error: "Request timeout (10s)" });
          } else {
            retryLog.push({ attempt: attempt + 1, api: "openai", success: false, delay: getRetryDelay(attempt) + "ms", error: error.message });
          }

          if (attempt < config.maxRetries) {
            const delay = getRetryDelay(attempt);
            await sleep(delay);
          } else {
            retryLog.push({ attempt: "exhausted", api: "openai", success: false, error: "Max retries reached" });
            routedTo = null;
            break;
          }
        }
      }
    } else if (!openaiCircuit.allowed) {
      circuitReason = "OpenAI circuit " + openaiCircuit.reason;
    }

    // Try Anthropic with retries
    if (!routedTo) {
      const anthropicStatus = getEffectiveStatus("anthropic");
      const anthropicCircuit = isRequestAllowed("anthropic");

      if (anthropicStatus !== "DOWN" && anthropicCircuit.allowed) {
        if (!circuitReason) circuitReason = "OpenAI failed, using Anthropic";

        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            response = await callAnthropic(body.message, controller.signal);
            clearTimeout(timeoutId);
            recordRequestResult("anthropic", true);
            
            if (attempt > 0) {
              retryLog.push({ attempt: attempt + 1, api: "anthropic", success: true, delay: getRetryDelay(attempt - 1) + "ms" });
            }
            routedTo = "anthropic";
            break;
          } catch (error) {
            clearTimeout(timeoutId);
            recordRequestResult("anthropic", false);
            if (attempt < config.maxRetries) {
              const delay = getRetryDelay(attempt);
              retryLog.push({ attempt: attempt + 1, api: "anthropic", success: false, delay: delay + "ms", error: error.message });
              await sleep(delay);
            } else {
              retryLog.push({ attempt: "exhausted", api: "anthropic", success: false, error: "Max retries reached" });
              routedTo = null;
              break;
            }
          }
        }
      } else if (!circuitReason) {
        circuitReason = "Both circuits blocked";
      }
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

    const state = getApiState();
    return Response.json({
      message: response,
      routedTo,
      routedAt: new Date().toISOString(),
      circuitReason,
      retryLog,
      apiStatus: getEffectiveStatus(routedTo),
      circuitState: state[routedTo].circuitState,
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
  if (getApiState().openai.status === "DOWN") throw new Error("API is down");
  if (signal?.aborted) throw new Error("Request timeout");
  if (Math.random() < 0.3) throw new Error("Transient error: Connection reset");
  await sleep(150);
  return "[OpenAI GPT-4o] Received: \"" + msg + "\"";
}

async function callAnthropic(msg, signal) {
  if (getApiState().anthropic.status === "DOWN") throw new Error("API is down");
  if (signal?.aborted) throw new Error("Request timeout");
  await sleep(200);
  return "[Anthropic Claude] Received: \"" + msg + "\"";
}