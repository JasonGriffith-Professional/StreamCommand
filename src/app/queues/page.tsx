import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/nav";
import AscendBoard from "./ascend-board";

async function getBotStatus(): Promise<{ active_channel: string; test_timer: boolean } | null> {
  try {
    const res = await fetch("http://127.0.0.1:7655/status", { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function QueuesPage() {
  const supabase = await createClient();

  const [
    { data: rusherQueue },
    { data: raffleState },
    { data: raffleEntries },
    { data: badActors },
    botStatus,
  ] = await Promise.all([
    supabase.from("ftk_rusher_queue").select("*").eq("off_duty", false).order("position"),
    supabase.from("ftk_raffle_state").select("*").eq("id", 1).single(),
    supabase.from("ftk_raffle_entries").select("*").order("joined_at"),
    supabase.from("ftk_bad_actors").select("*").order("twitch_name"),
    getBotStatus(),
  ]);

  return (
    <>
      <Nav />
      <main className="p-6">
        <AscendBoard
          initialRusherQueue={rusherQueue ?? []}
          initialRaffleState={raffleState ?? { active: false, end_time: null, rusher_twitch_name: null, entry_count: 0, paused: false, pause_remaining_secs: null }}
          initialEntries={raffleEntries ?? []}
          initialBadActors={badActors ?? []}
          initialChannel={botStatus?.active_channel ?? "barricade"}
          initialTestTimer={botStatus?.test_timer ?? false}
        />
      </main>
    </>
  );
}
