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
    .from("ftk_rusher_queue").select("twitch_name").order("position").limit(1).single();

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

  // Rotate the current rusher to the back — skip if "barricade" (not in queue)
  if (!isBarricade) {
    const { data: fullQueue } = await supabase.from("ftk_rusher_queue").select("*").order("position");
    if (fullQueue && fullQueue.length > 1) {
      const maxPos = Math.max(...fullQueue.map((r) => r.position));
      // Rotate whichever rusher matches the selected one (or position-0 if none matched)
      const target = fullQueue.find((r) => r.twitch_name.toLowerCase() === rusher?.toLowerCase()) ?? fullQueue[0];
      await supabase.from("ftk_rusher_queue").update({ position: maxPos + 1 }).eq("id", target.id);
    }
  }

  // Close the raffle, remove only the drawn winners from the pool (rest stay for replacement draws)
  await Promise.all([
    supabase.from("ftk_raffle_state").update({ active: false, end_time: null, updated_at: new Date().toISOString() }).eq("id", 1),
    supabase.from("ftk_raffle_entries").delete().in("twitch_name", winners),
  ]);

  // Tell the local bot to post the winners message to Twitch + YouTube
  try {
    await fetch("http://127.0.0.1:7655/winners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winners, rusher, group_size: count }),
    });
  } catch {
    // Bot not running — web panel still shows winners, chat just won't get the message
  }

  return NextResponse.json({ winners, rusher });
}
