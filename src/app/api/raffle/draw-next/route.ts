import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();

  // Load full queue for accurate max position, but only rotate active rushers
  const { data: allQueue } = await supabase
    .from("ftk_rusher_queue")
    .select("*")
    .order("position");

  const queue = allQueue?.filter((r) => !r.off_duty) ?? [];

  if (queue.length < 2)
    return NextResponse.json({ error: "Need at least 2 rushers in queue" }, { status: 400 });

  // Rotate: move position-0 rusher to the end (skipped, not drawn — stays active)
  const [current, ...rest] = queue;
  const maxPos = Math.max(...(allQueue?.map((r) => r.position) ?? [0]));
  await supabase.from("ftk_rusher_queue").update({ position: maxPos + 1 }).eq("id", current.id);

  const next = rest[0]; // rusher B
  const count = next.group_size;

  // Load remaining entries and current channel
  const [{ data: entries }, { data: stateData }] = await Promise.all([
    supabase.from("ftk_raffle_entries").select("twitch_name"),
    supabase.from("ftk_raffle_state").select("active_channel").eq("id", 1).single(),
  ]);
  const channel = (stateData as { active_channel?: string } | null)?.active_channel ?? "barricade";

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
    channel,
  });
  if (logError) return NextResponse.json({ error: logError.message }, { status: 500 });

  // Update raffle state to reflect new rusher
  await supabase.from("ftk_raffle_state")
    .update({ rusher_twitch_name: rusher, active: false, end_time: null, updated_at: new Date().toISOString() })
    .eq("id", 1);

  // Remove winners from entry pool; delete drawn rusher (they re-queue with !onduty)
  await Promise.all([
    supabase.from("ftk_raffle_entries").delete().in("twitch_name", winners),
    supabase.from("ftk_rusher_queue").delete().eq("id", next.id),
  ]);

  // Chat message is sent by the bot, which polls ftk_draw_log for chat_announced=false rows.
  return NextResponse.json({ winners, rusher, group_size: count });
}
