export type ActivityName = "ascend" | "t15maps" | "groupup" | "bosshelp" | "campaign" | "quest";

export type WhisperStatus = "sent" | "disabled" | "failed";

export type FtkRole = "admin" | "mod" | "viewer";

export interface Rusher {
  id: string;
  twitch_name: string;
  ign: string;
  on_duty: boolean;
  activities: ActivityName[];
  current_activity: ActivityName | null;
  last_carry_at: string | null;
  created_at: string;
}

export interface PendingRusher {
  id: string;
  twitch_name: string;
  joined_at: string;
}

export interface QueueEntry {
  id: string;
  queue_name: ActivityName;
  twitch_username: string;
  joined_at: string;
}

export interface Carry {
  id: string;
  queue_name: ActivityName;
  rusher_id: string | null;
  winners: string[];
  passcode_used: boolean;
  chat_announced: boolean;
  drawn_at: string;
  event_id: string | null;
}

export interface WhisperResult {
  id: string;
  carry_id: string;
  recipient_username: string;
  status: WhisperStatus;
  bot_used: string | null;
  sent_at: string;
  error_detail: string | null;
}

export interface ActivityType {
  name: ActivityName;
  label: string;
  short_label: string;
  sort_order: number;
}

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

export interface FtkEvent {
  id: string;
  name: string;
  started_at: string | null;
  ended_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

// Generic Supabase Database type shape (enough for typed queries)
export type Database = {
  public: {
    Tables: {
      ftk_rushers: { Row: Rusher; Insert: Omit<Rusher, "id" | "created_at">; Update: Partial<Omit<Rusher, "id">> };
      ftk_pending_rushers: { Row: PendingRusher; Insert: Omit<PendingRusher, "id" | "joined_at">; Update: Partial<PendingRusher> };
      ftk_queue_entries: { Row: QueueEntry; Insert: Omit<QueueEntry, "id" | "joined_at">; Update: Partial<QueueEntry> };
      ftk_carries: { Row: Carry; Insert: Omit<Carry, "id" | "drawn_at">; Update: Partial<Carry> };
      ftk_whisper_results: { Row: WhisperResult; Insert: Omit<WhisperResult, "id" | "sent_at">; Update: Partial<WhisperResult> };
      ftk_activity_types: { Row: ActivityType; Insert: ActivityType; Update: Partial<ActivityType> };
      ftk_events: { Row: FtkEvent; Insert: Omit<FtkEvent, "id" | "created_at">; Update: Partial<FtkEvent> };
    };
  };
};
