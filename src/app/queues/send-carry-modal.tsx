"use client";

import { useState } from "react";
import type { ActivityType, QueueEntry, Rusher } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

interface Props {
  activity: ActivityType;
  entries: QueueEntry[];
  rusher: Rusher;
  passcode: string;
  onClose: () => void;
  onSuccess: (remaining: QueueEntry[]) => void;
}

const DRAW_SIZES = [1, 2, 3, 4, 5];

export default function SendCarryModal({ activity, entries, rusher, passcode, onClose, onSuccess }: Props) {
  const [drawCount, setDrawCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ winners: string[]; whisperResults: Record<string, string> } | null>(null);

  const maxDraw = Math.min(5, entries.length);

  async function handleSend() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/carries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queue_name: activity.name,
          rusher_id: rusher.id,
          draw_count: drawCount,
          passcode: passcode || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Carry failed");
      }
      const data = await res.json();
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
          <h3 className="text-lg font-bold text-green-400 mb-1">Carry Sent!</h3>
          <p className="text-sm text-zinc-400 mb-4">
            {activity.short_label} carry by <span className="text-white">{rusher.twitch_name}</span>
          </p>
          <div className="space-y-1 mb-6">
            {result.winners.map((w) => (
              <div key={w} className="flex items-center justify-between text-sm">
                <span className="text-white">{w}</span>
                <span className={cn(
                  "text-xs",
                  result.whisperResults[w] === "sent" ? "text-green-400" :
                  result.whisperResults[w] === "disabled" ? "text-yellow-500" : "text-red-400"
                )}>
                  {result.whisperResults[w] ?? "pending"}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => onSuccess([])}
            className="w-full rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-600"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-1">Send Carry</h3>
        <p className="text-sm text-zinc-400 mb-4">
          <span className="text-purple-400">{activity.short_label}</span> — Rusher:{" "}
          <span className="text-white">{rusher.twitch_name}</span>
          {passcode && <> — Code: <span className="font-mono text-yellow-400">{passcode}</span></>}
        </p>

        <div className="mb-4">
          <label className="text-xs text-zinc-400 mb-1 block">
            Draw how many winners? (queue has {entries.length})
          </label>
          <div className="flex gap-2">
            {DRAW_SIZES.filter((n) => n <= maxDraw).map((n) => (
              <button
                key={n}
                onClick={() => setDrawCount(n)}
                className={cn(
                  "w-9 h-9 rounded text-sm font-bold transition-colors",
                  n === drawCount ? "bg-purple-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={loading}
            className="flex-1 rounded-lg bg-purple-600 hover:bg-purple-500 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Sending…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
