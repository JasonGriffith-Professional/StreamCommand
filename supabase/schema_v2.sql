-- ============================================================
-- FTK Ascend Monitor — Schema v2
-- Run this in Supabase SQL Editor to add the new tables.
-- ============================================================

-- Ordered rusher queue
create table if not exists ftk_rusher_queue (
  id          bigint generated always as identity primary key,
  position    int          not null,
  twitch_name text         not null,
  group_size  int          not null check (group_size between 1 and 5),
  added_at    timestamptz  not null default now()
);

-- Singleton raffle state (always row id=1)
create table if not exists ftk_raffle_state (
  id                  int primary key default 1 check (id = 1),
  active              boolean      not null default false,
  end_time            timestamptz,
  rusher_twitch_name  text,
  entry_count         int          not null default 0,
  updated_at          timestamptz  not null default now()
);
insert into ftk_raffle_state (id, active) values (1, false)
  on conflict (id) do nothing;

-- Current raffle entries
create table if not exists ftk_raffle_entries (
  id          bigint generated always as identity primary key,
  twitch_name text        not null,
  joined_at   timestamptz not null default now()
);

-- Draw history log
create table if not exists ftk_draw_log (
  id                  bigint generated always as identity primary key,
  rusher_twitch_name  text,
  winners             text[]      not null default '{}',
  drawn_at            timestamptz not null default now()
);

-- Bad actor tracking
create table if not exists ftk_bad_actors (
  id                bigint generated always as identity primary key,
  twitch_name       text        not null unique,
  ascend_backouts   int         not null default 0,
  offduty_backouts  int         not null default 0,
  banned            boolean     not null default false,
  notes             text        not null default '',
  updated_at        timestamptz not null default now()
);

-- ── Realtime ──────────────────────────────────────────────
-- Enable realtime for the web control panel
alter publication supabase_realtime add table ftk_rusher_queue;
alter publication supabase_realtime add table ftk_raffle_state;
alter publication supabase_realtime add table ftk_raffle_entries;
alter publication supabase_realtime add table ftk_bad_actors;

-- ── RLS ───────────────────────────────────────────────────
alter table ftk_rusher_queue  enable row level security;
alter table ftk_raffle_state  enable row level security;
alter table ftk_raffle_entries enable row level security;
alter table ftk_draw_log      enable row level security;
alter table ftk_bad_actors    enable row level security;

-- Authenticated users (admin/mod) can read all tables
create policy "auth read rusher_queue"   on ftk_rusher_queue   for select using (auth.role() = 'authenticated');
create policy "auth read raffle_state"   on ftk_raffle_state   for select using (auth.role() = 'authenticated');
create policy "auth read raffle_entries" on ftk_raffle_entries  for select using (auth.role() = 'authenticated');
create policy "auth read draw_log"       on ftk_draw_log        for select using (auth.role() = 'authenticated');
create policy "auth read bad_actors"     on ftk_bad_actors      for select using (auth.role() = 'authenticated');

-- Admin/mod can write (web control panel mutations)
create policy "mod write rusher_queue"   on ftk_rusher_queue   for all
  using (ftk_get_role() in ('admin', 'mod'))
  with check (ftk_get_role() in ('admin', 'mod'));

create policy "mod write raffle_state"   on ftk_raffle_state   for all
  using (ftk_get_role() in ('admin', 'mod'))
  with check (ftk_get_role() in ('admin', 'mod'));

create policy "mod write raffle_entries" on ftk_raffle_entries  for all
  using (ftk_get_role() in ('admin', 'mod'))
  with check (ftk_get_role() in ('admin', 'mod'));

create policy "mod write bad_actors"     on ftk_bad_actors      for all
  using (ftk_get_role() in ('admin', 'mod'))
  with check (ftk_get_role() in ('admin', 'mod'));
