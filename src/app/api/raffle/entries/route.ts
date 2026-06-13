import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const { twitch_name } = await req.json() as { twitch_name: string };
  if (!twitch_name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  // Route through bot so local + Supabase stay in sync
  try {
    const botRes = await fetch("http://127.0.0.1:7655/add-entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ twitch_name: twitch_name.trim() }),
    });
    const body = await botRes.json();
    if (botRes.status === 409) return NextResponse.json({ error: body.error }, { status: 409 });
    if (botRes.ok) return NextResponse.json({ ok: true });
  } catch {
    // Bot not running — fall back to direct Supabase write
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("ftk_raffle_entries")
    .select("id")
    .ilike("twitch_name", twitch_name.trim())
    .single();

  if (existing) return NextResponse.json({ error: "Already in queue" }, { status: 409 });

  const { error } = await supabase
    .from("ftk_raffle_entries")
    .insert({ twitch_name: twitch_name.trim() });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
