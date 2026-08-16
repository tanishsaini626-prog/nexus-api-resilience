"use client";

import { useState, useEffect, useRef } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// Defined at module scope (not inside Home) so React doesn't recreate this
// component function on every render. Takes `threshold` as a prop instead of
// closing over `data`, since it no longer has access to Home's local state.
const CustomTooltip = ({ active, payload, label, threshold }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl">
        <p className="text-zinc-400 mb-1.5 font-medium">{label}</p>
        <p className="text-emerald-400">OpenAI: {payload[0]?.value}ms</p>
        <p className="text-violet-400">Anthropic: {payload[1]?.value}ms</p>
        <p className="text-blue-400">Gemini: {payload[2]?.value}ms</p>
        <div className="border-t border-zinc-700 mt-1.5 pt-1.5">
          <p className="text-zinc-500">Threshold: {threshold || "500ms"}</p>
        </div>
      </div>
    );
  }
  return null;
};

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [latencyHistory, setLatencyHistory] = useState([]);
  const logRef = useRef(null);

  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [lastRoutedTo, setLastRoutedTo] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [failoverFlash, setFailoverFlash] = useState(false);
  const [rateLimitCount, setRateLimitCount] = useState(null);
  const [rateLimitReset, setRateLimitReset] = useState(0);
  const [optimizationMode, setOptimizationMode] = useState("OFF");

  const fetchHealth = async () => {
    try {
      const response = await fetch("/api/health");
      const result = await response.json();
      setData(result);
      setLoading(false);

      const timestamp = new Date(result.checkedAt).toLocaleTimeString();

      const newEvents = [
        {
          id: Date.now() + "-gemini",
          time: timestamp,
          api: "Gemini",
          status: result.gemini?.status,
          latency: result.gemini?.latency,
          circuitState: result.circuitBreaker?.gemini?.state,
          flapping: result.gemini?.flapping,
        },
        {
          id: Date.now() + "-anthropic",
          time: timestamp,
          api: "Anthropic",
          status: result.anthropic?.status,
          latency: result.anthropic?.latency,
          circuitState: result.circuitBreaker?.anthropic?.state,
          flapping: result.anthropic?.flapping,
        },
        {
          id: Date.now() + "-openai",
          time: timestamp,
          api: "OpenAI",
          status: result.openai?.status,
          latency: result.openai?.latency,
          circuitState: result.circuitBreaker?.openai?.state,
          flapping: result.openai?.flapping,
        },
      ];

      setEvents((prev) => [...newEvents, ...prev].slice(0, 50));

      const newLatencyPoint = {
        time: timestamp,
        openai: result.openai?.latency || 0,
        anthropic: result.anthropic?.latency || 0,
        gemini: result.gemini?.latency || 0,
      };

      setLatencyHistory((prev) => [newLatencyPoint, ...prev].slice(0, 30));
      if (result.optimizationMode) setOptimizationMode(result.optimizationMode);

      setLoading(false);
    } catch (error) {
      console.error("Failed to fetch health:", error);
      setLoading(false);
    }
  };

  const toggleOptimizationMode = async (mode) => {
    setOptimizationMode(mode);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      fetchHealth(); // refresh immediately
    } catch (error) {
      console.error("Failed to toggle optimization:", error);
    }
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;

    // setChatLoading(true) disables the Send button while a request is in flight,
    // which is a client-side submit-guard — the real debounce protection now lives
    // server-side in /api/chat.
    setChatLoading(true);
    const userMsg = chatInput;
    setChatHistory((prev) => [...prev, { role: "user", text: userMsg }]);
    setChatInput("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg }),
      });
      const result = await response.json();

      if (result.error) {
        let errorText = result.error;
        let incidentId = result.incidentId || null;
        let retryAfter = result.retryAfter ? result.retryAfter * 1000 : null;
        try {
          const parsed = JSON.parse(errorText);
          if (parsed.incidentId) incidentId = parsed.incidentId;
          if (parsed.retryAfter) retryAfter = parsed.retryAfter;
        } catch (e) {
          if (!incidentId) {
            incidentId = "INT-" + Date.now().toString(36).slice(-6);
          }
        }
        setChatHistory((prev) => [...prev, { role: "error", text: errorText, incidentId, retryAfter }]);
      } else {
        let extra = "";
        if (result.circuitReason) extra = "[" + result.circuitReason + "] ";
        if (result.circuitState && result.circuitState !== "CLOSED") extra += "[" + result.circuitState + "] ";

        setChatHistory((prev) => [
          ...prev,
          {
            role: "assistant",
            text: extra + result.message,
            routedTo: result.routedTo,
            time: new Date(result.routedAt).toLocaleTimeString(),
            retryLog: result.retryLog && result.retryLog.length > 0 ? result.retryLog : null,
          },
        ]);
        setLastRoutedTo(result.routedTo);

        if (result.routedTo !== "openai" && data?.openai?.status !== "HEALTHY") {
          setFailoverFlash(true);
          setTimeout(() => setFailoverFlash(false), 2000);
          const failoverEvent = {
            id: Date.now() + "-failover",
            time: new Date().toLocaleTimeString(),
            api: "ROUTER",
            status: "FAILOVER",
            note: result.circuitReason || "OpenAI unhealthy, routed to Anthropic",
          };
          setEvents((prev) => [failoverEvent, ...prev].slice(0, 50));
        }
      }
    } catch (error) {
      let errorText = error.message;
      let incidentId = null;
      let retryAfter = null;
      try {
        const parsed = JSON.parse(error.message);
        if (parsed.incidentId) incidentId = parsed.incidentId;
        if (parsed.retryAfter) retryAfter = parsed.retryAfter;
      } catch (e) {
        incidentId = "INT-" + Date.now().toString(36).slice(-6);
      }
      setChatHistory((prev) => [...prev, { role: "error", text: errorText, incidentId, retryAfter }]);
    }
    setChatLoading(false);
  };

  const simulateApi = async (api, action) => {
    try {
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api, action }),
      });
      const result = await response.json();
      if (result.success) {
        const timestamp = new Date().toLocaleTimeString();
        const statusMap = { down: "DOWN", degraded: "DEGRADED", up: "HEALTHY", flapping: "FLAPPING" };
        const noteMap = { down: "Simulated outage", degraded: "Simulated degradation", up: "Restored", flapping: "Flapping detected — state locked" };
        const event = {
          id: Date.now() + "-sim",
          time: timestamp,
          api: api === "openai" ? "OpenAI" : api === "anthropic" ? "Anthropic" : "Gemini",
          status: statusMap[action] || "UNKNOWN",
          note: noteMap[action] || action,
        };
        setEvents((prev) => [event, ...prev].slice(0, 50));
        if (action !== "up") {
          setFailoverFlash(true);
          setTimeout(() => setFailoverFlash(false), 1500);
        }
        fetchHealth();
      }
    } catch (error) {
      console.error("Simulate error:", error);
    }
  };

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!ignore) {
        await fetchHealth();
      }
    }
    load();
    const interval = setInterval(load, 10000);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [events]);

  const getStatusColor = (status) => {
    if (status === "HEALTHY") return "bg-emerald-500";
    if (status === "DEGRADED") return "bg-amber-500";
    if (status === "DOWN") return "bg-red-500";
    if (status === "FAILOVER") return "bg-cyan-500";
    if (status === "FLAPPING") return "bg-orange-500";
    return "bg-zinc-600";
  };
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
  const getApiColor = (api) => {
    if (api === "OpenAI") return "text-emerald-400";
    if (api === "Anthropic") return "text-violet-400";
    if (api === "Gemini") return "text-blue-400";
    if (api === "ROUTER") return "text-cyan-400";
    return "text-zinc-400";
  };
  const getEventBg = (status) => {
    if (status === "FAILOVER") return "bg-cyan-500/5";
    if (status === "DOWN") return "bg-red-500/5";
    if (status === "DEGRADED") return "bg-amber-500/5";
    if (status === "FLAPPING") return "bg-orange-500/5";
    return "hover:bg-zinc-800/20";
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

  const statusCounts = data?.statusCounts || { healthy: 0, degraded: 0, down: 0 };
  const totalIncidents = events.filter((e) => e.status === "DOWN" || e.status === "DEGRADED" || e.status === "FAILOVER" || e.status === "FLAPPING").length;
  const cb = data?.circuitBreaker;
  const chartData = [...latencyHistory].reverse();

  return (
    <main className={`min-h-screen bg-[#09090b] text-white transition-colors duration-300 ${failoverFlash ? "bg-red-950/20" : ""}`}>
      
      {failoverFlash && (
        <div className="bg-cyan-500/10 border-b border-cyan-500/30 px-6 py-2 text-center">
          <span className="text-xs font-medium text-cyan-400">⚡ STATE CHANGE — System reacting</span>
        </div>
      )}

      {/* Nav */}
      <nav className="border-b border-zinc-800/50 px-6 py-4 backdrop-blur-sm bg-[#09090b]/80 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-violet-400 flex items-center justify-center">
              <span className="text-black font-bold text-sm">N</span>
            </div>
            <div>
              <span className="font-bold text-sm tracking-wider">NEXUS</span>
              <span className="text-xs text-zinc-600 ml-2">v0.3.0</span>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Sentinel</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Router</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Circuit Breaker</span>
            </div>
            <div className="w-px h-4 bg-zinc-800 mx-1"></div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-xs text-zinc-500">Live</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Main */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tighter mb-2">
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">NEXUS</span>
            </h1>
            <p className="text-zinc-500 text-sm">Autonomous Multi-Agent API Resilience System</p>
          </div>
          <div className="text-right hidden md:block">
            <div className="text-xs text-zinc-600">{data?.checkedAt ? `Last sync: ${new Date(data.checkedAt).toLocaleTimeString()}` : "Syncing..."}</div>
            <div className="text-[10px] text-zinc-700 mt-0.5">Circuit: {cb?.config?.failureThreshold} failures → OPEN | {cb?.config?.cooldownDuration / 1000}s cooldown</div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
            <div className="text-xs text-zinc-600 mb-1">Healthy</div>
            <div className="text-2xl font-bold text-emerald-400 tabular-nums">{statusCounts.healthy}</div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
            <div className="text-xs text-zinc-600 mb-1">Degraded</div>
            <div className={`text-2xl font-bold tabular-nums ${statusCounts.degraded > 0 ? "text-amber-400" : "text-zinc-600"}`}>{statusCounts.degraded}</div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
            <div className="text-xs text-zinc-600 mb-1">Down</div>
            <div className={`text-2xl font-bold tabular-nums ${statusCounts.down > 0 ? "text-red-400" : "text-zinc-600"}`}>{statusCounts.down}</div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
            <div className="text-xs text-zinc-600 mb-1">Incidents</div>
            <div className={`text-2xl font-bold tabular-nums ${totalIncidents > 0 ? "text-amber-400" : "text-emerald-400"}`}>{totalIncidents}</div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
            <div className="text-xs text-zinc-600 mb-1">Total Checks</div>
            <div className="text-2xl font-bold text-zinc-400 tabular-nums">{events.length}</div>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Endpoints</h2>
              <div className="flex-1 h-px bg-zinc-800/50"></div>
            </div>

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

            {/* Simulate */}
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px]">⚡</span>
                <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Simulate</h3>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] text-emerald-400/60 w-14">OpenAI</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => simulateApi("openai", "down")} className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-lg bg-red-500/5 text-red-400/60 border border-red-500/10 hover:bg-red-500/10 hover:text-red-400 transition-all">Kill</button>
                  <button onClick={() => simulateApi("openai", "degraded")} className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-lg bg-amber-500/5 text-amber-400/60 border border-amber-500/10 hover:bg-amber-500/10 hover:text-amber-400 transition-all">Slow</button>
                  <button onClick={() => simulateApi("openai", "up")} className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-lg bg-emerald-500/5 text-emerald-400/60 border border-emerald-500/10 hover:bg-emerald-500/10 hover:text-emerald-400 transition-all">Fix</button>
                </div>
                <div className="flex items-center gap-1.5 mb-1 mt-3">
                  <span className="text-[10px] text-violet-400/60 w-14">Anthro</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => simulateApi("anthropic", "down")} className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-lg bg-red-500/5 text-red-400/60 border border-red-500/10 hover:bg-red-500/10 hover:text-red-400 transition-all">Kill</button>
                  <button onClick={() => simulateApi("anthropic", "degraded")} className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-lg bg-amber-500/5 text-amber-400/60 border border-amber-500/10 hover:bg-amber-500/10 hover:text-amber-400 transition-all">Slow</button>
                  <button onClick={() => simulateApi("anthropic", "up")} className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-lg bg-emerald-500/5 text-emerald-400/60 border border-emerald-500/10 hover:bg-emerald-500/10 hover:text-emerald-400 transition-all">Fix</button>
                </div>
                <div className="flex items-center gap-1.5 mb-1 mt-3">
                  <span className="text-[10px] text-blue-400/60 w-14">Gemini</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => simulateApi("gemini", "down")} className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-lg bg-red-500/5 text-red-400/60 border border-red-500/10 hover:bg-red-500/10 hover:text-red-400 transition-all">Kill</button>
                  <button onClick={() => simulateApi("gemini", "degraded")} className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-lg bg-amber-500/5 text-amber-400/60 border border-amber-500/10 hover:bg-amber-500/10 hover:text-amber-400 transition-all">Slow</button>
                  <button onClick={() => simulateApi("gemini", "up")} className="flex-1 text-[10px] font-medium px-2 py-1.5 rounded-lg bg-emerald-500/5 text-emerald-400/60 border border-emerald-500/10 hover:bg-emerald-500/10 hover:text-emerald-400 transition-all">Fix</button>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Event Log */}
          <div className="lg:col-span-3">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Event Log</h2>
              <span className="text-[10px] text-zinc-700">{events.length} events</span>
              <div className="flex-1 h-px bg-zinc-800/50"></div>
            </div>
            <div ref={logRef} className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl h-[500px] overflow-y-auto">
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-700">
                  <div className="w-8 h-8 rounded-full bg-zinc-800/50 flex items-center justify-center mb-2"><span className="text-xs">📡</span></div>
                  <span className="text-xs">Waiting for first check...</span>
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/30">
                  {events.map((event) => (
                    <div key={event.id} className={`flex items-center justify-between px-4 py-2.5 transition-colors ${getEventBg(event.status)}`}>
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] text-zinc-700 font-mono w-14">{event.time}</span>
                        <div className={`w-1.5 h-1.5 rounded-full ${getStatusColor(event.status)}`}></div>
                        <span className={`text-xs font-medium ${getApiColor(event.api)}`}>{event.api}</span>
                        {event.note && <span className="text-[10px] text-zinc-700">{event.note}</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        {event.latency ? <span className="text-[10px] text-zinc-600 font-mono w-12 text-right">{event.latency}ms</span> : <span className="w-12"></span>}
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded w-20 text-center ${getStatusBg(event.status)}`}>{event.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Optimizer Agent */}
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

        {/* Test Router */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Test Router</h2>
            <div className="flex-1 h-px bg-zinc-800/50"></div>
            {lastRoutedTo && <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${lastRoutedTo === "openai" ? "bg-emerald-500/10 text-emerald-400" : lastRoutedTo === "anthropic" ? "bg-violet-500/10 text-violet-400" : "bg-blue-500/10 text-blue-400"}`}>{lastRoutedTo === "openai" ? "OpenAI" : lastRoutedTo === "anthropic" ? "Anthropic" : "Gemini"}</span>}
          </div>

          {/* Rate limit indicator */}
          {rateLimitCount !== null && (
            <div className={`text-[10px] mb-2 ${rateLimitCount === 0 ? "text-red-400" : "text-amber-400/60"}`}>
              {rateLimitCount === 0 ? "⚠️ Rate limited — " + Math.ceil(rateLimitReset / 1000) + "s cooldown" : "Rate limit: " + rateLimitCount + "/20 per minute"}
            </div>
          )}

          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden">
            {chatHistory.length > 0 && (
              <div className="border-b border-zinc-800/50 p-4 max-h-48 overflow-y-auto space-y-2">
                {chatHistory.map((msg, i) => (
                  <div key={i} className="flex gap-2">
                    <span className={`text-[10px] font-mono mt-0.5 w-14 flex-shrink-0 ${msg.role === "user" ? "text-cyan-400" : msg.role === "error" ? "text-red-400" : msg.routedTo === "openai" ? "text-emerald-400" : msg.routedTo === "anthropic" ? "text-violet-400" : "text-blue-400"}`}>
                      {msg.role === "user" ? "you" : msg.role === "error" ? "error" : msg.routedTo === "openai" ? "openai" : msg.routedTo === "anthropic" ? "anthro" : "gemini"}
                    </span>
                    <div className="flex-1">
                      <span className={`text-xs ${msg.role === "error" ? "text-red-400" : "text-zinc-400"}`}>{msg.text}</span>
                      {msg.incidentId && <span className="ml-2 text-[9px] text-zinc-600 font-mono">[{msg.incidentId}]</span>}
                      {msg.retryAfter && <span className="ml-2 text-[9px] text-amber-500/60 font-mono">Retry after {Math.ceil(msg.retryAfter / 1000)}s</span>}
                      {msg.retryLog && msg.retryLog.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {msg.retryLog.map((r, j) => (
                            <div key={j} className={`text-[10px] ${r.success ? "text-emerald-500/70" : "text-red-400/70"} font-mono`}>
                              ↻ Retry {r.attempt}: {r.api} — {r.success ? "SUCCESS" : "FAIL"} {r.delay} {r.error ? "(" + r.error + ")" : ""}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 p-3">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => { setChatInput(e.target.value); }}
                onKeyDown={(e) => { if (e.key === "Enter") sendChat(); if (e.repeat) e.preventDefault(); }}
                placeholder="Send a test message..."
                className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500/30 transition-colors"
                disabled={chatLoading}
              />
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 text-black font-semibold text-xs hover:shadow-[0_0_20px_rgba(34,211,238,0.2)] transition-all disabled:opacity-30 disabled:cursor-not-allowed">{chatLoading ? "..." : "Send"}</button>
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Latency</h2>
            <div className="flex-1 h-px bg-zinc-800/50"></div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-emerald-500 rounded"></div><span className="text-[10px] text-zinc-600">OpenAI</span></div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-violet-500 rounded"></div><span className="text-[10px] text-zinc-600">Anthropic</span></div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-blue-500 rounded"></div><span className="text-[10px] text-zinc-600">Gemini</span></div>
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-5">
            {chartData.length < 2 ? (
              <div className="h-[200px] flex items-center justify-center text-zinc-700 text-xs">Collecting data points...</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="openaiGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.2} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                    <linearGradient id="anthropicGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity={0.2} /><stop offset="100%" stopColor="#a78bfa" stopOpacity={0} /></linearGradient>
                    <linearGradient id="geminiGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity={0.2} /><stop offset="100%" stopColor="#60a5fa" stopOpacity={0} /></linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fill: "#3f3f46", fontSize: 10 }} axisLine={false} tickLine={false} dy={8} />
                  <YAxis tick={{ fill: "#3f3f46", fontSize: 10 }} axisLine={false} tickLine={false} dx={-5} tickFormatter={(v) => `${v}ms`} />
                  <Tooltip content={<CustomTooltip threshold={data?.config?.degradedThreshold} />} />
                  <Area type="monotone" dataKey="gemini" stroke="#60a5fa" strokeWidth={1.5} fill="url(#geminiGrad)" dot={false} activeDot={{ r: 3, fill: "#60a5fa" }} />
                  <Area type="monotone" dataKey="anthropic" stroke="#a78bfa" strokeWidth={1.5} fill="url(#anthropicGrad)" dot={false} activeDot={{ r: 3, fill: "#a78bfa" }} />
                  <Area type="monotone" dataKey="openai" stroke="#10b981" strokeWidth={1.5} fill="url(#openaiGrad)" dot={false} activeDot={{ r: 3, fill: "#10b981" }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* System */}
        <div className="border-t border-zinc-800/50 pt-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">System</h2>
            <div className="flex-1 h-px bg-zinc-800/50"></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
              <div className="text-[10px] text-zinc-600 mb-1">Health States</div>
              <div className="text-xs text-zinc-400">HEALTHY / DEGRADED / DOWN / FLAPPING</div>
            </div>
            <div className="bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
              <div className="text-[10px] text-zinc-600 mb-1">Circuit Breaker</div>
              <div className="text-xs text-zinc-400">CLOSED / OPEN / HALF_OPEN</div>
            </div>
            <div className="bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
              <div className="text-[10px] text-zinc-600 mb-1">Retry Config</div>
              <div className="text-xs text-zinc-400">3 attempts, 1-4s backoff, jitter</div>
            </div>
            <div className="bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
              <div className="text-[10px] text-zinc-600 mb-1">Edge Cases</div>
              <div className="text-xs text-zinc-400">Debounce + Rate Limit + Timeout</div>
            </div>
            <div className="bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
              <div className="text-[10px] text-zinc-600 mb-1">Incident IDs</div>
              <div className="text-xs text-zinc-400">INC-2025-XXXX format</div>
            </div>
          </div>
        </div>
      </div>

      <footer className="border-t border-zinc-800/30 mt-12 py-6 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-cyan-400 to-violet-400 flex items-center justify-center">
              <span className="text-black font-bold text-[8px]">N</span>
            </div>
            <span className="text-[10px] text-zinc-700">NEXUS by Tanish @ Chitkara University</span>
          </div>
          <span className="text-[10px] text-zinc-800">Edge Cases Handled • v0.3.0</span>
        </div>
      </footer>
    </main>
  );
}