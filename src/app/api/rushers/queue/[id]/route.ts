import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  await supabase.from("ftk_rusher_queue").delete().eq("id", Number(id));
  return NextResponse.json({ ok: true });
}
