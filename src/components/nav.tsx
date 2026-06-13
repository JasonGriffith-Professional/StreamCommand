"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const links = [
  { href: "/queues",    label: "Queues" },
  { href: "/rushers",   label: "Rushers" },
  { href: "/messages",  label: "Messages" },
  { href: "/analytics", label: "Analytics" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

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
      <button
        onClick={signOut}
        className="ml-auto text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        Sign out
      </button>
    </nav>
  );
}
