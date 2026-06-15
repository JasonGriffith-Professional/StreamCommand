// ─── v2 schema types ───────────────────────────────────────────────────────
// These match the tables actually in the database.
// See supabase/schema_v2.sql for the full DDL.

export interface RusherQueueRow {
  id: number;
  position: number;
  twitch_name: string;
  group_size: number;
  off_duty: boolean;
  added_at: string;
}

export interface RaffleState {
  id: 1;
  active: boolean;
  end_time: string | null;
  rusher_twitch_name: string | null;
  entry_count: number;
  paused: boolean;
  pause_remaining_secs: number | null;
  updated_at: string;
}

export interface RaffleEntry {
  id: number;
  twitch_name: string;
  joined_at: string;
}

export interface DrawLog {
  id: number;
  rusher_twitch_name: string | null;
  winners: string[];
  group_size: number;
  entries_count: number;
  drawn_at: string;
}

export interface BadActor {
  id: number;
  twitch_name: string;
  ascend_backouts: number;
  offduty_backouts: number;
  banned: boolean;
  notes: string;
  updated_at: string;
}

// ─── recurring messages ────────────────────────────────────────────────────

export interface RecurringMessage {
  id: string;
  label: string;
  message: string;
  is_announcement: boolean;
  interval_minutes: number;
  enabled: boolean;
  send_now: boolean;
  last_sent_at: string | null;
  created_at: string;
  created_by: string | null;
}

// ─── lookup ────────────────────────────────────────────────────────────────

export type ActivityName = "ascend" | "t15maps" | "groupup" | "bosshelp" | "campaign" | "quest";

export interface ActivityType {
  name: ActivityName;
  label: string;
  short_label: string;
  sort_order: number;
}
