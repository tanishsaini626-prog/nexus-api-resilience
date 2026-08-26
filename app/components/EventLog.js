"use client";

import { useEffect, useRef } from "react";
import { getStatusBg } from "./statusStyles";

const getStatusColor = (status) => {
  if (status === "HEALTHY") return "bg-emerald-500";
  if (status === "DEGRADED") return "bg-amber-500";
  if (status === "DOWN") return "bg-red-500";
  if (status === "FAILOVER") return "bg-cyan-500";
  if (status === "FLAPPING") return "bg-orange-500";
  return "bg-zinc-600";
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

export default function EventLog({ events = [] }) {
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [events]);

  return (
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
  );
}
