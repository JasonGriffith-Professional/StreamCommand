import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LoginButton from "./login-button";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) redirect("/queues");

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center shadow-xl">
        <h1 className="mb-1 text-2xl font-bold text-white">Stream Command</h1>
        <p className="mb-8 text-sm text-zinc-400">Psynister & Barricade Stream Management</p>
        <LoginButton />
        <p className="mt-4 text-xs text-zinc-600">
          Access is granted by an admin after your first login.
        </p>
      </div>
    </div>
  );
}
