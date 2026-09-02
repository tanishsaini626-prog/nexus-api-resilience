import { redis } from "../../lib/redis";

export async function GET() {
  try {
    await redis.set("nexus:connection-test", new Date().toISOString());
    const value = await redis.get("nexus:connection-test");
    return Response.json({ connected: true, value });
  } catch (error) {
    return Response.json({ connected: false, error: error.message }, { status: 500 });
  }
}
