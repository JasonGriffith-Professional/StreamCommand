import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/nav";
import RushersPanel from "./rushers-panel";

export default async function RushersPage() {
  const supabase = await createClient();

  const [{ data: rusherQueue }, { data: drawLogs }] = await Promise.all([
    supabase.from("ftk_rusher_queue").select("*").order("position"),
    supabase.from("ftk_draw_log").select("rusher_twitch_name"),
  ]);

  // Build carry count map keyed by lowercased name
  const carryCounts = new Map<string, number>();
  for (const row of drawLogs ?? []) {
    if (!row.rusher_twitch_name) continue;
    const key = row.rusher_twitch_name.toLowerCase();
    carryCounts.set(key, (carryCounts.get(key) ?? 0) + 1);
  }

  return (
    <>
      <Nav />
      <main className="p-6">
        <RushersPanel initialQueue={rusherQueue ?? []} carryCounts={Object.fromEntries(carryCounts)} />
      </main>
    </>
  );
}
