-- ============================================================
-- FTK Ascend Monitor — Schema v2 (current live schema)
-- Run this in Supabase SQL Editor for a fresh database.
-- All tables are prefixed with ftk_ to avoid collisions.
-- ============================================================

-- ── Rusher duty queue ─────────────────────────────────────────────────────
-- The live ordered list of rushers who are on duty.
-- The bot writes here via !onduty / !offduty.
-- The web panel can reorder, add, or remove entries.
create table if not exists ftk_rusher_queue (
  id          bigint generated always as identity primary key,
  position    int          not null,
  twitch_name text         not null,
  group_size  int          not null check (group_size between 1 and 5),
  off_duty    boolean      not null default false,
  added_at    timestamptz  not null default now()
);

-- ── Singleton raffle state (always row id=1) ──────────────────────────────
create table if not exists ftk_raffle_state (
  id                  int          primary key default 1 check (id = 1),
  active              boolean      not null default false,
  end_time            timestamptz,
  rusher_twitch_name  text,
  entry_count         int          not null default 0,
  paused              boolean      not null default false,
  pause_remaining_secs int,
  updated_at          timestamptz  not null default now()
);
insert into ftk_raffle_state (id, active) values (1, false)
  on conflict (id) do nothing;

-- ── Current raffle entries (!ascend pool) ────────────────────────────────
create table if not exists ftk_raffle_entries (
  id          bigint generated always as identity primary key,
  twitch_name text        not null,
  joined_at   timestamptz not null default now()
);

-- ── Draw history ─────────────────────────────────────────────────────────
create table if not exists ftk_draw_log (
  id                  bigint generated always as identity primary key,
  rusher_twitch_name  text,
  winners             text[]      not null default '{}',
  group_size          int         not null default 1,
  entries_count       int         not null default 0,
  drawn_at            timestamptz not null default now()
);

-- ── Bad actor tracking ───────────────────────────────────────────────────
create table if not exists ftk_bad_actors (
  id                bigint generated always as identity primary key,
  twitch_name       text        not null unique,
  ascend_backouts   int         not null default 0,
  offduty_backouts  int         not null default 0,
  banned            boolean     not null default false,
  notes             text        not null default '',
  updated_at        timestamptz not null default now()
);

-- ── Recurring chat messages ───────────────────────────────────────────────
-- Managed via /messages page. Bot polls send_now=true rows and sends them.
create table if not exists ftk_recurring_messages (
  id               uuid primary key default gen_random_uuid(),
  label            text        not null,
  message          text        not null,
  is_announcement  boolean     not null default false,
  interval_minutes integer     not null default 30 check (interval_minutes >= 1),
  enabled          boolean     not null default true,
  send_now         boolean     not null default false,
  last_sent_at     timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id)
);

-- ── Realtime ─────────────────────────────────────────────────────────────
alter publication supabase_realtime add table ftk_rusher_queue;
alter publication supabase_realtime add table ftk_raffle_state;
alter publication supabase_realtime add table ftk_raffle_entries;
alter publication supabase_realtime add table ftk_bad_actors;

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table ftk_rusher_queue      enable row level security;
alter table ftk_raffle_state      enable row level security;
alter table ftk_raffle_entries    enable row level security;
alter table ftk_draw_log          enable row level security;
alter table ftk_bad_actors        enable row level security;
alter table ftk_recurring_messages enable row level security;

-- Role helper — reads ftk_role from JWT user_metadata
-- Set via: Supabase dashboard → Authentication → Users → Edit metadata → { "ftk_role": "admin" }
create or replace function ftk_get_role()
returns text language sql stable security definer as $$
  select coalesce(
    (auth.jwt() -> 'user_metadata' ->> 'ftk_role'),
    'viewer'
  );
$$;

-- Authenticated users can read all tables (mod check happens on writes)
create policy "auth read rusher_queue"    on ftk_rusher_queue        for select using (auth.role() = 'authenticated');
create policy "auth read raffle_state"    on ftk_raffle_state        for select using (auth.role() = 'authenticated');
create policy "auth read raffle_entries"  on ftk_raffle_entries       for select using (auth.role() = 'authenticated');
create policy "auth read draw_log"        on ftk_draw_log             for select using (auth.role() = 'authenticated');
create policy "auth read bad_actors"      on ftk_bad_actors           for select using (auth.role() = 'authenticated');
create policy "auth read messages"        on ftk_recurring_messages   for select using (auth.role() = 'authenticated');

-- Mods and admins can write
create policy "mod write rusher_queue"    on ftk_rusher_queue    for all
  using (ftk_get_role() in ('admin', 'mod'))
  with check (ftk_get_role() in ('admin', 'mod'));

create policy "mod write raffle_state"    on ftk_raffle_state    for all
  using (ftk_get_role() in ('admin', 'mod'))
  with check (ftk_get_role() in ('admin', 'mod'));

create policy "mod write raffle_entries"  on ftk_raffle_entries  for all
  using (ftk_get_role() in ('admin', 'mod'))
  with check (ftk_get_role() in ('admin', 'mod'));

create policy "mod write bad_actors"      on ftk_bad_actors      for all
  using (ftk_get_role() in ('admin', 'mod'))
  with check (ftk_get_role() in ('admin', 'mod'));

create policy "mod write messages"        on ftk_recurring_messages for all
  using (ftk_get_role() in ('admin', 'mod'))
  with check (ftk_get_role() in ('admin', 'mod'));

-- Service role (bot) bypasses RLS automatically.
-- No additional policies needed for bot writes.
