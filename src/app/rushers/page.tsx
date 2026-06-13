import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/nav";
import RushersPanel from "./rushers-panel";

export default async function RushersPage() {
  const supabase = await createClient();

  const { data: rusherQueue } = await supabase
    .from("ftk_rusher_queue")
    .select("*")
    .order("position");

  return (
    <>
      <Nav />
      <main className="p-6">
        <RushersPanel initialQueue={rusherQueue ?? []} />
      </main>
    </>
  );
}
