"use client";

import { useState, useEffect } from "react";

const PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini", label: "Gemini" },
];

export default function ApiKeyPanel({ getAuthHeaders }) {
  // null = still loading, object = loaded (missing provider = no key set)
  const [keys, setKeys] = useState(null);
  const [inputs, setInputs] = useState({ openai: "", anthropic: "", gemini: "" });
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const headers = await getAuthHeaders();
        const response = await fetch("/api/keys", { headers });
        const result = await response.json();
        if (ignore) return;
        if (!response.ok) {
          setLoadError(result.error || "Failed to load keys");
          return;
        }
        const map = {};
        for (const k of result.keys) map[k.provider] = k.unreadable ? "UNREADABLE" : k.maskedKey;
        setKeys(map);
      } catch {
        if (!ignore) setLoadError("Failed to load keys");
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [getAuthHeaders]);

  const saveKey = async (provider) => {
    const apiKey = inputs[provider].trim();
    if (!apiKey) {
      setNotice("Enter a key first.");
      return;
    }
    setBusy(provider);
    setNotice("");
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/keys", {
        method: "PUT",
        headers,
        body: JSON.stringify({ provider, apiKey }),
      });
      const result = await response.json();
      if (response.ok) {
        setKeys((prev) => ({ ...prev, [provider]: result.maskedKey }));
        setInputs((prev) => ({ ...prev, [provider]: "" }));
        setNotice(label(provider) + " key saved.");
      } else {
        setNotice(result.error || "Failed to save key.");
      }
    } catch {
      setNotice("Failed to save key.");
    } finally {
      setBusy(null);
    }
  };

  const deleteKey = async (provider) => {
    setBusy(provider);
    setNotice("");
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/keys", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ provider }),
      });
      const result = await response.json();
      if (response.ok) {
        setKeys((prev) => {
          const next = { ...prev };
          delete next[provider];
          return next;
        });
        setNotice(label(provider) + " key removed — back to SIM mode.");
      } else {
        setNotice(result.error || "Failed to remove key.");
      }
    } catch {
      setNotice("Failed to remove key.");
    } finally {
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-5">
        <PanelHeader />
        <div className="text-[11px] text-red-400/80 bg-red-500/5 border border-red-500/10 rounded-lg p-3">
          {loadError}
        </div>
      </div>
    );
  }

  if (keys === null) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-5">
        <PanelHeader />
        <div className="text-[10px] text-zinc-600 uppercase tracking-wider font-mono">Loading keys...</div>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-5">
      <PanelHeader />
      <div className="space-y-3">
        {PROVIDERS.map((p) => (
          <div key={p.id}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-zinc-500">{p.label}</span>
              {keys[p.id] === "UNREADABLE" ? (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                  UNREADABLE
                </span>
              ) : keys[p.id] ? (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  REAL {keys[p.id]}
                </span>
              ) : (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-zinc-800/50 text-zinc-500 border border-zinc-700/50">
                  SIM
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              <input
                type="password"
                value={inputs[p.id]}
                onChange={(e) => setInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                placeholder={keys[p.id] ? "Replace key..." : "Paste your API key..."}
                disabled={busy === p.id}
                className="flex-1 min-w-0 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-50"
              />
              <button
                onClick={() => saveKey(p.id)}
                disabled={busy === p.id || !inputs[p.id].trim()}
                className="text-[10px] font-medium px-2.5 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {busy === p.id ? "..." : "Save"}
              </button>
              {keys[p.id] && (
                <button
                  onClick={() => deleteKey(p.id)}
                  disabled={busy === p.id}
                  className="text-[10px] font-medium px-2 py-1.5 rounded-lg bg-red-500/5 text-red-400/60 border border-red-500/10 hover:bg-red-500/10 hover:text-red-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Del
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {notice && <div className="mt-3 text-[10px] text-amber-400/80">{notice}</div>}
      <div className="mt-3 pt-3 border-t border-zinc-800/50 text-[9px] text-zinc-600 leading-relaxed">
        Bring your own key — stored privately in your account, never shown in full again, never used to call providers for other users.
      </div>
    </div>
  );
}

function PanelHeader() {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[10px]">🔑</span>
      <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">API Keys</h3>
    </div>
  );
}
