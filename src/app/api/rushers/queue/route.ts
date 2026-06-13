import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const { twitch_name, group_size } = await req.json();
  if (!twitch_name) return NextResponse.json({ error: "twitch_name required" }, { status: 400 });
  const size = Math.min(5, Math.max(1, Number(group_size) || 1));

  // Route through bot so its local state stays in sync
  try {
    const botRes = await fetch("http://127.0.0.1:7655/add-rusher", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ twitch_name, group_size: size }),
    });
    const body = await botRes.json();
    if (botRes.status === 409) return NextResponse.json({ error: body.error }, { status: 409 });
    if (botRes.ok) return NextResponse.json(body, { status: 201 });
  } catch {
    // Bot not running — fall back to direct Supabase write
  }

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("ftk_rusher_queue")
    .select("id")
    .ilike("twitch_name", twitch_name)
    .single();

  if (existing) return NextResponse.json({ error: `${twitch_name} is already in the queue` }, { status: 409 });

  const { data: maxRow } = await supabase
    .from("ftk_rusher_queue")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .single();

  const nextPosition = (maxRow?.position ?? 0) + 1;

  const { data, error } = await supabase
    .from("ftk_rusher_queue")
    .insert({ twitch_name: twitch_name.toLowerCase(), group_size: size, position: nextPosition })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
