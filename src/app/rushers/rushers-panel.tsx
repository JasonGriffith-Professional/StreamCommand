"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface RusherQueueRow { id: number; position: number; twitch_name: string; group_size: number; off_duty: boolean; }

interface Props {
  initialQueue: RusherQueueRow[];
  carryCounts: Record<string, number>;
}

export default function RushersPanel({ initialQueue, carryCounts }: Props) {
  const [queue, setQueue] = useState(initialQueue);
  const [newName, setNewName] = useState("");
  const [newSize, setNewSize] = useState(1);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeQueue = queue.filter((r) => !r.off_duty);
  const offDutyQueue = queue.filter((r) => r.off_duty);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("rushers-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "ftk_rusher_queue" }, () => {
        supabase.from("ftk_rusher_queue").select("*").order("position").then(({ data }) => {
          if (data) setQueue(data);
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const move = useCallback(async (id: number, direction: "up" | "down") => {
    await fetch("/api/rushers/queue/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, direction }),
    });
    const supabase = createClient();
    const { data } = await supabase.from("ftk_rusher_queue").select("*").order("position");
    if (data) setQueue(data);
  }, []);

  const remove = useCallback(async (id: number, name: string) => {
    if (!confirm(`Remove ${name} from the queue?`)) return;
    await fetch(`/api/rushers/queue/${id}`, { method: "DELETE" });
    setQueue((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const setOffDuty = useCallback(async (id: number) => {
    await fetch(`/api/rushers/queue/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ off_duty: true }),
    });
    setQueue((prev) => prev.map((r) => r.id === id ? { ...r, off_duty: true } : r));
  }, []);

  const restore = useCallback(async (id: number) => {
    await fetch(`/api/rushers/queue/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ off_duty: false }),
    });
    setQueue((prev) => prev.map((r) => r.id === id ? { ...r, off_duty: false } : r));
  }, []);

  const addTestRushers = useCallback(async () => {
    const tests = [
      { twitch_name: "Rusher1", group_size: 1 },
      { twitch_name: "Rusher2", group_size: 2 },
      { twitch_name: "Rusher3", group_size: 3 },
    ];
    for (const r of tests) {
      await fetch("/api/rushers/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r),
      });
    }
  }, []);

  const addRusher = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    setError(null);
    const res = await fetch("/api/rushers/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ twitch_name: newName.trim(), group_size: newSize }),
    });
    if (res.ok) {
      const added = await res.json();
      setQueue((prev) => [...prev, added]);
      setNewName("");
      setNewSize(1);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to add rusher");
    }
    setAdding(false);
  }, [newName, newSize]);

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Rusher Queue</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Rushers sign up via <span className="font-mono text-zinc-400">!onduty [#]</span> in chat. You can also add them manually below.
          </p>
        </div>
        <button
          onClick={addTestRushers}
          className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-400 whitespace-nowrap flex-shrink-0"
        >
          + Test Rushers
        </button>
      </div>

      {/* Active queue */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900">
        {activeQueue.length === 0 ? (
          <p className="text-sm text-zinc-600 italic text-center py-10">No rushers on duty.</p>
        ) : (
          <div className="divide-y divide-zinc-800">
            {activeQueue.map((r, i) => (
              <div key={r.id ?? r.twitch_name} className={cn(
                "flex items-center gap-3 px-4 py-3",
                i === 0 && "bg-green-950/40"
              )}>
                <span className={cn(
                  "text-sm font-bold w-6 text-center",
                  i === 0 ? "text-green-400" : "text-zinc-500"
                )}>
                  {i === 0 ? "▶" : `${i + 1}.`}
                </span>
                <div className="flex-1">
                  <span className={cn("text-sm", i === 0 ? "text-white font-semibold" : "text-zinc-300")}>
                    {r.twitch_name}
                  </span>
                  <span className="text-xs text-zinc-500 ml-2">×{r.group_size} group</span>
                  {carryCounts[r.twitch_name.toLowerCase()] != null && (
                    <span className="text-xs text-purple-400 ml-auto mr-2">
                      {carryCounts[r.twitch_name.toLowerCase()]} carries
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => move(r.id, "up")} disabled={i === 0}
                    className="w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-xs">↑</button>
                  <button onClick={() => move(r.id, "down")} disabled={i === activeQueue.length - 1}
                    className="w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-xs">↓</button>
                  <button onClick={() => setOffDuty(r.id)}
                    className="px-2 h-7 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-300">Off</button>
                  <button onClick={() => remove(r.id, r.twitch_name)}
                    className="w-7 h-7 rounded bg-red-900/60 hover:bg-red-800/60 text-red-400 text-xs">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Off-duty backup pool */}
      {offDutyQueue.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 mb-2 uppercase tracking-wider">Off Duty — Backup Pool</h2>
          <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 divide-y divide-zinc-800">
            {offDutyQueue.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex items-center flex-1">
                  <span className="text-sm text-zinc-500">{r.twitch_name}</span>
                  <span className="text-xs text-zinc-600 ml-2">×{r.group_size} group</span>
                  {carryCounts[r.twitch_name.toLowerCase()] != null && (
                    <span className="text-xs text-purple-400/60 ml-auto mr-2">
                      {carryCounts[r.twitch_name.toLowerCase()]} carries
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => restore(r.id)}
                    className="px-2 h-7 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-200">
                    Restore
                  </button>
                  <button onClick={() => remove(r.id, r.twitch_name)}
                    className="w-7 h-7 rounded bg-red-900/60 hover:bg-red-800/60 text-red-400 text-xs">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add manually */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wider">Add Manually</h2>
        <form onSubmit={addRusher} className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-zinc-500 mb-1 block">Twitch username</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="username"
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Group size</label>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setNewSize((n) => Math.max(1, n - 1))}
                className="w-7 h-9 rounded bg-zinc-800 hover:bg-zinc-700 text-sm">▼</button>
              <span className="w-6 text-center text-sm font-bold text-white">{newSize}</span>
              <button type="button" onClick={() => setNewSize((n) => Math.min(5, n + 1))}
                className="w-7 h-9 rounded bg-zinc-800 hover:bg-zinc-700 text-sm">▲</button>
            </div>
          </div>
          <button type="submit" disabled={adding || !newName.trim()}
            className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-sm font-semibold transition-colors h-9">
            {adding ? "Adding…" : "+ Add"}
          </button>
        </form>
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>
    </div>
  );
}
