import { setOptimizationMode, getOptimizationMode } from "../../lib/state";

export async function POST(request) {
  try {
    const body = await request.json();
    const { mode } = body;

    if (["OFF", "COST", "LATENCY"].includes(mode)) {
      setOptimizationMode(mode);
    }

    return Response.json({
      success: true,
      optimizationMode: getOptimizationMode(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}
