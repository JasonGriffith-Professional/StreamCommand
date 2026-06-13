import { createClient } from "@/lib/supabase/server";
import type { QueueEntry, Carry } from "@/lib/supabase/types";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { queue_name, rusher_id, draw_count, passcode } = body;

  if (!queue_name || !rusher_id || !draw_count) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Fetch current queue
  const { data: entries, error: qErr } = await supabase
    .from("ftk_queue_entries")
    .select("*")
    .eq("queue_name", queue_name)
    .order("joined_at");

  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
  const typedEntries = (entries ?? []) as QueueEntry[];
  if (typedEntries.length === 0) {
    return NextResponse.json({ error: "Queue is empty" }, { status: 400 });
  }

  // Draw random winners
  const shuffled = [...typedEntries].sort(() => Math.random() - 0.5);
  const winners = shuffled.slice(0, Math.min(draw_count, shuffled.length));
  const winnerUsernames = winners.map((e) => e.twitch_username);

  // Write the carry record
  const { data: carry, error: cErr } = await supabase
    .from("ftk_carries")
    .insert({
      queue_name,
      rusher_id,
      winners: winnerUsernames,
      passcode_used: !!passcode,
      chat_announced: false,
    })
    .select()
    .single();

  if (cErr || !carry) return NextResponse.json({ error: cErr?.message ?? "Insert failed" }, { status: 500 });
  const typedCarry = carry as Carry;

  // Remove winners from queue
  const winnerIds = winners.map((e) => e.id);
  await supabase.from("ftk_queue_entries").delete().in("id", winnerIds);

  // Update rusher's last_carry_at and rotate them to bottom (done by bumping timestamp)
  await supabase
    .from("ftk_rushers")
    .update({ last_carry_at: new Date().toISOString(), current_activity: queue_name })
    .eq("id", rusher_id);

  // Dispatch whispers via bot endpoint (if configured)
  const whisperResults: Record<string, string> = {};

  const botEndpoint = process.env.WHISPER_BOT_ENDPOINT;
  const botSecret = process.env.WHISPER_BOT_SECRET;

  if (botEndpoint) {
    try {
      const whisperRes = await fetch(botEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(botSecret ? { "X-Bot-Secret": botSecret } : {}),
        },
        body: JSON.stringify({
          carry_id: typedCarry.id,
          recipients: winnerUsernames,
          rusher_ign: "", // fetched by bot from DB
          queue_name,
          passcode: passcode ?? null,
        }),
      });

      if (whisperRes.ok) {
        const whisperData = await whisperRes.json();
        // Bot returns { results: { username: 'sent'|'disabled'|'failed' } }
        Object.assign(whisperResults, whisperData.results ?? {});
      }
    } catch {
      // Bot unreachable — log but don't fail the carry
    }
  } else {
    // No bot configured yet — mark all as pending
    winnerUsernames.forEach((u) => { whisperResults[u] = "pending"; });
  }

  // Write whisper results to DB
  if (Object.keys(whisperResults).length > 0) {
    const rows = Object.entries(whisperResults)
      .filter(([, status]) => status !== "pending")
      .map(([recipient_username, status]) => ({
        carry_id: typedCarry.id,
        recipient_username,
        status: status as "sent" | "disabled" | "failed",
      }));
    if (rows.length > 0) {
      await supabase.from("ftk_whisper_results").insert(rows);
    }
  }

  return NextResponse.json({
    carry_id: typedCarry.id,
    winners: winnerUsernames,
    whisperResults,
  });
}
