import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { label, message, is_announcement, interval_minutes, enabled } = body;

  if (!label?.trim() || !message?.trim()) {
    return NextResponse.json({ error: "label and message are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ftk_recurring_messages")
    .insert({
      label: label.trim(),
      message: message.trim(),
      is_announcement: !!is_announcement,
      interval_minutes: Math.max(1, parseInt(interval_minutes) || 30),
      enabled: enabled !== false,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
