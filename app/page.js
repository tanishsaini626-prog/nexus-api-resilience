"use client";

import { useState, useEffect, useRef } from "react";

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]); // NEW: stores all past checks
  const logRef = useRef(null); // NEW: reference to scroll to bottom

  // Fetch health data
  const fetchHealth = async () => {
    try {
      const response = await fetch("/api/health");
      const result = await response.json();
      setData(result);
      setLoading(false);

      // NEW: Create event entries for this check
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

      // NEW: Add to the BEGINNING of the list (newest first)
      setEvents((prev) => [...newEvents, ...prev]);

      // NEW: Keep only last 50 events (don't let it grow forever)
      setEvents((prev) => prev.slice(0, 50));

    } catch (error) {
      console.error("Failed to fetch health:", error);
      setLoading(false);
    }
  };

  // Run once on mount
  useEffect(() => {
    fetchHealth();
  }, []);

  // Run every 10 seconds
  useEffect(() => {
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  // NEW: Auto-scroll to top when new events arrive
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = 0;
    }
  }, [events]);

  // Status colors
  const getStatusColor = (status) => {
    if (status === "UP") return "bg-emerald-500";
    if (status === "DOWN") return "bg-red-500";
    return "bg-zinc-600";
  };

  const getStatusTextColor = (status) => {
    if (status === "UP") return "text-emerald-400";
    if (status === "DOWN") return "text-red-400";
    return "text-zinc-500";
  };

  const getApiColor = (api) => {
    if (api === "OpenAI") return "text-emerald-400";
    if (api === "Anthropic") return "text-violet-400";
    return "text-zinc-400";
  };

  // Calculate stats
  const failovers = events.filter((e) => e.status === "DOWN").length;
  const allUp = data?.openai?.status === "UP" && data?.anthropic?.status === "UP";
  const uptime = allUp ? "100%" : "50%";

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

        {/* Two Column Layout */}
        <div className="grid grid-cols-5 gap-6">
          {/* Left: API Cards (takes 2 columns) */}
          <div className="col-span-2 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Monitored APIs
            </h2>

            {/* OpenAI Card */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
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
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
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

            {/* Last Checked */}
            <div className="text-center text-xs text-zinc-600">
              {data?.checkedAt
                ? `Last checked: ${new Date(data.checkedAt).toLocaleTimeString()}`
                : "Waiting for first check..."}
            </div>
          </div>

          {/* Right: Event Log (takes 3 columns) */}
          <div className="col-span-3">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
                Event Log
              </h2>
              <span className="text-xs text-zinc-600">Newest first</span>
            </div>

            <div
              ref={logRef}
              className="bg-zinc-900 border border-zinc-800 rounded-xl h-[420px] overflow-y-auto"
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
                      {/* Left: Time + API Name */}
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
                      </div>

                      {/* Right: Status + Latency */}
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

        {/* Debug Panel */}
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