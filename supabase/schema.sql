-- FTK Web Platform — Supabase Schema
-- Run this in your Supabase SQL editor.
-- All tables are prefixed with ftk_ to avoid collisions with other projects.

-- ─────────────────────────────────────────────────────────────────────────────
-- LOOKUP TABLE
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ftk_activity_types (
  name        text primary key,
  label       text not null,
  short_label text not null,
  sort_order  integer not null
);

insert into ftk_activity_types (name, label, short_label, sort_order) values
  ('ascend',   '!ascend — Ascension Carry', 'Ascend',   1),
  ('t15maps',  '!t15maps — T15 XP Farm',    'T15',      2),
  ('groupup',  '!groupup — Group Maps',     'Group',    3),
  ('bosshelp', '!bosshelp — Boss Carry',    'Boss',     4),
  ('campaign', '!campaign — Campaign Help', 'Campaign', 5),
  ('quest',    '!quest — Quest Help',       'Quest',    6)
on conflict (name) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- RUSHERS
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ftk_rushers (
  id               uuid primary key default gen_random_uuid(),
  twitch_name      text not null unique,
  ign              text not null,
  on_duty          boolean not null default false,
  activities       text[] not null default '{ascend,t15maps,groupup,bosshelp,campaign,quest}',
  current_activity text references ftk_activity_types(name),
  last_carry_at    timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists ftk_pending_rushers (
  id          uuid primary key default gen_random_uuid(),
  twitch_name text not null unique,
  joined_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- QUEUES
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ftk_queue_entries (
  id               uuid primary key default gen_random_uuid(),
  queue_name       text not null references ftk_activity_types(name),
  twitch_username  text not null,
  joined_at        timestamptz not null default now(),
  unique (queue_name, twitch_username)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- EVENTS
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ftk_events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  started_at timestamptz,
  ended_at   timestamptz,
  notes      text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- CARRIES  (primary analytics table)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ftk_carries (
  id               uuid primary key default gen_random_uuid(),
  queue_name       text not null references ftk_activity_types(name),
  rusher_id        uuid references ftk_rushers(id),
  winners          text[] not null,
  passcode_used    boolean not null default false,
  chat_announced   boolean not null default false,
  drawn_at         timestamptz not null default now(),
  event_id         uuid references ftk_events(id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- WHISPER RESULTS
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ftk_whisper_results (
  id                 uuid primary key default gen_random_uuid(),
  carry_id           uuid not null references ftk_carries(id),
  recipient_username text not null,
  status             text not null check (status in ('sent', 'disabled', 'failed')),
  bot_used           text,
  sent_at            timestamptz not null default now(),
  error_detail       text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS on all tables
alter table ftk_rushers          enable row level security;
alter table ftk_pending_rushers  enable row level security;
alter table ftk_queue_entries    enable row level security;
alter table ftk_carries          enable row level security;
alter table ftk_whisper_results  enable row level security;
alter table ftk_events           enable row level security;
alter table ftk_activity_types   enable row level security;

-- User roles stored in auth.users metadata
-- Roles: 'admin' | 'mod' | 'viewer'
-- Set via: supabase dashboard → Authentication → Users → Edit metadata
-- { "ftk_role": "admin" }

create or replace function ftk_get_role()
returns text language sql stable security definer as $$
  select coalesce(
    (auth.jwt() -> 'user_metadata' ->> 'ftk_role'),
    'viewer'
  );
$$;

-- Activity types: readable by all authenticated users
create policy "ftk_activity_types_read" on ftk_activity_types
  for select using (auth.role() = 'authenticated');

-- Queue entries: mods and admins can manage; viewers can read
create policy "ftk_queue_entries_read" on ftk_queue_entries
  for select using (auth.role() = 'authenticated');
create policy "ftk_queue_entries_write" on ftk_queue_entries
  for all using (ftk_get_role() in ('admin', 'mod'));

-- Rushers: mods and admins can manage
create policy "ftk_rushers_read" on ftk_rushers
  for select using (auth.role() = 'authenticated');
create policy "ftk_rushers_write" on ftk_rushers
  for all using (ftk_get_role() in ('admin', 'mod'));

-- Pending rushers
create policy "ftk_pending_rushers_read" on ftk_pending_rushers
  for select using (auth.role() = 'authenticated');
create policy "ftk_pending_rushers_write" on ftk_pending_rushers
  for all using (ftk_get_role() in ('admin', 'mod'));

-- Carries and whispers: mods and admins can write; all can read
create policy "ftk_carries_read" on ftk_carries
  for select using (auth.role() = 'authenticated');
create policy "ftk_carries_write" on ftk_carries
  for all using (ftk_get_role() in ('admin', 'mod'));

create policy "ftk_whisper_results_read" on ftk_whisper_results
  for select using (auth.role() = 'authenticated');
create policy "ftk_whisper_results_write" on ftk_whisper_results
  for all using (ftk_get_role() in ('admin', 'mod'));

-- Events
create policy "ftk_events_read" on ftk_events
  for select using (auth.role() = 'authenticated');
create policy "ftk_events_write" on ftk_events
  for all using (ftk_get_role() in ('admin', 'mod'));

-- ─────────────────────────────────────────────────────────────────────────────
-- REALTIME  (enable for live queue updates)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- RECURRING MESSAGES
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ftk_recurring_messages (
  id               uuid primary key default gen_random_uuid(),
  label            text not null,                        -- friendly name shown in the UI
  message          text not null,                        -- text sent to Twitch
  is_announcement  boolean not null default false,       -- true = Helix announcement; false = chat msg
  interval_minutes integer not null default 30
    check (interval_minutes >= 1),
  enabled          boolean not null default true,
  last_sent_at     timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id)
);

alter table ftk_recurring_messages enable row level security;

create policy "ftk_recurring_messages_read" on ftk_recurring_messages
  for select using (auth.role() = 'authenticated');
create policy "ftk_recurring_messages_write" on ftk_recurring_messages
  for all using (ftk_get_role() in ('admin', 'mod'));

-- Run these in the Supabase dashboard under Database → Replication:
-- alter publication supabase_realtime add table ftk_queue_entries;
-- alter publication supabase_realtime add table ftk_rushers;
-- alter publication supabase_realtime add table ftk_carries;
-- alter publication supabase_realtime add table ftk_recurring_messages;
