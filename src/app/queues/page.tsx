import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/nav";
import AscendBoard from "./ascend-board";

export default async function QueuesPage() {
  const supabase = await createClient();

  const [
    { data: rusherQueue },
    { data: raffleState },
    { data: raffleEntries },
    { data: badActors },
  ] = await Promise.all([
    supabase.from("ftk_rusher_queue").select("*").eq("off_duty", false).order("position"),
    supabase.from("ftk_raffle_state").select("*").eq("id", 1).single(),
    supabase.from("ftk_raffle_entries").select("*").order("joined_at"),
    supabase.from("ftk_bad_actors").select("*").order("twitch_name"),
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
          initialChannel={(raffleState as { active_channel?: string } | null)?.active_channel ?? "barricade"}
          initialTestTimer={(raffleState as { test_timer?: boolean } | null)?.test_timer ?? false}
        />
      </main>
    </>
  );
}
