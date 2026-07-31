"use client";

import { useState, useEffect } from "react";

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Function to fetch health data
  const fetchHealth = async () => {
    try {
      const response = await fetch("/api/health");
      const result = await response.json();
      setData(result);
      setLoading(false);
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

  // Helper function to get status color
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

  // Calculate failovers (will be 0 for now)
  const failovers = 0;

  // Calculate uptime percentage
  const uptime = data?.openai?.status === "UP" && data?.anthropic?.status === "UP" ? "100%" : "50%";

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
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-xs text-zinc-500">Live</span>
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
        <div className="grid grid-cols-3 gap-4 mb-12">
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
            <div className="text-xs text-zinc-500 mt-1">Failovers</div>
          </div>
        </div>

        {/* API Cards */}
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
          Monitored APIs
        </h2>
        <div className="grid grid-cols-2 gap-4">
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
                className={`w-3 h-3 rounded-full ${loading ? "bg-zinc-600 animate-pulse" : getStatusColor(data?.openai?.status)}`}
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
                className={`w-3 h-3 rounded-full ${loading ? "bg-zinc-600 animate-pulse" : getStatusColor(data?.anthropic?.status)}`}
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
        </div>

        {/* Last Checked */}
        <div className="mt-8 text-center text-xs text-zinc-600">
          {data?.checkedAt 
            ? `Last checked: ${new Date(data.checkedAt).toLocaleTimeString()}`
            : "Waiting for first check..."
          }
        </div>

        {/* Debug Panel (optional - helps you see what's happening) */}
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