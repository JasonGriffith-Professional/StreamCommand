import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  // Try to route through the bot so test timer mode is respected
  try {
    const botRes = await fetch("http://127.0.0.1:7655/reopen", { method: "POST" });
    if (botRes.ok) {
      const data = await botRes.json();
      return NextResponse.json(data);
    }
  } catch {
    // Bot not running — fall back to direct Supabase write with default duration
  }

  const supabase = await createClient();
  const endTime = new Date(Date.now() + 130_000).toISOString();

  const [{ data: stateRow }, { data: queueHead }] = await Promise.all([
    supabase.from("ftk_raffle_state").select("rusher_twitch_name").eq("id", 1).single(),
    supabase.from("ftk_rusher_queue").select("twitch_name").order("position").limit(1).single(),
  ]);

  const rusher = stateRow?.rusher_twitch_name ?? queueHead?.twitch_name ?? null;

  const { error } = await supabase
    .from("ftk_raffle_state")
    .update({ active: true, end_time: endTime, rusher_twitch_name: rusher, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, end_time: endTime, rusher });
}
