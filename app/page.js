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

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [latencyHistory, setLatencyHistory] = useState([]);
  const logRef = useRef(null);

  // Chat state
  const [chatInput, setChatInput] = useState("");
  const [chatResponse, setChatResponse] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [lastRoutedTo, setLastRoutedTo] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);

  // Failover flash
  const [failoverFlash, setFailoverFlash] = useState(false);

  // Fetch health data
  const fetchHealth = async () => {
    try {
      const response = await fetch("/api/health");
      const result = await response.json();
      setData(result);
      setLoading(false);

      const timestamp = new Date(result.checkedAt).toLocaleTimeString();

      const newEvents = [
        {
          id: Date.now() + "-anthropic",
          time: timestamp,
          api: "Anthropic",
          status: result.anthropic?.status,
          latency: result.anthropic?.latency,
          statusCode: result.anthropic?.statusCode,
        },
        {
          id: Date.now() + "-openai",
          time: timestamp,
          api: "OpenAI",
          status: result.openai?.status,
          latency: result.openai?.latency,
          statusCode: result.openai?.statusCode,
        },
      ];

      setEvents((prev) => [...newEvents, ...prev].slice(0, 50));

      const newLatencyPoint = {
        time: timestamp,
        openai: result.openai?.latency || 0,
        anthropic: result.anthropic?.latency || 0,
      };

      setLatencyHistory((prev) => [newLatencyPoint, ...prev].slice(0, 30));
    } catch (error) {
      console.error("Failed to fetch health:", error);
      setLoading(false);
    }
  };

  // Send chat
  const sendChat = async () => {
    if (!chatInput.trim()) return;
    setChatLoading(true);
    setChatResponse(null);

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
        setChatHistory((prev) => [...prev, { role: "error", text: result.error }]);
      } else {
        setChatHistory((prev) => [
          ...prev,
          {
            role: "assistant",
            text: result.message,
            routedTo: result.routedTo,
            time: new Date(result.routedAt).toLocaleTimeString(),
          },
        ]);
        setLastRoutedTo(result.routedTo);

        if (result.routedTo === "anthropic" && data?.openai?.status !== "HEALTHY") {
          setFailoverFlash(true);
          setTimeout(() => setFailoverFlash(false), 2000);

          const failoverEvent = {
            id: Date.now() + "-failover",
            time: new Date().toLocaleTimeString(),
            api: "ROUTER",
            status: "FAILOVER",
            latency: null,
            note: "OpenAI not healthy → Routed to Anthropic",
          };
          setEvents((prev) => [failoverEvent, ...prev].slice(0, 50));
        }
      }
    } catch (error) {
      setChatHistory((prev) => [...prev, { role: "error", text: error.message }]);
    }

    setChatLoading(false);
  };

  // Simulate
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
        const statusMap = { down: "DOWN", degraded: "DEGRADED", up: "HEALTHY" };
        const noteMap = {
          down: "Simulated outage",
          degraded: "Simulated degradation",
          up: "Restored",
        };

        const event = {
          id: Date.now() + "-sim",
          time: timestamp,
          api: api === "openai" ? "OpenAI" : "Anthropic",
          status: statusMap[action],
          latency: null,
          note: noteMap[action],
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

  useEffect(() => { fetchHealth(); }, []);
  useEffect(() => {
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [events]);

  // ============================================
  // STATUS HELPERS (NOW THREE STATES)
  // ============================================
  const getStatusColor = (status) => {
    if (status === "HEALTHY") return "bg-emerald-500";
    if (status === "DEGRADED") return "bg-amber-500";
    if (status === "DOWN") return "bg-red-500";
    if (status === "FAILOVER") return "bg-cyan-500";
    return "bg-zinc-600";
  };

  const getStatusTextColor = (status) => {
    if (status === "HEALTHY") return "text-emerald-400";
    if (status === "DEGRADED") return "text-amber-400";
    if (status === "DOWN") return "text-red-400";
    if (status === "FAILOVER") return "text-cyan-400";
    return "text-zinc-500";
  };

  const getStatusBg = (status) => {
    if (status === "HEALTHY") return "bg-emerald-500/10 text-emerald-400";
    if (status === "DEGRADED") return "bg-amber-500/10 text-amber-400";
    if (status === "DOWN") return "bg-red-500/10 text-red-400";
    if (status === "FAILOVER") return "bg-cyan-500/10 text-cyan-400";
    return "bg-zinc-500/10 text-zinc-400";
  };

  const getCardBorder = (status) => {
    if (status === "DOWN") return "border-red-500/30 bg-red-500/5";
    if (status === "DEGRADED") return "border-amber-500/30 bg-amber-500/5";
    return "border-zinc-800/50 hover:border-zinc-700/50";
  };

  const getIconBg = (status, baseColor) => {
    if (status === "DOWN") return "bg-red-500/10";
    if (status === "DEGRADED") return "bg-amber-500/10";
    return `bg-${baseColor}-500/10`;
  };

  const getIconColor = (status, baseColor) => {
    if (status === "DOWN") return "text-red-400";
    if (status === "DEGRADED") return "text-amber-400";
    return `text-${baseColor}-400`;
  };

  const getApiColor = (api) => {
    if (api === "OpenAI") return "text-emerald-400";
    if (api === "Anthropic") return "text-violet-400";
    if (api === "ROUTER") return "text-cyan-400";
    return "text-zinc-400";
  };

  const getEventBg = (status) => {
    if (status === "FAILOVER") return "bg-cyan-500/5";
    if (status === "DOWN") return "bg-red-500/5";
    if (status === "DEGRADED") return "bg-amber-500/5";
    return "hover:bg-zinc-800/20";
  };

  // Stats
  const statusCounts = data?.statusCounts || { healthy: 0, degraded: 0, down: 0 };
  const totalIncidents = events.filter(
    (e) => e.status === "DOWN" || e.status === "DEGRADED" || e.status === "FAILOVER"
  ).length;

  // Chart
  const chartData = [...latencyHistory].reverse();

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl">
          <p className="text-zinc-400 mb-1.5 font-medium">{label}</p>
          <p className="text-emerald-400">OpenAI: {payload[0]?.value}ms</p>
          <p className="text-violet-400">Anthropic: {payload[1]?.value}ms</p>
          <div className="border-t border-zinc-700 mt-1.5 pt-1.5">
            <p className="text-zinc-500">Threshold: {data?.config?.degradedThreshold || "500ms"}</p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <main className={`min-h-screen bg-[#09090b] text-white transition-colors duration-300 ${failoverFlash ? "bg-red-950/20" : ""}`}>
      
      {/* Flash banner */}
      {failoverFlash && (
        <div className="bg-cyan-500/10 border-b border-cyan-500/30 px-6 py-2 text-center">
          <span className="text-xs font-medium text-cyan-400">⚡ STATE CHANGE — System reacting to status update</span>
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
              <span className="text-xs text-zinc-600 ml-2">v0.2.0</span>
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
            <div className="text-[10px] text-zinc-700 mt-0.5">Threshold: {data?.config?.degradedThreshold || "500ms"}</div>
          </div>
        </div>

        {/* Stats — NOW THREE COLUMNS */}
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
          {/* Left: API Cards + Controls */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Endpoints</h2>
              <div className="flex-1 h-px bg-zinc-800/50"></div>
            </div>

            {/* OpenAI Card */}
            <div className={`bg-zinc-900/50 border rounded-xl p-5 transition-all duration-300 ${getCardBorder(data?.openai?.status)}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${data?.openai?.status === "DOWN" ? "bg-red-500/10" : data?.openai?.status === "DEGRADED" ? "bg-amber-500/10" : "bg-emerald-500/10"}`}>
                    <span className={`text-xs font-bold ${data?.openai?.status === "DOWN" ? "text-red-400" : data?.openai?.status === "DEGRADED" ? "text-amber-400" : "text-emerald-400"}`}>OA</span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">OpenAI</div>
                    <div className="text-[10px] text-zinc-600">GPT-4o API</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${getStatusBg(data?.openai?.status)}`}>
                    {loading ? "..." : data?.openai?.status || "..."}
                  </span>
                  <div className={`w-2 h-2 rounded-full ${loading ? "bg-zinc-600 animate-pulse" : getStatusColor(data?.openai?.status)}`}></div>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-600">
                <span>Latency</span>
                <span className="font-mono tabular-nums">{loading ? "—" : data?.openai?.latency ? `${data.openai.latency}ms` : "—"}</span>
              </div>
            </div>

            {/* Anthropic Card */}
            <div className={`bg-zinc-900/50 border rounded-xl p-5 transition-all duration-300 ${getCardBorder(data?.anthropic?.status)}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${data?.anthropic?.status === "DOWN" ? "bg-red-500/10" : data?.anthropic?.status === "DEGRADED" ? "bg-amber-500/10" : "bg-violet-500/10"}`}>
                    <span className={`text-xs font-bold ${data?.anthropic?.status === "DOWN" ? "text-red-400" : data?.anthropic?.status === "DEGRADED" ? "text-amber-400" : "text-violet-400"}`}>AN</span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Anthropic</div>
                    <div className="text-[10px] text-zinc-600">Claude API</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${getStatusBg(data?.anthropic?.status)}`}>
                    {loading ? "..." : data?.anthropic?.status || "..."}
                  </span>
                  <div className={`w-2 h-2 rounded-full ${loading ? "bg-zinc-600 animate-pulse" : getStatusColor(data?.anthropic?.status)}`}></div>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-600">
                <span>Latency</span>
                <span className="font-mono tabular-nums">{loading ? "—" : data?.anthropic?.latency ? `${data.anthropic.latency}ms` : "—"}</span>
              </div>
            </div>

            {/* Simulate — NOW THREE BUTTONS PER API */}
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
            <div ref={logRef} className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl h-[480px] overflow-y-auto">
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
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded w-16 text-center ${getStatusBg(event.status)}`}>{event.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Test Router */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Test Router</h2>
            <div className="flex-1 h-px bg-zinc-800/50"></div>
            {lastRoutedTo && <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${lastRoutedTo === "openai" ? "bg-emerald-500/10 text-emerald-400" : "bg-violet-500/10 text-violet-400"}`}>{lastRoutedTo === "openai" ? "OpenAI" : "Anthropic"}</span>}
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden">
            {chatHistory.length > 0 && (
              <div className="border-b border-zinc-800/50 p-4 max-h-48 overflow-y-auto space-y-2">
                {chatHistory.map((msg, i) => (
                  <div key={i} className="flex gap-2">
                    <span className={`text-[10px] font-mono mt-0.5 w-14 flex-shrink-0 ${msg.role === "user" ? "text-cyan-400" : msg.role === "error" ? "text-red-400" : "text-violet-400"}`}>
                      {msg.role === "user" ? "you" : msg.role === "error" ? "error" : msg.routedTo === "openai" ? "openai" : "anthro"}
                    </span>
                    <span className={`text-xs ${msg.role === "error" ? "text-red-400" : "text-zinc-400"}`}>{msg.text}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 p-3">
              <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendChat()} placeholder="Send a test message..." className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500/30 transition-colors" />
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 text-black font-semibold text-xs hover:shadow-[0_0_20px_rgba(34,211,238,0.2)] transition-all disabled:opacity-30 disabled:cursor-not-allowed">{chatLoading ? "..." : "Send"}</button>
            </div>
          </div>
        </div>

        {/* Chart — NOW WITH THRESHOLD LINE */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Latency</h2>
            <div className="flex-1 h-px bg-zinc-800/50"></div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-emerald-500 rounded"></div><span className="text-[10px] text-zinc-600">OpenAI</span></div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-violet-500 rounded"></div><span className="text-[10px] text-zinc-600">Anthropic</span></div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-px bg-amber-500/50 border-t border-dashed border-amber-500"></div><span className="text-[10px] text-amber-500/60">500ms</span></div>
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
                  </defs>
                  <XAxis dataKey="time" tick={{ fill: "#3f3f46", fontSize: 10 }} axisLine={false} tickLine={false} dy={8} />
                  <YAxis tick={{ fill: "#3f3f46", fontSize: 10 }} axisLine={false} tickLine={false} dx={-5} tickFormatter={(v) => `${v}ms`} />
                  <Tooltip content={<CustomTooltip />} />
                  {/* Threshold reference line */}
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
              <div className="text-[10px] text-zinc-600 mb-1">Health States</div>
              <div className="text-xs text-zinc-400">HEALTHY / DEGRADED / DOWN</div>
            </div>
            <div className="bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
              <div className="text-[10px] text-zinc-600 mb-1">Degraded Threshold</div>
              <div className="text-xs text-zinc-400">{data?.config?.degradedThreshold || "500ms"}</div>
            </div>
            <div className="bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
              <div className="text-[10px] text-zinc-600 mb-1">Framework</div>
              <div className="text-xs text-zinc-400">Next.js 16 + Turbopack</div>
            </div>
            <div className="bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
              <div className="text-[10px] text-zinc-600 mb-1">Architecture</div>
              <div className="text-xs text-zinc-400">Multi-Agent System</div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-800/30 mt-12 py-6 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-cyan-400 to-violet-400 flex items-center justify-center"><span className="text-black font-bold text-[8px]">N</span></div>
            <span className="text-[10px] text-zinc-700">NEXUS by Tanish @ Chitkara University</span>
          </div>
          <span className="text-[10px] text-zinc-800">Three-State Health System</span>
        </div>
      </footer>
    </main>
  );
}