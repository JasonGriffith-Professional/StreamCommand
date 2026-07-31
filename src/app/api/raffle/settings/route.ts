import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/raffle/settings
// Updates the web-configurable raffle settings on ftk_raffle_state (id = 1):
//   - command_name: the activity trigger word (e.g. "boss"). Stored bare, no "!".
//   - raffle_duration_secs: timer length for a raffle window.
// The bot picks both up on its 2s poll of ftk_raffle_state — no restart needed
// to change the VALUES (only bot code changes need a restart).
//
// Either field may be sent on its own; both are validated/clamped server-side.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    command_name?: string;
    raffle_duration_secs?: number;
  };

  const update: { command_name?: string; raffle_duration_secs?: number } = {};

  if (body.command_name !== undefined) {
    // Sanitize: drop a leading "!", lowercase, keep letters/numbers only.
    // This is the authoritative cleanup — the UI mirrors it for display.
    const clean = body.command_name.trim().replace(/^!+/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!clean) return NextResponse.json({ error: "Command can't be empty (letters/numbers only)" }, { status: 400 });
    if (clean.length > 20) return NextResponse.json({ error: "Command is too long (max 20 characters)" }, { status: 400 });
    // Guard the fixed rusher commands so the raffle word can't collide with them.
    if (clean === "onduty" || clean === "offduty") {
      return NextResponse.json({ error: `"${clean}" is reserved for the rusher commands` }, { status: 400 });
    }
    update.command_name = clean;
  }

  if (body.raffle_duration_secs !== undefined) {
    const n = Math.round(Number(body.raffle_duration_secs));
    if (!Number.isFinite(n)) return NextResponse.json({ error: "Duration must be a number" }, { status: 400 });
    // Clamp to a sane range: fast boss carries can be ~15s, long windows a few min.
    update.raffle_duration_secs = Math.max(5, Math.min(600, n));
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("ftk_raffle_state").update(update).eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, ...update });
}
