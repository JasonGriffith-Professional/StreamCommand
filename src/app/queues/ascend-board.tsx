"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface RusherQueueRow { id: number; position: number; twitch_name: string; group_size: number; off_duty: boolean; }
interface RaffleState { active: boolean; end_time: string | null; rusher_twitch_name: string | null; entry_count: number; paused: boolean; pause_remaining_secs: number | null; }
interface RaffleEntry { id: number; twitch_name: string; joined_at: string; }
interface BadActor { id: number; twitch_name: string; ascend_backouts: number; offduty_backouts: number; banned: boolean; notes: string; }

interface Props {
  initialRusherQueue: RusherQueueRow[];
  initialRaffleState: RaffleState;
  initialEntries: RaffleEntry[];
  initialBadActors: BadActor[];
  initialChannel: string;
  initialTestTimer: boolean;
}

export default function AscendBoard({ initialRusherQueue, initialRaffleState, initialEntries, initialBadActors, initialChannel, initialTestTimer }: Props) {
  const [rusherQueue, setRusherQueue] = useState(initialRusherQueue);
  const [raffleState, setRaffleState] = useState(initialRaffleState);
  const [entries, setEntries] = useState(initialEntries);
  const [badActors, setBadActors] = useState(initialBadActors);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [showBadActors, setShowBadActors] = useState(false);
  const [activeChannel, setActiveChannel] = useState(initialChannel);
  const [testTimer, setTestTimer] = useState(initialTestTimer);
  const [switchingChannel, setSwitchingChannel] = useState(false);

  // Realtime subscriptions
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("ascend-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "ftk_rusher_queue" }, () => {
        supabase.from("ftk_rusher_queue").select("*").eq("off_duty", false).order("position").then(({ data }) => {
          if (data) setRusherQueue(data);
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "ftk_raffle_state" }, () => {
        supabase.from("ftk_raffle_state").select("*").eq("id", 1).single().then(({ data }) => {
          if (data) setRaffleState(data);
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "ftk_raffle_entries" }, () => {
        supabase.from("ftk_raffle_entries").select("*").order("joined_at").then(({ data }) => {
          if (data) setEntries(data);
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "ftk_bad_actors" }, () => {
        supabase.from("ftk_bad_actors").select("*").order("twitch_name").then(({ data }) => {
          if (data) setBadActors(data);
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Polling fallback — bot writes via service role which doesn't always trigger realtime
  useEffect(() => {
    const supabase = createClient();
    const poll = async () => {
      const [{ data: e }, { data: s }, { data: q }] = await Promise.all([
        supabase.from("ftk_raffle_entries").select("*").order("joined_at"),
        supabase.from("ftk_raffle_state").select("*").eq("id", 1).single(),
        supabase.from("ftk_rusher_queue").select("*").eq("off_duty", false).order("position"),
      ]);
      if (e) setEntries((prev) => JSON.stringify(prev.map(x=>x.id)) === JSON.stringify(e.map((x:typeof prev[0])=>x.id)) ? prev : e);
      if (s) setRaffleState((prev) => JSON.stringify(prev) === JSON.stringify(s) ? prev : s);
      if (q) setRusherQueue((prev) => JSON.stringify(prev.map(x=>x.id)) === JSON.stringify(q.map((x:typeof prev[0])=>x.id)) ? prev : q);
    };
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!raffleState.active) { setSecondsLeft(0); return; }
    if (raffleState.paused) {
      setSecondsLeft(raffleState.pause_remaining_secs ?? 0);
      return;
    }
    if (!raffleState.end_time) { setSecondsLeft(0); return; }
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(raffleState.end_time!).getTime() - Date.now()) / 1000));
      setSecondsLeft(diff);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [raffleState.active, raffleState.end_time, raffleState.paused, raffleState.pause_remaining_secs]);

  const moveRusher = useCallback(async (id: number, direction: "up" | "down") => {
    const res = await fetch("/api/rushers/queue/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, direction }),
    });
    if (res.ok) {
      const supabase = createClient();
      const { data } = await supabase.from("ftk_rusher_queue").select("*").order("position");
      if (data) setRusherQueue(data);
    }
  }, []);

  const removeRusher = useCallback(async (id: number, name: string) => {
    if (!confirm(`Remove ${name} from the queue?`)) return;
    await fetch(`/api/rushers/queue/${id}`, { method: "DELETE" });
  }, []);

  const toggleBan = useCallback(async (actor: BadActor) => {
    await fetch(`/api/bad-actors/${actor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ banned: !actor.banned }),
    });
  }, []);

  const [drawError, setDrawError] = useState<string | null>(null);
  const [lastDraw, setLastDraw] = useState<{ winners: string[]; rusher: string | null } | null>(null);
  const [shuffling, setShuffling] = useState(false);
  const [sortAlpha, setSortAlpha] = useState(false);

  const runShuffleAnimation = useCallback((entriesList: typeof entries, durationMs: number) => {
    setShuffling(true);
    const start = Date.now();
    const tick = () => {
      if (Date.now() - start >= durationMs) { setShuffling(false); return; }
      setEntries((prev) => {
        const copy = [...prev];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      });
      setTimeout(tick, 80);
    };
    tick();
    return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
  }, []);


  const quickDrawForHead = useCallback(async () => {
    const head = rusherQueue[0];
    if (!head || entries.length === 0) return;
    setDrawError(null);
    setSortAlpha(false);
    const [, res] = await Promise.all([
      runShuffleAnimation(entries, 1200),
      fetch("/api/raffle/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: head.group_size, rusher: head.twitch_name }),
      }),
    ]);
    if (res.ok) {
      const data = await res.json();
      setLastDraw({ winners: data.winners, rusher: data.rusher });
      setRaffleState((prev) => ({ ...prev, active: false, end_time: null }));
      const winnerSet = new Set((data.winners as string[]).map((w: string) => w.toLowerCase()));
      setEntries((prev) => prev.filter((e) => !winnerSet.has(e.twitch_name.toLowerCase())));
      setRusherQueue((prev) => prev.filter((r) => r.twitch_name.toLowerCase() !== head.twitch_name.toLowerCase()));
    } else {
      const body = await res.json().catch(() => ({}));
      setDrawError(body.error ?? "Draw failed");
    }
  }, [rusherQueue, entries, runShuffleAnimation]);

  const reopenQueue = useCallback(async () => {
    if (raffleState.active) {
      // Close early — optimistic
      setRaffleState((prev) => ({ ...prev, active: false, end_time: null }));
      await fetch("/api/raffle/close", { method: "POST" });
    } else {
      // Reopen — let the bot set the real end_time (respects test timer mode)
      setRaffleState((prev) => ({ ...prev, active: true }));
      const res = await fetch("/api/raffle/reopen", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.end_time) {
          const endTime = typeof data.end_time === "number"
            ? new Date(data.end_time * 1000).toISOString()
            : data.end_time;
          setRaffleState((prev) => ({ ...prev, active: true, end_time: endTime, paused: false }));
        }
      }
    }
  }, [raffleState.active]);


  const [manualEntry, setManualEntry] = useState("");
  const addManualEntry = useCallback(async () => {
    const name = manualEntry.trim();
    if (!name) return;
    const res = await fetch("/api/raffle/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ twitch_name: name }),
    });
    if (res.ok) {
      setEntries((prev) => [...prev, { id: Date.now(), twitch_name: name, joined_at: new Date().toISOString() }]);
    }
    setManualEntry("");
  }, [manualEntry]);

  const switchChannel = useCallback(async (channel: string) => {
    if (channel === activeChannel || switchingChannel) return;
    setSwitchingChannel(true);
    const res = await fetch("/api/bot/channel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    });
    if (res.ok) setActiveChannel(channel);
    setSwitchingChannel(false);
  }, [activeChannel, switchingChannel]);

  const toggleTestTimer = useCallback(async () => {
    const res = await fetch("/api/bot/test-timer", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setTestTimer(data.test_timer);
    }
  }, []);

  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const timerColor = secondsLeft <= 30 && raffleState.active ? "text-amber-400" : "text-green-400";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Ascend Monitor</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Live control panel — changes sync to the bot instantly</p>
        </div>
        <div className="flex items-center gap-3">
          {raffleState.active && (
            <div className="flex items-center gap-2">
              <div className={cn("text-lg font-mono font-bold tabular-nums", raffleState.paused ? "text-yellow-400" : timerColor)}>
                {raffleState.paused ? "⏸" : "⏱"} {m}:{s.toString().padStart(2, "0")}
              </div>
              <button
                onClick={async () => {
                  await fetch("/api/raffle/pause", { method: "POST" });
                  setRaffleState((prev) => prev.paused
                    ? { ...prev, paused: false, end_time: new Date(Date.now() + (prev.pause_remaining_secs ?? 0) * 1000).toISOString() }
                    : { ...prev, paused: true, pause_remaining_secs: secondsLeft }
                  );
                }}
                className={cn(
                  "text-xs px-2 py-1 rounded font-medium transition-colors",
                  raffleState.paused
                    ? "bg-yellow-800/60 hover:bg-yellow-700/60 text-yellow-300"
                    : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
                )}
              >
                {raffleState.paused ? "▶ Resume" : "⏸ Pause"}
              </button>
            </div>
          )}
          {!raffleState.active && (
            <span className="text-xs text-zinc-600 italic">No active raffle</span>
          )}
          {/* Channel selector */}
          <div className="flex items-center gap-1 rounded-lg border border-zinc-700 overflow-hidden">
            {["barricade", "psynister"].map((ch) => (
              <button
                key={ch}
                onClick={() => switchChannel(ch)}
                disabled={switchingChannel}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                  activeChannel === ch
                    ? "bg-purple-700 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                )}
              >
                #{ch}
              </button>
            ))}
          </div>

          {/* Test timer toggle */}
          <button
            onClick={toggleTestTimer}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
              testTimer
                ? "bg-orange-900/60 border-orange-700/60 text-orange-300 hover:bg-orange-800/60"
                : "bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300"
            )}
            title={testTimer ? "Test timer ON (10s) — click to disable" : "Enable test timer (10s raffles)"}
          >
            {testTimer ? "⚡ Test 10s" : "Test Timer"}
          </button>

          <button
            onClick={() => setShowBadActors((v) => !v)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-900/60 hover:bg-purple-800/60 text-purple-300 border border-purple-800/40 transition-colors"
          >
            ⚠ Bad Actors {badActors.length > 0 && `(${badActors.length})`}
          </button>
        </div>
      </div>

      {/* Bad actors panel */}
      {showBadActors && (
        <div className="rounded-xl border border-purple-800/40 bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-purple-300 mb-3">Bad Actor Log</h2>
          {badActors.length === 0 ? (
            <p className="text-xs text-zinc-600 italic">No records yet.</p>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-5 gap-2 text-xs text-zinc-500 font-medium mb-2 px-2">
                <span>Player</span>
                <span className="text-center">!ascend backouts</span>
                <span className="text-center">!offduty backouts</span>
                <span className="text-center">Status</span>
                <span />
              </div>
              {badActors.map((a) => (
                <div key={a.id} className={cn(
                  "grid grid-cols-5 gap-2 items-center px-2 py-1.5 rounded-lg text-sm",
                  a.banned ? "bg-red-950/40 border border-red-900/30" : "bg-zinc-800/50"
                )}>
                  <span className={a.banned ? "text-red-400 font-medium" : "text-white"}>{a.twitch_name}</span>
                  <span className="text-center text-zinc-300">{a.ascend_backouts}</span>
                  <span className="text-center text-zinc-300">{a.offduty_backouts}</span>
                  <span className={cn("text-center text-xs font-medium", a.banned ? "text-red-400" : "text-zinc-500")}>
                    {a.banned ? "BANNED" : "ok"}
                  </span>
                  <div className="flex justify-end">
                    <button
                      onClick={() => toggleBan(a)}
                      className={cn(
                        "px-2 py-1 rounded text-xs font-medium transition-colors",
                        a.banned
                          ? "bg-green-900/60 hover:bg-green-800/60 text-green-400"
                          : "bg-red-900/60 hover:bg-red-800/60 text-red-400"
                      )}
                    >
                      {a.banned ? "Unban" : "Ban"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Winners banner */}
      {lastDraw && (
        <div className="rounded-xl border border-green-700/50 bg-green-950/40 p-4 flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-green-400 uppercase tracking-wider">
              {!lastDraw.rusher ? "Winners — no rusher assigned"
                : lastDraw.rusher.toLowerCase() === "barricade" ? "Winners"
                : `${lastDraw.rusher} carrying`}
            </p>
            <div className="flex flex-wrap gap-2">
              {lastDraw.winners.map((w) => (
                <span key={w} className="text-base font-bold text-white bg-green-900/50 border border-green-700/40 px-3 py-1 rounded-full">
                  @{w}
                </span>
              ))}
            </div>
            {rusherQueue.length >= 1 && entries.length > 0 && (
              <button
                onClick={quickDrawForHead}
                disabled={entries.length === 0}
                className="mt-2 px-3 py-1.5 rounded-lg bg-green-800/60 hover:bg-green-700/60 disabled:opacity-40 text-sm font-semibold text-green-200 transition-colors"
              >
                {`▶ Draw for ${rusherQueue[0]?.twitch_name} ×${rusherQueue[0]?.group_size} next`}
              </button>
            )}
          </div>
          <button onClick={() => setLastDraw(null)} className="text-green-700 hover:text-green-400 text-lg leading-none flex-shrink-0">✕</button>
        </div>
      )}

      {/* Main two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Left: Raffle entries */}
        <div className="lg:col-span-3 rounded-xl border border-zinc-800 bg-zinc-900 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-white text-sm">!ascend Queue</h2>
              <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">
                {entries.length} entries
              </span>
              {rusherQueue[0] && (
                <span className="text-xs text-green-400">
                  Rusher: <span className="font-medium">{rusherQueue[0].twitch_name}</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {entries.length > 0 && !shuffling && (
                <button
                  onClick={() => setSortAlpha((v) => !v)}
                  className={cn(
                    "text-xs px-2 py-1 rounded transition-colors",
                    sortAlpha
                      ? "bg-purple-700/50 text-purple-300 hover:bg-purple-700/70"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  )}
                >
                  {sortAlpha ? "A→Z ✓" : "A→Z"}
                </button>
              )}
              <button
                onClick={async () => {
                  const names = Array.from({ length: 10 }, (_, i) => `player${i + 1}`);
                  const added: typeof entries = [];
                  for (const name of names) {
                    const res = await fetch("/api/raffle/entries", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ twitch_name: name }),
                    });
                    if (res.ok) added.push({ id: Date.now() + Math.random(), twitch_name: name, joined_at: new Date().toISOString() });
                  }
                  setEntries((prev) => [...prev, ...added]);
                }}
                className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 transition-colors"
              >
                + Test ×10
              </button>
            </div>
          </div>

          {/* Entry list */}
          <div className="flex-1 overflow-y-auto max-h-96 p-2">
            {entries.length === 0 ? (
              <p className="text-xs text-zinc-600 italic text-center py-10">
                {raffleState.active ? "Waiting for entries…" : "No active raffle."}
              </p>
            ) : (
              <div className="space-y-0.5">
                {(sortAlpha && !shuffling
                  ? [...entries].sort((a, b) => a.twitch_name.localeCompare(b.twitch_name))
                  : entries
                ).map((e, i) => (
                  <div
                    key={e.id}
                    className={cn(
                      "flex items-center gap-3 px-3 py-1.5 rounded text-sm transition-all",
                      shuffling ? "duration-75" : "hover:bg-zinc-800/50"
                    )}
                  >
                    <span className="text-zinc-600 tabular-nums w-6 text-right">{i + 1}.</span>
                    <span className={cn("text-zinc-200", shuffling && "blur-[0.5px]")}>{e.twitch_name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="border-t border-zinc-800 p-4 space-y-3">
            {/* Manual entry */}
            <div className="flex gap-2">
              <input
                value={manualEntry}
                onChange={(e) => setManualEntry(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addManualEntry()}
                placeholder="Add username to queue…"
                className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <button
                onClick={addManualEntry}
                disabled={!manualEntry.trim()}
                className="px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-sm font-medium transition-colors"
              >
                + Add
              </button>
            </div>

            <button
              onClick={reopenQueue}
              className={cn(
                "w-full rounded-lg border py-2 text-sm transition-colors",
                raffleState.active
                  ? "border-amber-700/60 bg-amber-950/40 hover:bg-amber-900/40 text-amber-300"
                  : "border-zinc-700 hover:bg-zinc-800"
              )}
            >
              {raffleState.active ? "⛔ Close Queue" : "🔄 Reopen Queue (new 130s window)"}
            </button>

            {/* Manual draw */}
            {drawError && <p className="text-xs text-red-400">{drawError}</p>}
            <button
              onClick={quickDrawForHead}
              disabled={entries.length === 0 || rusherQueue.length === 0}
              className="w-full rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-40 py-2 text-sm font-semibold transition-colors"
            >
              {rusherQueue.length > 0
                ? `▶ Draw for ${rusherQueue[0].twitch_name} ×${rusherQueue[0].group_size}`
                : "▶ Manual Draw"}
            </button>
          </div>
        </div>

        {/* Right: Rusher queue */}
        <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <h2 className="font-semibold text-white text-sm">Rushers</h2>
            <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">
              {rusherQueue.length} on duty
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {rusherQueue.length === 0 ? (
              <p className="text-xs text-zinc-600 italic text-center py-10">
                No rushers on duty. They type !onduty [#] in chat.
              </p>
            ) : (
              <div className="space-y-1">
                {rusherQueue.map((r, i) => (
                  <div
                    key={r.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg",
                      i === 0 ? "bg-green-950/60 border border-green-900/40" : "bg-zinc-800/40"
                    )}
                  >
                    <span className={cn(
                      "text-sm font-bold w-5 text-center",
                      i === 0 ? "text-green-400" : "text-zinc-500"
                    )}>
                      {i === 0 ? "▶" : `${i + 1}.`}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm truncate", i === 0 ? "text-white font-semibold" : "text-zinc-300")}>
                        {r.twitch_name}
                      </p>
                      <p className="text-xs text-zinc-500">×{r.group_size} group</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => moveRusher(r.id, "up")}
                        disabled={i === 0}
                        className="w-7 h-7 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-xs"
                        title="Move up"
                      >↑</button>
                      <button
                        onClick={() => moveRusher(r.id, "down")}
                        disabled={i === rusherQueue.length - 1}
                        className="w-7 h-7 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-xs"
                        title="Move down"
                      >↓</button>
                      <button
                        onClick={() => removeRusher(r.id, r.twitch_name)}
                        className="w-7 h-7 rounded bg-red-900/60 hover:bg-red-800/60 text-red-400 text-xs"
                        title="Remove"
                      >✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
