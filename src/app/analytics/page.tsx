import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/nav";

interface DrawLog {
  id: number;
  drawn_at: string;
  rusher_twitch_name: string | null;
  group_size: number;
  entries_count: number;
  winners: string[];
}

export default async function AnalyticsPage() {
  const supabase = await createClient();

  const { data: logs } = await supabase
    .from("ftk_draw_log")
    .select("*")
    .order("drawn_at", { ascending: false })
    .limit(100);

  const draws: DrawLog[] = logs ?? [];

  const totalWinners = draws.reduce((sum, d) => sum + (d.winners?.length ?? 0), 0);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const drawsThisWeek = draws.filter((d) => new Date(d.drawn_at) >= weekAgo).length;

  return (
    <>
      <Nav />
      <main className="p-6 max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-xl font-bold text-white">Analytics</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Draw history from !ascend raffles</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Draws", value: draws.length },
            { label: "Total Winners", value: totalWinners },
            { label: "Draws This Week", value: drawsThisWeek },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="text-3xl font-bold text-purple-400">{s.value}</div>
              <div className="text-xs text-zinc-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Draw log */}
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wider">
            Draw Log — last {draws.length}
          </h2>

          {draws.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-10 text-center text-sm text-zinc-600 italic">
              No draws yet. Run a raffle first.
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800">
              {draws.map((log) => {
                const dt = new Date(log.drawn_at);
                const dateStr = dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                const timeStr = dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={log.id} className="px-5 py-4 flex items-start gap-4">
                    <div className="text-right min-w-[90px]">
                      <p className="text-xs font-medium text-zinc-400">{dateStr}</p>
                      <p className="text-xs text-zinc-600">{timeStr}</p>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {log.rusher_twitch_name ? (
                          <span className="text-xs bg-green-900/40 border border-green-800/40 text-green-400 px-2 py-0.5 rounded-full font-medium">
                            {log.rusher_twitch_name} carrying
                          </span>
                        ) : (
                          <span className="text-xs bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded-full">
                            No rusher
                          </span>
                        )}
                        <span className="text-xs text-zinc-600">×{log.group_size} group</span>
                        <span className="text-xs text-zinc-600">{log.entries_count} entered</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(log.winners ?? []).map((w) => (
                          <span key={w} className="text-sm font-medium text-white bg-zinc-800 px-2.5 py-0.5 rounded-full">
                            @{w}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
