export async function GET() {
  const results = {};

  try {
    const openaiStart = Date.now();
    const response = await fetch("https://api.openai.com/", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    results.openai = {
      status: "UP",
      latency: Date.now() - openaiStart,
      statusCode: response.status,
    };
  } catch (error) {
    results.openai = {
      status: "DOWN",
      latency: null,
      error: error.message,
    };
  }

  try {
    const anthropicStart = Date.now();
    const response = await fetch("https://api.anthropic.com/", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    results.anthropic = {
      status: "UP",
      latency: Date.now() - anthropicStart,
      statusCode: response.status,
    };
  } catch (error) {
    results.anthropic = {
      status: "DOWN",
      latency: null,
      error: error.message,
    };
  }

  results.checkedAt = new Date().toISOString();

  return Response.json(results);
}