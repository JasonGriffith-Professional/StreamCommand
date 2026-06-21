import { createClient } from "@/lib/supabase/server";
import Nav from "@/components/nav";
import type { DrawLog } from "@/lib/supabase/types";
import CopyButton from "./copy-button";

interface RusherStat {
  twitch_name: string;
  total_draws: number;
  total_winners: number;
  last_carry_at: string;
}

export default async function AnalyticsPage() {
  const supabase = await createClient();

  const [{ data: recentLogs }, { data: allLogs }] = await Promise.all([
    supabase
      .from("ftk_draw_log")
      .select("*")
      .eq("channel", "barricade")
      .order("drawn_at", { ascending: false })
      .limit(100),
    supabase
      .from("ftk_draw_log")
      .select("rusher_twitch_name, winners, drawn_at")
      .eq("channel", "barricade")
      .order("drawn_at", { ascending: false }),
  ]);

  const draws: DrawLog[] = recentLogs ?? [];
  const allDraws = allLogs ?? [];

  const totalWinners = allDraws.reduce((sum, d) => sum + (d.winners?.length ?? 0), 0);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const drawsThisWeek = allDraws.filter((d) => new Date(d.drawn_at) >= weekAgo).length;

  // Per-rusher stats
  const rusherMap = new Map<string, RusherStat>();
  for (const d of allDraws) {
    const name = d.rusher_twitch_name ?? "—";
    const existing = rusherMap.get(name);
    if (existing) {
      existing.total_draws++;
      existing.total_winners += d.winners?.length ?? 0;
      if (d.drawn_at > existing.last_carry_at) existing.last_carry_at = d.drawn_at;
    } else {
      rusherMap.set(name, {
        twitch_name: name,
        total_draws: 1,
        total_winners: d.winners?.length ?? 0,
        last_carry_at: d.drawn_at,
      });
    }
  }
  const rusherStats = Array.from(rusherMap.values())
    .filter((r) => r.twitch_name !== "—")
    .sort((a, b) => b.total_draws - a.total_draws);

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
            { label: "Total Draws", value: allDraws.length },
            { label: "Total Winners", value: totalWinners },
            { label: "Draws This Week", value: drawsThisWeek },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="text-3xl font-bold text-purple-400">{s.value}</div>
              <div className="text-xs text-zinc-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Per-rusher leaderboard */}
        {rusherStats.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wider">
              Rusher Leaderboard
            </h2>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
              <div className="grid grid-cols-4 gap-2 px-4 py-2 border-b border-zinc-800 text-xs text-zinc-500 font-medium">
                <span>Rusher</span>
                <span className="text-right">Carries</span>
                <span className="text-right">Winners Helped</span>
                <span className="text-right">Last Carry</span>
              </div>
              {rusherStats.map((r, i) => {
                const lastDt = new Date(r.last_carry_at);
                const lastStr = lastDt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                return (
                  <div
                    key={r.twitch_name}
                    className="grid grid-cols-4 gap-2 px-4 py-2.5 border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-600 text-xs w-4 text-right">{i + 1}.</span>
                      <span className="text-white font-medium">{r.twitch_name}</span>
                    </div>
                    <span className="text-right text-purple-300 font-bold tabular-nums">{r.total_draws}</span>
                    <span className="text-right text-zinc-300 tabular-nums">{r.total_winners}</span>
                    <span className="text-right text-zinc-500 text-xs">{lastStr}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
                const dateStr = dt.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
                const timeStr = dt.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" });
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
                    <CopyButton text={
                      log.winners?.length
                        ? log.rusher_twitch_name
                          ? `@${log.rusher_twitch_name} carrying ${log.winners.map((w) => `@${w}`).join(" ")}`
                          : log.winners.map((w) => `@${w}`).join(" ")
                        : ""
                    } />
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
