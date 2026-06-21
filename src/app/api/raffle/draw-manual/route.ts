import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const { count = 1 } = await req.json().catch(() => ({})) as { count?: number };
  const supabase = await createClient();

  const [{ data: entries }, { data: stateData }] = await Promise.all([
    supabase.from("ftk_raffle_entries").select("twitch_name"),
    supabase.from("ftk_raffle_state").select("active_channel").eq("id", 1).single(),
  ]);

  if (!entries || entries.length === 0)
    return NextResponse.json({ error: "No entries" }, { status: 400 });

  const channel = (stateData as { active_channel?: string } | null)?.active_channel ?? "barricade";
  const drawCount = Math.max(1, Math.min(count, entries.length));

  const pool = entries.map((e) => e.twitch_name);
  for (let i = 0; i < 3; i++) {
    for (let j = pool.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [pool[j], pool[k]] = [pool[k], pool[j]];
    }
  }
  const winners = pool.slice(0, drawCount);

  const { error: logError } = await supabase.from("ftk_draw_log").insert({
    rusher_twitch_name: null,
    group_size: drawCount,
    entries_count: entries.length,
    winners,
    channel,
    draw_type: "manual",
    chat_announced: false,
  });
  if (logError) return NextResponse.json({ error: logError.message }, { status: 500 });

  await supabase.from("ftk_raffle_entries").delete().in("twitch_name", winners);

  return NextResponse.json({ winners, count: drawCount });
}
