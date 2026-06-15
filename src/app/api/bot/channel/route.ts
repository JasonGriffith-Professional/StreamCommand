import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { channel } = await req.json() as { channel: string };
  try {
    const res = await fetch("http://127.0.0.1:7655/switch-channel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    });
    if (!res.ok) return NextResponse.json({ error: "Bot error" }, { status: 502 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Bot not running" }, { status: 503 });
  }
}
