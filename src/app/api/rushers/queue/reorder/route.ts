import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { id, direction } = await req.json() as { id: number; direction: "up" | "down" };

  const { data: queue } = await supabase
    .from("ftk_rusher_queue")
    .select("*")
    .order("position");

  if (!queue) return NextResponse.json({ error: "Could not load queue" }, { status: 500 });

  const idx = queue.findIndex((r) => r.id === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= queue.length) return NextResponse.json({ ok: true });

  // Swap positions
  const posA = queue[idx].position;
  const posB = queue[swapIdx].position;

  await Promise.all([
    supabase.from("ftk_rusher_queue").update({ position: posB }).eq("id", queue[idx].id),
    supabase.from("ftk_rusher_queue").update({ position: posA }).eq("id", queue[swapIdx].id),
  ]);

  return NextResponse.json({ ok: true });
}
