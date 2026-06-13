"use client";

import { createClient } from "@/lib/supabase/client";

export default function LoginButton() {
  async function handleLogin() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "twitch",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <button
      onClick={handleLogin}
      className="w-full rounded-lg bg-purple-700 px-4 py-3 text-sm font-semibold text-white hover:bg-purple-600 transition-colors"
    >
      Sign in with Twitch
    </button>
  );
}
