import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const { channel } = await req.json() as { channel: string };
  if (!["barricade", "psynister"].includes(channel)) {
    return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("ftk_raffle_state")
    .update({ active_channel: channel })
    .eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, channel });
}
