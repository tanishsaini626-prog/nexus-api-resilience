"use client";

import { useState } from "react";

export default function ChatPanel({ data, setEvents, setFailoverFlash, setLastRoutedTo }) {
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);

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

  return (
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
  );
}
