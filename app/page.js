"use client";

import { useState, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [latencyHistory, setLatencyHistory] = useState([]);
  const logRef = useRef(null);

  // NEW: Chat state
  const [chatInput, setChatInput] = useState("");
  const [chatResponse, setChatResponse] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [lastRoutedTo, setLastRoutedTo] = useState(null);

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

  // NEW: Send chat message
  const sendChat = async () => {
    if (!chatInput.trim()) return;
    setChatLoading(true);
    setChatResponse(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatInput }),
      });
      const result = await response.json();

      if (result.error) {
        setChatResponse({ error: result.error });
      } else {
        setChatResponse(result);
        setLastRoutedTo(result.routedTo);

        // Add failover event to log
        const timestamp = new Date().toLocaleTimeString();
        if (result.routedTo === "anthropic" && data?.openai?.status === "DOWN") {
          const failoverEvent = {
            id: Date.now() + "-failover",
            time: timestamp,
            api: "ROUTER",
            status: "FAILOVER",
            latency: null,
            note: `OpenAI DOWN → Routed to Anthropic`,
          };
          setEvents((prev) => [failoverEvent, ...prev].slice(0, 50));
        }
      }
    } catch (error) {
      setChatResponse({ error: error.message });
    }

    setChatLoading(false);
  };

  // NEW: Simulate outage
  const simulateOutage = async (api, action) => {
    try {
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api, action }),
      });
      const result = await response.json();

      if (result.success) {
        // Add event to log
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

        // Immediately refresh health data
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
  const failovers = events.filter((e) => e.status === "DOWN" || e.status === "FAILOVER").length;
  const allUp = data?.openai?.status === "UP" && data?.anthropic?.status === "UP";
  const uptime = allUp ? "100%" : "50%";

  // Chart data
  const chartData = [...latencyHistory].reverse();

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs">
          <p className="text-zinc-400 mb-1">{label}</p>
          <p className="text-emerald-400">OpenAI: {payload[0]?.value}ms</p>
          <p className="text-violet-400">Anthropic: {payload[1]?.value}ms</p>
        </div>
      );
    }
    return null;
  };

  return (
    <main className="min-h-screen bg-[#09090b] text-white">
      {/* Navigation */}
      <nav className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-violet-400 flex items-center justify-center">
              <span className="text-black font-bold text-sm">N</span>
            </div>
            <span className="font-bold text-sm tracking-wider">NEXUS</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-zinc-600">{events.length} events logged</span>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-xs text-zinc-500">Live</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-5xl font-black tracking-tighter mb-3">
            <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
              NEXUS
            </span>
          </h1>
          <p className="text-zinc-500 text-lg">
            Autonomous Multi-Agent API Resilience System
          </p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-4 mb-12">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-cyan-400">2</div>
            <div className="text-xs text-zinc-500 mt-1">APIs Monitored</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-emerald-400">{uptime}</div>
            <div className="text-xs text-zinc-500 mt-1">Uptime</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-violet-400">{failovers}</div>
            <div className="text-xs text-zinc-500 mt-1">Incidents</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-amber-400">{events.length}</div>
            <div className="text-xs text-zinc-500 mt-1">Total Checks</div>
          </div>
        </div>

        {/* Three Column Layout */}
        <div className="grid grid-cols-5 gap-6 mb-8">
          {/* Left: API Cards + Controls */}
          <div className="col-span-2 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Monitored APIs
            </h2>

            {/* OpenAI Card */}
            <div className={`bg-zinc-900 border rounded-xl p-6 ${
              data?.openai?.status === "DOWN" ? "border-red-500/30" : "border-zinc-800"
            }`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <span className="text-emerald-400 text-sm font-bold">OA</span>
                  </div>
                  <div>
                    <div className="font-semibold">OpenAI</div>
                    <div className="text-xs text-zinc-500">GPT-4o API</div>
                  </div>
                </div>
                <div
                  className={`w-3 h-3 rounded-full ${
                    loading ? "bg-zinc-600 animate-pulse" : getStatusColor(data?.openai?.status)
                  }`}
                ></div>
              </div>
              <div className="flex justify-between text-xs text-zinc-500">
                <span>Response Time:</span>
                <span className={getStatusTextColor(data?.openai?.status)}>
                  {loading ? "Checking..." : data?.openai?.latency ? `${data.openai.latency}ms` : "N/A"}
                </span>
              </div>
              <div className="flex justify-between text-xs text-zinc-500 mt-2">
                <span>Status:</span>
                <span className={getStatusTextColor(data?.openai?.status)}>
                  {loading ? "Checking..." : data?.openai?.status || "Unknown"}
                </span>
              </div>
            </div>

            {/* Anthropic Card */}
            <div className={`bg-zinc-900 border rounded-xl p-6 ${
              data?.anthropic?.status === "DOWN" ? "border-red-500/30" : "border-zinc-800"
            }`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <span className="text-violet-400 text-sm font-bold">AN</span>
                  </div>
                  <div>
                    <div className="font-semibold">Anthropic</div>
                    <div className="text-xs text-zinc-500">Claude API</div>
                  </div>
                </div>
                <div
                  className={`w-3 h-3 rounded-full ${
                    loading ? "bg-zinc-600 animate-pulse" : getStatusColor(data?.anthropic?.status)
                  }`}
                ></div>
              </div>
              <div className="flex justify-between text-xs text-zinc-500">
                <span>Response Time:</span>
                <span className={getStatusTextColor(data?.anthropic?.status)}>
                  {loading ? "Checking..." : data?.anthropic?.latency ? `${data.anthropic.latency}ms` : "N/A"}
                </span>
              </div>
              <div className="flex justify-between text-xs text-zinc-500 mt-2">
                <span>Status:</span>
                <span className={getStatusTextColor(data?.anthropic?.status)}>
                  {loading ? "Checking..." : data?.anthropic?.status || "Unknown"}
                </span>
              </div>
            </div>

            {/* NEW: Simulate Outage Controls */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-4">
                ⚡ Simulate Outage (Demo)
              </h3>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => simulateOutage("openai", "down")}
                    className="flex-1 text-xs font-medium px-3 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                  >
                    Kill OpenAI
                  </button>
                  <button
                    onClick={() => simulateOutage("openai", "up")}
                    className="flex-1 text-xs font-medium px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                  >
                    Restore OpenAI
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => simulateOutage("anthropic", "down")}
                    className="flex-1 text-xs font-medium px-3 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                  >
                    Kill Anthropic
                  </button>
                  <button
                    onClick={() => simulateOutage("anthropic", "up")}
                    className="flex-1 text-xs font-medium px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                  >
                    Restore Anthropic
                  </button>
                </div>
              </div>
            </div>

            <div className="text-center text-xs text-zinc-600">
              {data?.checkedAt
                ? `Last checked: ${new Date(data.checkedAt).toLocaleTimeString()}`
                : "Waiting for first check..."}
            </div>
          </div>

          {/* Right: Event Log */}
          <div className="col-span-3">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                Event Log
              </h2>
              <span className="text-xs text-zinc-600">Newest first</span>
            </div>

            <div
              ref={logRef}
              className="bg-zinc-900 border border-zinc-800 rounded-xl h-[500px] overflow-y-auto"
            >
              {events.length === 0 ? (
                <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
                  Waiting for first health check...
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/50">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-zinc-600 font-mono w-16">
                          {event.time}
                        </span>
                        <div
                          className={`w-2 h-2 rounded-full ${getStatusColor(event.status)}`}
                        ></div>
                        <span className={`text-sm font-medium ${getApiColor(event.api)}`}>
                          {event.api}
                        </span>
                        {event.note && (
                          <span className="text-xs text-zinc-600">— {event.note}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        {event.latency ? (
                          <span className="text-xs text-zinc-500 w-16 text-right">
                            {event.latency}ms
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-600 w-16 text-right">—</span>
                        )}
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded ${
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

        {/* NEW: Test Chat Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Test Router — Send a Message
            </h2>
            {lastRoutedTo && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                lastRoutedTo === "openai"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-violet-500/10 text-violet-400"
              }`}>
                Routed to: {lastRoutedTo === "openai" ? "OpenAI" : "Anthropic"}
              </span>
            )}
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <div className="flex gap-3 mb-4">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder="Type a message to test the router..."
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50"
              />
              <button
                onClick={sendChat}
                disabled={chatLoading || !chatInput.trim()}
                className="px-6 py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 text-black font-semibold text-sm hover:shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {chatLoading ? "Sending..." : "Send"}
              </button>
            </div>

            {chatResponse && (
              <div className={`p-4 rounded-lg text-sm ${
                chatResponse.error
                  ? "bg-red-500/10 border border-red-500/20 text-red-400"
                  : "bg-zinc-800 border border-zinc-700 text-zinc-300"
              }`}>
                {chatResponse.error ? (
                  <span>⚠️ {chatResponse.error}</span>
                ) : (
                  <div>
                    <div className="text-xs text-zinc-500 mb-2">
                      Routed to <span className={chatResponse.routedTo === "openai" ? "text-emerald-400" : "text-violet-400"}>{chatResponse.routedTo === "openai" ? "OpenAI" : "Anthropic"}</span> at {new Date(chatResponse.routedAt).toLocaleTimeString()}
                    </div>
                    <p>{chatResponse.message}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Latency Chart */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Latency Over Time
            </h2>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-emerald-500 rounded"></div>
                <span className="text-xs text-zinc-500">OpenAI</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-violet-500 rounded"></div>
                <span className="text-xs text-zinc-500">Anthropic</span>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            {chartData.length < 2 ? (
              <div className="h-[250px] flex items-center justify-center text-zinc-600 text-sm">
                Collecting data...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "#52525b", fontSize: 11 }}
                    axisLine={{ stroke: "#27272a" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#52525b", fontSize: 11 }}
                    axisLine={{ stroke: "#27272a" }}
                    tickLine={false}
                    label={{ value: "ms", angle: -90, position: "insideLeft", fill: "#52525b", fontSize: 11 }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="openai" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#10b981" }} />
                  <Line type="monotone" dataKey="anthropic" stroke="#a78bfa" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#a78bfa" }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Debug */}
        <details className="mt-8">
          <summary className="text-xs text-zinc-600 cursor-pointer hover:text-zinc-400">
            Debug: Raw API Response
          </summary>
          <pre className="mt-2 p-4 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-500 overflow-auto">
            {JSON.stringify(data, null, 2)}
          </pre>
        </details>
      </div>
    </main>
  );
}