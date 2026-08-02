"use client";

import { useState, useEffect, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
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

  // Failover flash effect
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

  // Send chat message
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
        setChatHistory((prev) => [
          ...prev,
          { role: "error", text: result.error },
        ]);
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

        // Trigger failover flash if routed to backup
        if (result.routedTo === "anthropic" && data?.openai?.status === "DOWN") {
          setFailoverFlash(true);
          setTimeout(() => setFailoverFlash(false), 2000);

          const timestamp = new Date().toLocaleTimeString();
          const failoverEvent = {
            id: Date.now() + "-failover",
            time: timestamp,
            api: "ROUTER",
            status: "FAILOVER",
            latency: null,
            note: "OpenAI DOWN → Routed to Anthropic",
          };
          setEvents((prev) => [failoverEvent, ...prev].slice(0, 50));
        }
      }
    } catch (error) {
      setChatHistory((prev) => [
        ...prev,
        { role: "error", text: error.message },
      ]);
    }

    setChatLoading(false);
  };

  // Simulate outage
  const simulateOutage = async (api, action) => {
    try {
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api, action }),
      });
      const result = await response.json();

      if (result.success) {
        const timestamp = new Date().toLocaleTimeString();
        const event = {
          id: Date.now() + "-sim",
          time: timestamp,
          api: api === "openai" ? "OpenAI" : "Anthropic",
          status: action === "down" ? "DOWN" : "UP",
          latency: null,
          note: action === "down" ? "Simulated outage" : "Restored",
        };
        setEvents((prev) => [event, ...prev].slice(0, 50));

        if (action === "down") {
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
    fetchHealth();
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [events]);

  // Status helpers
  const getStatusColor = (status) => {
    if (status === "UP") return "bg-emerald-500";
    if (status === "DOWN") return "bg-red-500";
    if (status === "FAILOVER") return "bg-amber-500";
    return "bg-zinc-600";
  };

  const getStatusTextColor = (status) => {
    if (status === "UP") return "text-emerald-400";
    if (status === "DOWN") return "text-red-400";
    if (status === "FAILOVER") return "text-amber-400";
    return "text-zinc-500";
  };

  const getApiColor = (api) => {
    if (api === "OpenAI") return "text-emerald-400";
    if (api === "Anthropic") return "text-violet-400";
    if (api === "ROUTER") return "text-amber-400";
    return "text-zinc-400";
  };

  // Stats
  const failovers = events.filter(
    (e) => e.status === "DOWN" || e.status === "FAILOVER"
  ).length;
  const allUp =
    data?.openai?.status === "UP" && data?.anthropic?.status === "UP";
  const uptime = allUp ? "100%" : "50%";

  // Chart data
  const chartData = [...latencyHistory].reverse();

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl">
          <p className="text-zinc-400 mb-1.5 font-medium">{label}</p>
          <p className="text-emerald-400">
            OpenAI: {payload[0]?.value}ms
          </p>
          <p className="text-violet-400">
            Anthropic: {payload[1]?.value}ms
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <main
      className={`min-h-screen bg-[#09090b] text-white transition-colors duration-300 ${
        failoverFlash ? "bg-red-950/20" : ""
      }`}
    >
      {/* Failover flash banner */}
      {failoverFlash && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-6 py-2 text-center">
          <span className="text-xs font-medium text-amber-400">
            ⚡ FAILOVER ACTIVATED — Traffic rerouted to backup API
          </span>
        </div>
      )}

      {/* Navigation */}
      <nav className="border-b border-zinc-800/50 px-6 py-4 backdrop-blur-sm bg-[#09090b]/80 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-violet-400 flex items-center justify-center">
              <span className="text-black font-bold text-sm">N</span>
            </div>
            <div>
              <span className="font-bold text-sm tracking-wider">NEXUS</span>
              <span className="text-xs text-zinc-600 ml-2">v0.1.0</span>
            </div>
          </div>

          {/* Active Agents */}
          <div className="hidden md:flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                Sentinel
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                Router
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-zinc-700"></div>
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
                Scout
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-zinc-700"></div>
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
                Healer
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-zinc-700"></div>
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
                Optimizer
              </span>
            </div>

            <div className="w-px h-4 bg-zinc-800 mx-1"></div>

            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-xs text-zinc-500">Live</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tighter mb-2">
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
                NEXUS
              </span>
            </h1>
            <p className="text-zinc-500 text-sm">
              Autonomous Multi-Agent API Resilience System
            </p>
          </div>
          <div className="text-right hidden md:block">
            <div className="text-xs text-zinc-600">
              {data?.checkedAt
                ? `Last sync: ${new Date(data.checkedAt).toLocaleTimeString()}`
                : "Syncing..."}
            </div>
            <div className="text-[10px] text-zinc-700 mt-0.5">
              Check interval: 10s
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
            <div className="text-xs text-zinc-600 mb-1">APIs Monitored</div>
            <div className="text-2xl font-bold text-cyan-400 tabular-nums">2</div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
            <div className="text-xs text-zinc-600 mb-1">System Uptime</div>
            <div
              className={`text-2xl font-bold tabular-nums ${
                uptime === "100%" ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              {uptime}
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
            <div className="text-xs text-zinc-600 mb-1">Incidents</div>
            <div
              className={`text-2xl font-bold tabular-nums ${
                failovers > 0 ? "text-red-400" : "text-emerald-400"
              }`}
            >
              {failovers}
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
            <div className="text-xs text-zinc-600 mb-1">Total Checks</div>
            <div className="text-2xl font-bold text-zinc-400 tabular-nums">
              {events.length}
            </div>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
          {/* Left Column: API Cards + Controls */}
          <div className="lg:col-span-2 space-y-4">
            {/* Section Header */}
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                Endpoints
              </h2>
              <div className="flex-1 h-px bg-zinc-800/50"></div>
            </div>

            {/* OpenAI Card */}
            <div
              className={`bg-zinc-900/50 border rounded-xl p-5 transition-all duration-300 ${
                data?.openai?.status === "DOWN"
                  ? "border-red-500/30 bg-red-500/5"
                  : "border-zinc-800/50 hover:border-zinc-700/50"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      data?.openai?.status === "DOWN"
                        ? "bg-red-500/10"
                        : "bg-emerald-500/10"
                    }`}
                  >
                    <span
                      className={`text-xs font-bold ${
                        data?.openai?.status === "DOWN"
                          ? "text-red-400"
                          : "text-emerald-400"
                      }`}
                    >
                      OA
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">OpenAI</div>
                    <div className="text-[10px] text-zinc-600">
                      GPT-4o API
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      data?.openai?.status === "UP"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-red-500/10 text-red-400"
                    }`}
                  >
                    {loading ? "..." : data?.openai?.status || "..."}
                  </span>
                  <div
                    className={`w-2 h-2 rounded-full ${
                      loading
                        ? "bg-zinc-600 animate-pulse"
                        : getStatusColor(data?.openai?.status)
                    }`}
                  ></div>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-600">
                <span>Latency</span>
                <span className="font-mono tabular-nums">
                  {loading
                    ? "—"
                    : data?.openai?.latency
                    ? `${data.openai.latency}ms`
                    : "—"}
                </span>
              </div>
            </div>

            {/* Anthropic Card */}
            <div
              className={`bg-zinc-900/50 border rounded-xl p-5 transition-all duration-300 ${
                data?.anthropic?.status === "DOWN"
                  ? "border-red-500/30 bg-red-500/5"
                  : "border-zinc-800/50 hover:border-zinc-700/50"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      data?.anthropic?.status === "DOWN"
                        ? "bg-red-500/10"
                        : "bg-violet-500/10"
                    }`}
                  >
                    <span
                      className={`text-xs font-bold ${
                        data?.anthropic?.status === "DOWN"
                          ? "text-red-400"
                          : "text-violet-400"
                      }`}
                    >
                      AN
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Anthropic</div>
                    <div className="text-[10px] text-zinc-600">
                      Claude API
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      data?.anthropic?.status === "UP"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-red-500/10 text-red-400"
                    }`}
                  >
                    {loading ? "..." : data?.anthropic?.status || "..."}
                  </span>
                  <div
                    className={`w-2 h-2 rounded-full ${
                      loading
                        ? "bg-zinc-600 animate-pulse"
                        : getStatusColor(data?.anthropic?.status)
                    }`}
                  ></div>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-600">
                <span>Latency</span>
                <span className="font-mono tabular-nums">
                  {loading
                    ? "—"
                    : data?.anthropic?.latency
                    ? `${data.anthropic.latency}ms`
                    : "—"}
                </span>
              </div>
            </div>

            {/* Simulate Outage */}
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px]">⚡</span>
                <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                  Simulate Outage
                </h3>
              </div>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => simulateOutage("openai", "down")}
                    className="flex-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-red-500/5 text-red-400/70 border border-red-500/10 hover:bg-red-500/10 hover:text-red-400 transition-all"
                  >
                    Kill OpenAI
                  </button>
                  <button
                    onClick={() => simulateOutage("openai", "up")}
                    className="flex-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-emerald-500/5 text-emerald-400/70 border border-emerald-500/10 hover:bg-emerald-500/10 hover:text-emerald-400 transition-all"
                  >
                    Restore
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => simulateOutage("anthropic", "down")}
                    className="flex-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-red-500/5 text-red-400/70 border border-red-500/10 hover:bg-red-500/10 hover:text-red-400 transition-all"
                  >
                    Kill Anthropic
                  </button>
                  <button
                    onClick={() => simulateOutage("anthropic", "up")}
                    className="flex-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-emerald-500/5 text-emerald-400/70 border border-emerald-500/10 hover:bg-emerald-500/10 hover:text-emerald-400 transition-all"
                  >
                    Restore
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Event Log */}
          <div className="lg:col-span-3">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                Event Log
              </h2>
              <span className="text-[10px] text-zinc-700">
                {events.length} events
              </span>
              <div className="flex-1 h-px bg-zinc-800/50"></div>
              <span className="text-[10px] text-zinc-700">Newest first</span>
            </div>

            <div
              ref={logRef}
              className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl h-[460px] overflow-y-auto"
            >
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-700">
                  <div className="w-8 h-8 rounded-full bg-zinc-800/50 flex items-center justify-center mb-2">
                    <span className="text-xs">📡</span>
                  </div>
                  <span className="text-xs">Waiting for first check...</span>
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/30">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className={`flex items-center justify-between px-4 py-2.5 transition-colors ${
                        event.status === "FAILOVER"
                          ? "bg-amber-500/5"
                          : event.status === "DOWN"
                          ? "bg-red-500/5"
                          : "hover:bg-zinc-800/20"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] text-zinc-700 font-mono w-14">
                          {event.time}
                        </span>
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${getStatusColor(
                            event.status
                          )}`}
                        ></div>
                        <span
                          className={`text-xs font-medium ${getApiColor(
                            event.api
                          )}`}
                        >
                          {event.api}
                        </span>
                        {event.note && (
                          <span className="text-[10px] text-zinc-700">
                            {event.note}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {event.latency ? (
                          <span className="text-[10px] text-zinc-600 font-mono w-12 text-right">
                            {event.latency}ms
                          </span>
                        ) : (
                          <span className="w-12"></span>
                        )}
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded w-12 text-center ${
                            event.status === "UP"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : event.status === "FAILOVER"
                              ? "bg-amber-500/10 text-amber-400"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          {event.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Test Router Section */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Test Router
            </h2>
            <div className="flex-1 h-px bg-zinc-800/50"></div>
            {lastRoutedTo && (
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                  lastRoutedTo === "openai"
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-violet-500/10 text-violet-400"
                }`}
              >
                {lastRoutedTo === "openai" ? "OpenAI" : "Anthropic"}
              </span>
            )}
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden">
            {/* Chat History */}
            {chatHistory.length > 0 && (
              <div className="border-b border-zinc-800/50 p-4 max-h-48 overflow-y-auto space-y-2">
                {chatHistory.map((msg, i) => (
                  <div key={i} className="flex gap-2">
                    <span
                      className={`text-[10px] font-mono mt-0.5 w-14 flex-shrink-0 ${
                        msg.role === "user"
                          ? "text-cyan-400"
                          : msg.role === "error"
                          ? "text-red-400"
                          : "text-violet-400"
                      }`}
                    >
                      {msg.role === "user"
                        ? "you"
                        : msg.role === "error"
                        ? "error"
                        : msg.routedTo === "openai"
                        ? "openai"
                        : "anthro"}
                    </span>
                    <span
                      className={`text-xs ${
                        msg.role === "error"
                          ? "text-red-400"
                          : "text-zinc-400"
                      }`}
                    >
                      {msg.text}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="flex gap-2 p-3">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder="Send a test message to the router..."
                className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500/30 transition-colors"
              />
              <button
                onClick={sendChat}
                disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 text-black font-semibold text-xs hover:shadow-[0_0_20px_rgba(34,211,238,0.2)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {chatLoading ? "..." : "Send"}
              </button>
            </div>
          </div>
        </div>

        {/* Latency Chart */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Latency
            </h2>
            <div className="flex-1 h-px bg-zinc-800/50"></div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-emerald-500 rounded"></div>
                <span className="text-[10px] text-zinc-600">OpenAI</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-violet-500 rounded"></div>
                <span className="text-[10px] text-zinc-600">Anthropic</span>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-5">
            {chartData.length < 2 ? (
              <div className="h-[200px] flex items-center justify-center text-zinc-700 text-xs">
                Collecting data points...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart
                  data={chartData}
                  margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="openaiGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="anthropicGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "#3f3f46", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    dy={8}
                  />
                  <YAxis
                    tick={{ fill: "#3f3f46", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    dx={-5}
                    tickFormatter={(v) => `${v}ms`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="anthropic"
                    stroke="#a78bfa"
                    strokeWidth={1.5}
                    fill="url(#anthropicGrad)"
                    dot={false}
                    activeDot={{ r: 3, fill: "#a78bfa" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="openai"
                    stroke="#10b981"
                    strokeWidth={1.5}
                    fill="url(#openaiGrad)"
                    dot={false}
                    activeDot={{ r: 3, fill: "#10b981" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* System Info Footer */}
        <div className="border-t border-zinc-800/50 pt-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              System
            </h2>
            <div className="flex-1 h-px bg-zinc-800/50"></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
              <div className="text-[10px] text-zinc-600 mb-1">Framework</div>
              <div className="text-xs text-zinc-400">Next.js 16 + Turbopack</div>
            </div>
            <div className="bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
              <div className="text-[10px] text-zinc-600 mb-1">Visualization</div>
              <div className="text-xs text-zinc-400">Recharts</div>
            </div>
            <div className="bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
              <div className="text-[10px] text-zinc-600 mb-1">Check Interval</div>
              <div className="text-xs text-zinc-400">10 seconds</div>
            </div>
            <div className="bg-zinc-900/30 border border-zinc-800/30 rounded-lg p-3">
              <div className="text-[10px] text-zinc-600 mb-1">Architecture</div>
              <div className="text-xs text-zinc-400">Multi-Agent (LangGraph)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-800/30 mt-12 py-6 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-cyan-400 to-violet-400 flex items-center justify-center">
              <span className="text-black font-bold text-[8px]">N</span>
            </div>
            <span className="text-[10px] text-zinc-700">
              NEXUS by Tanish @ Chitkara University
            </span>
          </div>
          <span className="text-[10px] text-zinc-800">
            Autonomous API Resilience
          </span>
        </div>
      </footer>
    </main>
  );
}