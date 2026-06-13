"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ActivityType, QueueEntry, Rusher } from "@/lib/supabase/types";
import QueueCard from "./queue-card";

interface Props {
  initialRushers: Rusher[];
  initialQueueEntries: QueueEntry[];
  activities: ActivityType[];
}

export default function QueuesBoard({ initialRushers, initialQueueEntries, activities }: Props) {
  const [rushers, setRushers] = useState<Rusher[]>(initialRushers);
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>(initialQueueEntries);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("ftk-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "ftk_queue_entries" }, () => {
        supabase.from("ftk_queue_entries").select("*").order("joined_at").then(({ data }) => {
          if (data) setQueueEntries(data);
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "ftk_rushers" }, () => {
        supabase.from("ftk_rushers").select("*").order("twitch_name").then(({ data }) => {
          if (data) setRushers(data);
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const onDutyRushers = rushers.filter((r) => r.on_duty);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {activities.map((activity) => {
        const entries = queueEntries.filter((e) => e.queue_name === activity.name);
        const eligibleRushers = onDutyRushers.filter((r) => r.activities.includes(activity.name));
        return (
          <QueueCard
            key={activity.name}
            activity={activity}
            entries={entries}
            eligibleRushers={eligibleRushers}
            allRushers={rushers}
            onCarrySent={(updatedEntries) =>
              setQueueEntries((prev) => [
                ...prev.filter((e) => e.queue_name !== activity.name),
                ...updatedEntries,
              ])
            }
          />
        );
      })}
    </div>
  );
}
