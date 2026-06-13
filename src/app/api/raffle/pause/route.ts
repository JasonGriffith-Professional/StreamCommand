import { NextResponse } from "next/server";

export async function POST() {
  try {
    const res = await fetch("http://127.0.0.1:7655/pause", { method: "POST" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Bot not reachable" }, { status: 503 });
  }
}
