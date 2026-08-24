"use client";

export default function OptimizerControls({ optimizationMode = "OFF", setOptimizationMode, fetchHealth }) {
  const toggleOptimizationMode = async (mode) => {
    if (setOptimizationMode) setOptimizationMode(mode);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (fetchHealth) fetchHealth(); // refresh immediately
    } catch (error) {
      console.error("Failed to toggle optimization:", error);
    }
  };

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Optimizer Agent</h2>
        <div className="flex-1 h-px bg-zinc-800/50"></div>
      </div>
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200 mb-1">Routing Strategy</h3>
          <p className="text-xs text-zinc-500">
            {optimizationMode === "OFF" && "Static failover (OpenAI → Anthropic → Gemini)"}
            {optimizationMode === "COST" && "Routing to cheapest available provider (Gemini → Anthropic → OpenAI)"}
            {optimizationMode === "LATENCY" && "Routing to the provider with the lowest live latency"}
          </p>
        </div>
        <div className="flex bg-zinc-950 border border-zinc-800 rounded-lg p-1">
          <button 
            onClick={() => toggleOptimizationMode("OFF")}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${optimizationMode === "OFF" ? "bg-zinc-800 text-zinc-200 shadow" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            OFF
          </button>
          <button 
            onClick={() => toggleOptimizationMode("COST")}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${optimizationMode === "COST" ? "bg-emerald-900/40 text-emerald-400 shadow border border-emerald-500/20" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            COST
          </button>
          <button 
            onClick={() => toggleOptimizationMode("LATENCY")}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${optimizationMode === "LATENCY" ? "bg-blue-900/40 text-blue-400 shadow border border-blue-500/20" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            LATENCY
          </button>
        </div>
      </div>
    </div>
  );
}
