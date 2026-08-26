export function getStatusBg(status) {
  if (status === "HEALTHY") return "bg-emerald-500/10 text-emerald-400";
  if (status === "DEGRADED") return "bg-amber-500/10 text-amber-400";
  if (status === "DOWN") return "bg-red-500/10 text-red-400";
  if (status === "FAILOVER") return "bg-cyan-500/10 text-cyan-400";
  if (status === "FLAPPING") return "bg-orange-500/10 text-orange-400";
  return "bg-zinc-500/10 text-zinc-400";
}
