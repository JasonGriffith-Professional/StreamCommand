import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { enabled?: boolean };
  const supabase = await createClient();

  if (typeof body.enabled === "boolean") {
    const { error } = await supabase
      .from("ftk_raffle_state")
      .update({ test_timer: body.enabled })
      .eq("id", 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, test_timer: body.enabled });
  }

  // Toggle
  const { data: state } = await supabase
    .from("ftk_raffle_state")
    .select("test_timer")
    .eq("id", 1)
    .single();
  const next = !(state?.test_timer ?? false);
  const { error } = await supabase
    .from("ftk_raffle_state")
    .update({ test_timer: next })
    .eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, test_timer: next });
}
