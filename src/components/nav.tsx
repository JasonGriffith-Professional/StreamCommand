"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const links = [
  { href: "/queues",    label: "Queues" },
  { href: "/rushers",   label: "Rushers" },
  { href: "/messages",  label: "Messages" },
  { href: "/analytics", label: "Analytics" },
];

function playChime() {
  try {
    const ctx = new AudioContext();
    const frequencies = [880, 1108, 1318]; // A5, C#6, E6 — a bright major chord
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.08;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  } catch {
    // AudioContext not available (SSR or blocked)
  }
}

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [soundOn, setSoundOn] = useState(false);
  const soundOnRef = useRef(false);
  const prevCountRef = useRef<number | null>(null);

  // Load preference from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("ftk_sound_alerts");
    const on = stored === "true";
    setSoundOn(on);
    soundOnRef.current = on;
  }, []);

  // Watch rusher queue for new entries
  useEffect(() => {
    const supabase = createClient();

    // Get initial count so we don't fire on page load
    supabase.from("ftk_rusher_queue").select("id", { count: "exact", head: true }).then(({ count }) => {
      prevCountRef.current = count ?? 0;
    });

    const channel = supabase
      .channel("nav-rusher-watch")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ftk_rusher_queue" }, () => {
        if (soundOnRef.current) playChime();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    soundOnRef.current = next;
    localStorage.setItem("ftk_sound_alerts", String(next));
    if (next) playChime(); // preview the sound when turning on
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <nav className="border-b border-zinc-800 bg-zinc-900 px-6 py-3 flex items-center gap-6">
      <span className="font-bold text-purple-400 tracking-wide mr-4">Stream Command</span>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "text-sm font-medium transition-colors",
            pathname.startsWith(link.href)
              ? "text-white"
              : "text-zinc-400 hover:text-zinc-200"
          )}
        >
          {link.label}
        </Link>
      ))}
      <div className="ml-auto flex items-center gap-4">
        <button
          onClick={toggleSound}
          title={soundOn ? "Rusher alerts: ON" : "Rusher alerts: OFF"}
          className={cn(
            "text-sm transition-colors",
            soundOn ? "text-yellow-400 hover:text-yellow-300" : "text-zinc-600 hover:text-zinc-400"
          )}
        >
          {soundOn ? "🔔" : "🔕"}
        </button>
        <button
          onClick={signOut}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
