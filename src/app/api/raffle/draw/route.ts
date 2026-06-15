import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const { count, rusher: rusherOverride } = await req.json() as { count: number; rusher?: string };
  const supabase = await createClient();

  const { data: entries } = await supabase
    .from("ftk_raffle_entries")
    .select("twitch_name");

  if (!entries || entries.length === 0)
    return NextResponse.json({ error: "No entries" }, { status: 400 });

  const { data: queueHead } = await supabase
    .from("ftk_rusher_queue").select("twitch_name").eq("off_duty", false).order("position").limit(1).single();

  // Shuffle 3x
  const pool = entries.map((e) => e.twitch_name);
  for (let i = 0; i < 3; i++) {
    for (let j = pool.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [pool[j], pool[k]] = [pool[k], pool[j]];
    }
  }
  const winners = pool.slice(0, Math.min(Math.max(1, count), pool.length));
  // Use explicitly selected rusher if provided, else fall back to queue head
  const rusher = rusherOverride ?? queueHead?.twitch_name ?? null;
  const isBarricade = rusher?.toLowerCase() === "barricade";

  // Log the draw
  const { error: logError } = await supabase.from("ftk_draw_log").insert({
    rusher_twitch_name: rusher,
    group_size: count,
    entries_count: entries.length,
    winners,
  });
  if (logError) return NextResponse.json({ error: logError.message }, { status: 500 });

  // Close the raffle, remove only the drawn winners from the pool (rest stay for replacement draws)
  await Promise.all([
    supabase.from("ftk_raffle_state").update({ active: false, end_time: null, updated_at: new Date().toISOString() }).eq("id", 1),
    supabase.from("ftk_raffle_entries").delete().in("twitch_name", winners),
  ]);

  // Remove drawn rusher from the queue — they re-queue with !onduty when ready
  // Chat message is sent by the bot, which polls ftk_draw_log for chat_announced=false rows.
  if (!isBarricade && rusher) {
    await supabase.from("ftk_rusher_queue").delete().ilike("twitch_name", rusher);
  }

  return NextResponse.json({ winners, rusher });
}
