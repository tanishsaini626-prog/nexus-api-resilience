"use client";

const getStatusBg = (status) => {
  if (status === "HEALTHY") return "bg-emerald-500/10 text-emerald-400";
  if (status === "DEGRADED") return "bg-amber-500/10 text-amber-400";
  if (status === "DOWN") return "bg-red-500/10 text-red-400";
  if (status === "FAILOVER") return "bg-cyan-500/10 text-cyan-400";
  if (status === "FLAPPING") return "bg-orange-500/10 text-orange-400";
  return "bg-zinc-500/10 text-zinc-400";
};

const getCardBorder = (status) => {
  if (status === "DOWN") return "border-red-500/30 bg-red-500/5";
  if (status === "DEGRADED") return "border-amber-500/30 bg-amber-500/5";
  if (status === "FLAPPING") return "border-orange-500/30 bg-orange-500/5";
  return "border-zinc-800/50 hover:border-zinc-700/50";
};

const getIconStyle = (status, base) => {
  if (status === "DOWN") return { bg: "bg-red-500/10", text: "text-red-400" };
  if (status === "DEGRADED") return { bg: "bg-amber-500/10", text: "text-amber-400" };
  if (status === "FLAPPING") return { bg: "bg-orange-500/10", text: "text-orange-400" };
  return { bg: `bg-${base}-500/10`, text: `text-${base}-400` };
};

const getCircuitColor = (state) => {
  if (state === "CLOSED") return "bg-emerald-500";
  if (state === "OPEN") return "bg-red-500";
  if (state === "HALF_OPEN") return "bg-amber-500";
  return "bg-zinc-600";
};

const getCircuitTextColor = (state) => {
  if (state === "CLOSED") return "text-emerald-400";
  if (state === "OPEN") return "text-red-400";
  if (state === "HALF_OPEN") return "text-amber-400";
  return "text-zinc-500";
};

const getCircuitBg = (state) => {
  if (state === "CLOSED") return "bg-emerald-500/10 border-emerald-500/20";
  if (state === "OPEN") return "bg-red-500/10 border-red-500/20";
  if (state === "HALF_OPEN") return "bg-amber-500/10 border-amber-500/20";
  return "bg-zinc-800/30 border-zinc-700/30";
};

export default function StatusGrid({ data, loading = !data }) {
  const cb = data?.circuitBreaker;

  return (
    <>
      {/* OpenAI Card */}
      <div className={`bg-zinc-900/50 border rounded-xl p-5 transition-all duration-300 ${getCardBorder(data?.openai?.status)}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${getIconStyle(data?.openai?.status, "emerald").bg}`}>
              <span className={`text-xs font-bold ${getIconStyle(data?.openai?.status, "emerald").text}`}>OA</span>
            </div>
            <div>
              <div className="text-sm font-semibold">OpenAI</div>
              <div className="text-[10px] text-zinc-600">GPT-4o API</div>
            </div>
          </div>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${getStatusBg(data?.openai?.status)}`}>
            {loading ? "..." : data?.openai?.status || "..."}
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-zinc-600 mb-2">
          <span>Latency</span>
          <span className="font-mono tabular-nums">{loading ? "—" : data?.openai?.latency ? `${data.openai.latency}ms` : "—"}</span>
        </div>
        <div className={`flex items-center justify-between text-[10px] rounded-lg px-2.5 py-2 ${getCircuitBg(cb?.openai?.state)}`}>
          <span className="text-zinc-500">Circuit</span>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${getCircuitColor(cb?.openai?.state)}`}></div>
            <span className={`font-medium ${getCircuitTextColor(cb?.openai?.state)}`}>
              {cb?.openai?.state || "CLOSED"}
            </span>
          </div>
        </div>
      </div>

      {/* Anthropic Card */}
      <div className={`bg-zinc-900/50 border rounded-xl p-5 transition-all duration-300 ${getCardBorder(data?.anthropic?.status)}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${getIconStyle(data?.anthropic?.status, "violet").bg}`}>
              <span className={`text-xs font-bold ${getIconStyle(data?.anthropic?.status, "violet").text}`}>AN</span>
            </div>
            <div>
              <div className="text-sm font-semibold">Anthropic</div>
              <div className="text-[10px] text-zinc-600">Claude API</div>
            </div>
          </div>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${getStatusBg(data?.anthropic?.status)}`}>
            {loading ? "..." : data?.anthropic?.status || "..."}
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-zinc-600 mb-2">
          <span>Latency</span>
          <span className="font-mono tabular-nums">{loading ? "—" : data?.anthropic?.latency ? `${data.anthropic.latency}ms` : "—"}</span>
        </div>
        <div className={`flex items-center justify-between text-[10px] rounded-lg px-2.5 py-2 ${getCircuitBg(cb?.anthropic?.state)}`}>
          <span className="text-zinc-500">Circuit</span>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${getCircuitColor(cb?.anthropic?.state)}`}></div>
            <span className={`font-medium ${getCircuitTextColor(cb?.anthropic?.state)}`}>
              {cb?.anthropic?.state || "CLOSED"}
            </span>
          </div>
        </div>
      </div>

      {/* Gemini Card */}
      <div className={`bg-zinc-900/50 border rounded-xl p-5 transition-all duration-300 ${getCardBorder(data?.gemini?.status)}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${getIconStyle(data?.gemini?.status, "blue").bg}`}>
              <span className={`text-xs font-bold ${getIconStyle(data?.gemini?.status, "blue").text}`}>GE</span>
            </div>
            <div>
              <div className="text-sm font-semibold">Google Gemini</div>
              <div className="text-[10px] text-zinc-600">Gemini API</div>
            </div>
          </div>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${getStatusBg(data?.gemini?.status)}`}>
            {loading ? "..." : data?.gemini?.status || "..."}
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-zinc-600 mb-2">
          <span>Latency</span>
          <span className="font-mono tabular-nums">{loading ? "—" : data?.gemini?.latency ? `${data.gemini.latency}ms` : "—"}</span>
        </div>
        <div className={`flex items-center justify-between text-[10px] rounded-lg px-2.5 py-2 ${getCircuitBg(cb?.gemini?.state)}`}>
          <span className="text-zinc-500">Circuit</span>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${getCircuitColor(cb?.gemini?.state)}`}></div>
            <span className={`font-medium ${getCircuitTextColor(cb?.gemini?.state)}`}>
              {cb?.gemini?.state || "CLOSED"}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
