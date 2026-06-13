"use client";

import { useState } from "react";
import type { ActivityType, QueueEntry, Rusher } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import SendCarryModal from "./send-carry-modal";

interface Props {
  activity: ActivityType;
  entries: QueueEntry[];
  eligibleRushers: Rusher[];
  allRushers: Rusher[];
  onCarrySent: (remaining: QueueEntry[]) => void;
}

export default function QueueCard({ activity, entries, eligibleRushers, allRushers, onCarrySent }: Props) {
  const [selectedRusherId, setSelectedRusherId] = useState<string | null>(null);
  const [passcode, setPasscode] = useState("");
  const [showModal, setShowModal] = useState(false);

  const selectedRusher = allRushers.find((r) => r.id === selectedRusherId) ?? null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-mono text-zinc-500">
            !{activity.name}
          </span>
          <h2 className="font-semibold text-white leading-tight">{activity.label.replace(/^!\w+ — /, "")}</h2>
        </div>
        <span className={cn(
          "text-2xl font-bold tabular-nums",
          entries.length === 0 ? "text-zinc-600" : "text-purple-400"
        )}>
          {entries.length}
        </span>
      </div>

      {/* Rusher buttons */}
      <div className="flex flex-wrap gap-1 min-h-[32px]">
        {eligibleRushers.length === 0 ? (
          <span className="text-xs text-zinc-600 italic">No rushers on duty</span>
        ) : (
          eligibleRushers.map((rusher) => (
            <button
              key={rusher.id}
              onClick={() => setSelectedRusherId(rusher.id === selectedRusherId ? null : rusher.id)}
              className={cn(
                "px-2 py-1 rounded text-xs font-medium transition-colors border",
                rusher.id === selectedRusherId
                  ? "bg-green-600 border-green-500 text-white"
                  : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500"
              )}
            >
              {rusher.twitch_name}
            </button>
          ))
        )}
      </div>

      {/* Queue preview (first 5) */}
      {entries.length > 0 && (
        <div className="text-xs text-zinc-500 space-y-0.5">
          {entries.slice(0, 5).map((e, i) => (
            <div key={e.id} className="flex gap-2">
              <span className="text-zinc-700 w-4 text-right">{i + 1}.</span>
              <span>{e.twitch_username}</span>
            </div>
          ))}
          {entries.length > 5 && (
            <div className="text-zinc-700">+{entries.length - 5} more</div>
          )}
        </div>
      )}

      {/* Passcode + Send */}
      <div className="flex gap-2 mt-auto pt-1">
        <input
          type="text"
          placeholder="Passcode (optional)"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        <button
          onClick={() => setShowModal(true)}
          disabled={!selectedRusherId || entries.length === 0}
          className={cn(
            "px-3 py-1.5 rounded text-xs font-semibold transition-colors",
            selectedRusherId && entries.length > 0
              ? "bg-purple-600 hover:bg-purple-500 text-white"
              : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
          )}
        >
          Send Carry
        </button>
      </div>

      {showModal && selectedRusher && (
        <SendCarryModal
          activity={activity}
          entries={entries}
          rusher={selectedRusher}
          passcode={passcode}
          onClose={() => setShowModal(false)}
          onSuccess={(remaining) => {
            setShowModal(false);
            setSelectedRusherId(null);
            setPasscode("");
            onCarrySent(remaining);
          }}
        />
      )}
    </div>
  );
}
