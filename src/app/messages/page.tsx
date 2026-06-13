import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/nav";
import MessagesPanel from "./messages-panel";

export default async function MessagesPage() {
  const supabase = await createClient();

  const { data: messages } = await supabase
    .from("ftk_recurring_messages")
    .select("*")
    .order("created_at");

  return (
    <>
      <Nav />
      <main className="p-6 max-w-3xl">
        <MessagesPanel initialMessages={messages ?? []} />
      </main>
    </>
  );
}
