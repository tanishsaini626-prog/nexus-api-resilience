import { getEffectiveStatus, isRequestAllowed, recordRequestResult, getApiState, getRetryConfig, getRetryDelay } from "../../lib/state";

// Helper: Sleep for given milliseconds
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.message) return Response.json({ error: "Message required" }, { status: 400 });

    const config = getRetryConfig();
    let routedTo = null;
    let response = null;
    let circuitReason = null;
    let retryLog = [];

    // ============================================
    // TRY OPENAI (with retries)
    // ============================================
    const openaiStatus = getEffectiveStatus("openai");
    const openaiCircuit = isRequestAllowed("openai");

    if (openaiStatus !== "DOWN" && openaiCircuit.allowed) {
      for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
          response = await callOpenAI(body.message);
          recordRequestResult("openai", true);
          if (attempt > 0) {
            retryLog.push({ attempt: attempt + 1, api: "openai", success: true, delay: attempt > 0 ? getRetryDelay(attempt - 1) + "ms" : "0ms" });
          }
          routedTo = "openai";
          break; // Success! Stop retrying
        } catch (error) {
          const failResult = recordRequestResult("openai", false);
          if (failResult.transitioned) {
            circuitReason = "Circuit " + failResult.from + " → " + failResult.to;
          }

          if (attempt < config.maxRetries) {
            // Retry with backoff
            const delay = getRetryDelay(attempt);
            retryLog.push({ attempt: attempt + 1, api: "openai", success: false, delay: delay + "ms", error: error.message });
            await sleep(delay);
          } else {
            // All retries exhausted
            retryLog.push({ attempt: "exhausted", api: "openai", success: false, error: "Max retries reached" });
            routedTo = null;
            break;
          }
        }
      }
    } else if (!openaiCircuit.allowed) {
      circuitReason = "OpenAI circuit " + openaiCircuit.reason;
    }

    // ============================================
    // TRY ANTHROPIC (with retries)
    // ============================================
    if (!routedTo) {
      const anthropicStatus = getEffectiveStatus("anthropic");
      const anthropicCircuit = isRequestAllowed("anthropic");

      if (anthropicStatus !== "DOWN" && anthropicCircuit.allowed) {
        if (!circuitReason) circuitReason = "OpenAI failed, using Anthropic";

        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
          try {
            response = await callAnthropic(body.message);
            recordRequestResult("anthropic", true);
            if (attempt > 0) {
              retryLog.push({ attempt: attempt + 1, api: "anthropic", success: true, delay: attempt > 0 ? getRetryDelay(attempt - 1) + "ms" : "0ms" });
            }
            routedTo = "anthropic";
            break;
          } catch (error) {
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

    if (!routedTo) {
      return Response.json({ error: "All APIs unavailable after retries", circuitReason, retryLog }, { status: 503 });
    }

    return Response.json({
      message: response,
      routedTo,
      routedAt: new Date().toISOString(),
      circuitReason,
      retryLog,
      apiStatus: getEffectiveStatus(routedTo),
      circuitState: getApiState()[routedTo].circuitState,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function callOpenAI(msg) {
  // Simulate: 70% chance of success, 30% chance of failure (for retry demo)
  // Remove this random failure in production!
  if (getApiState().openai.status === "DOWN") throw new Error("API is down");
  
  if (Math.random() < 0.3) {
    throw new Error("Transient error: Connection reset");
  }
  
  await sleep(150);
  return "[OpenAI GPT-4o] Received: \"" + msg + "\"";
}

async function callAnthropic(msg) {
  if (getApiState().anthropic.status === "DOWN") throw new Error("API is down");
  await sleep(200);
  return "[Anthropic Claude] Received: \"" + msg + "\"";
}