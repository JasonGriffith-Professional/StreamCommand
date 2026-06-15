import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();

  // Read current pause state from DB
  const { data: state } = await supabase
    .from("ftk_raffle_state")
    .select("paused, pause_remaining_secs, end_time")
    .eq("id", 1)
    .single();

  const currentlyPaused = state?.paused ?? false;
  const now = new Date();

  let update: Record<string, unknown>;
  if (currentlyPaused) {
    // Unpause: resume timer from where it left off
    const remaining = state?.pause_remaining_secs ?? 0;
    const newEnd = new Date(now.getTime() + remaining * 1000).toISOString();
    update = { paused: false, pause_remaining_secs: null, end_time: newEnd, updated_at: now.toISOString() };
  } else {
    // Pause: calculate remaining seconds and freeze the timer
    const endTime = state?.end_time ? new Date(state.end_time).getTime() : now.getTime();
    const remaining = Math.max(0, Math.round((endTime - now.getTime()) / 1000));
    update = { paused: true, pause_remaining_secs: remaining, updated_at: now.toISOString() };
  }

  const { error } = await supabase.from("ftk_raffle_state").update(update).eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ paused: !currentlyPaused, remaining: update.pause_remaining_secs ?? 0 });
}
