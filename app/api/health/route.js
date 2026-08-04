import { updateHealthCheck, getApiState, getStatusCounts, getConfig } from "../../lib/state";

export async function GET() {
  const startTime = Date.now();
  const state = getApiState();
  const config = getConfig();
  const results = {};

  // ============================================
  // CHECK OPENAI
  // ============================================
  try {
    const openaiStart = Date.now();
    const response = await fetch("https://api.openai.com/", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - openaiStart;

    // Only update if NOT simulated
    if (!state.openai.simulatedDown && !state.openai.simulatedDegraded) {
      updateHealthCheck("openai", {
        latency: latency,
        statusCode: response.status,
        wasError: false,
      });
    }

    results.openai = {
      status: state.openai.status,
      latency: latency,
      statusCode: response.status,
      wasError: false,
    };
  } catch (error) {
    if (!state.openai.simulatedDown && !state.openai.simulatedDegraded) {
      updateHealthCheck("openai", {
        latency: null,
        statusCode: null,
        wasError: true,
      });
    }

    results.openai = {
      status: state.openai.status,
      latency: null,
      statusCode: null,
      wasError: true,
      error: error.message,
    };
  }

  // ============================================
  // CHECK ANTHROPIC
  // ============================================
  try {
    const anthropicStart = Date.now();
    const response = await fetch("https://api.anthropic.com/", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - anthropicStart;

    if (!state.anthropic.simulatedDown && !state.anthropic.simulatedDegraded) {
      updateHealthCheck("anthropic", {
        latency: latency,
        statusCode: response.status,
        wasError: false,
      });
    }

    results.anthropic = {
      status: state.anthropic.status,
      latency: latency,
      statusCode: response.status,
      wasError: false,
    };
  } catch (error) {
    if (!state.anthropic.simulatedDown && !state.anthropic.simulatedDegraded) {
      updateHealthCheck("anthropic", {
        latency: null,
        statusCode: null,
        wasError: true,
      });
    }

    results.anthropic = {
      status: state.anthropic.status,
      latency: null,
      statusCode: null,
      wasError: true,
      error: error.message,
    };
  }

  // ============================================
  // METADATA
  // ============================================
  const counts = getStatusCounts();
  results.checkedAt = new Date().toISOString();
  results.totalTime = Date.now() - startTime;
  results.config = {
    degradedThreshold: config.degradedThreshold + "ms",
  };
  results.statusCounts = counts;

  return Response.json(results);
}