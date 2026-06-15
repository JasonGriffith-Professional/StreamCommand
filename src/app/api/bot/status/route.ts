import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("http://127.0.0.1:7655/status", { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: "Bot error" }, { status: 502 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Bot not running" }, { status: 503 });
  }
}
