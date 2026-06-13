import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();

  // Load current rusher queue
  const { data: queue } = await supabase
    .from("ftk_rusher_queue")
    .select("*")
    .order("position");

  if (!queue || queue.length < 2)
    return NextResponse.json({ error: "Need at least 2 rushers in queue" }, { status: 400 });

  // Rotate: move position-0 rusher to the end
  const [current, ...rest] = queue;
  const maxPos = Math.max(...queue.map((r) => r.position));
  await supabase.from("ftk_rusher_queue").update({ position: maxPos + 1 }).eq("id", current.id);

  const next = rest[0]; // rusher B
  const count = next.group_size;

  // Load remaining entries
  const { data: entries } = await supabase
    .from("ftk_raffle_entries")
    .select("twitch_name");

  if (!entries || entries.length === 0)
    return NextResponse.json({ error: "No entries remaining" }, { status: 400 });

  // Shuffle 3x and draw
  const pool = entries.map((e) => e.twitch_name);
  for (let i = 0; i < 3; i++) {
    for (let j = pool.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [pool[j], pool[k]] = [pool[k], pool[j]];
    }
  }
  const winners = pool.slice(0, Math.min(count, pool.length));
  const rusher = next.twitch_name;

  // Log the draw
  const { error: logError } = await supabase.from("ftk_draw_log").insert({
    rusher_twitch_name: rusher,
    group_size: count,
    entries_count: entries.length,
    winners,
  });
  if (logError) return NextResponse.json({ error: logError.message }, { status: 500 });

  // Update raffle state to reflect new rusher
  await supabase.from("ftk_raffle_state")
    .update({ rusher_twitch_name: rusher, active: false, end_time: null, updated_at: new Date().toISOString() })
    .eq("id", 1);

  // Remove winners from entry pool
  await supabase.from("ftk_raffle_entries").delete().in("twitch_name", winners);

  // Tell bot to post to chat
  try {
    await fetch("http://127.0.0.1:7655/winners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winners, rusher, group_size: count }),
    });
  } catch {
    // bot not running
  }

  return NextResponse.json({ winners, rusher, group_size: count });
}
