import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  await supabase.from("ftk_rusher_queue").delete().eq("id", Number(id));
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (typeof body.off_duty !== "boolean")
    return NextResponse.json({ error: "off_duty must be a boolean" }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase
    .from("ftk_rusher_queue")
    .update({ off_duty: body.off_duty })
    .eq("id", Number(id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
