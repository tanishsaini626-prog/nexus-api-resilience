export async function GET() {
  const startTime = Date.now();
  const results = {};

  // ============================================
  // CHECK OPENAI
  // ============================================
  try {
    const openaiStart = Date.now();
    
    // We use the base URL, not /v1/models
    // This will return 404, but 404 = server is ALIVE
    const response = await fetch("https://api.openai.com/", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    
    const openaiLatency = Date.now() - openaiStart;
    
    // KEY INSIGHT: If we got ANY response, server is reachable
    // 200, 404, 401, 500 = all mean server is UP
    // Only "no response at all" means DOWN
    results.openai = {
      status: "UP",
      latency: openaiLatency,
      statusCode: response.status,
      note: response.ok ? "Healthy" : `Responded with ${response.status} (but reachable)`,
    };
  } catch (error) {
    // No response at all = truly DOWN
    results.openai = {
      status: "DOWN",
      latency: null,
      statusCode: null,
      error: error.message,
      note: "Cannot reach server at all",
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
    
    const anthropicLatency = Date.now() - anthropicStart;
    
    results.anthropic = {
      status: "UP",
      latency: anthropicLatency,
      statusCode: response.status,
      note: response.ok ? "Healthy" : `Responded with ${response.status} (but reachable)`,
    };
  } catch (error) {
    results.anthropic = {
      status: "DOWN",
      latency: null,
      statusCode: null,
      error: error.message,
      note: "Cannot reach server at all",
    };
  }

  // ============================================
  // METADATA
  // ============================================
  results.checkedAt = new Date().toISOString();
  results.totalTime = Date.now() - startTime;
  results.nextCheckIn = "10 seconds";

  return Response.json(results);
}