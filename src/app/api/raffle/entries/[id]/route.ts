import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// DELETE /api/raffle/entries/[id]
// Removes a single viewer from the current raffle by row id. This is an
// operator action in the dashboard (e.g. a viewer messages that they have to
// step away) — not a chat command and not a moderation/ban. Supabase-only:
// the realtime + polling subscriptions in the board reconcile every client.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  await supabase.from("ftk_raffle_entries").delete().eq("id", Number(id));
  return NextResponse.json({ ok: true });
}
