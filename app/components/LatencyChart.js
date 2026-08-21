"use client";

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

export default function LatencyChart({ latencyHistory = [], degradedThreshold }) {
  const chartData = [...latencyHistory].reverse();

  if (chartData.length < 2) {
    return (
      <div className="h-[200px] flex items-center justify-center text-zinc-700 text-xs">
        Collecting data points...
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="openaiGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.2} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
          <linearGradient id="anthropicGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity={0.2} /><stop offset="100%" stopColor="#a78bfa" stopOpacity={0} /></linearGradient>
          <linearGradient id="geminiGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity={0.2} /><stop offset="100%" stopColor="#60a5fa" stopOpacity={0} /></linearGradient>
        </defs>
        <XAxis dataKey="time" tick={{ fill: "#3f3f46", fontSize: 10 }} axisLine={false} tickLine={false} dy={8} />
        <YAxis tick={{ fill: "#3f3f46", fontSize: 10 }} axisLine={false} tickLine={false} dx={-5} tickFormatter={(v) => `${v}ms`} />
        <Tooltip content={<CustomTooltip threshold={degradedThreshold} />} />
        <Area type="monotone" dataKey="gemini" stroke="#60a5fa" strokeWidth={1.5} fill="url(#geminiGrad)" dot={false} activeDot={{ r: 3, fill: "#60a5fa" }} />
        <Area type="monotone" dataKey="anthropic" stroke="#a78bfa" strokeWidth={1.5} fill="url(#anthropicGrad)" dot={false} activeDot={{ r: 3, fill: "#a78bfa" }} />
        <Area type="monotone" dataKey="openai" stroke="#10b981" strokeWidth={1.5} fill="url(#openaiGrad)" dot={false} activeDot={{ r: 3, fill: "#10b981" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
