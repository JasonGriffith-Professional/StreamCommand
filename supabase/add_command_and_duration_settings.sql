-- Incremental migration — run once in the Supabase SQL editor.
-- Adds the two web-configurable raffle settings to the single ftk_raffle_state
-- row (id = 1): the activity command word (stored WITHOUT the leading "!") and
-- the raffle timer length in seconds. The bot reads both from this row on its
-- existing 2-second poll, and the web Settings panel writes them here.
--
-- Defaults preserve today's behavior (!ascend, 130s) so applying this on the
-- live table changes nothing until someone edits the values in the dashboard.

alter table ftk_raffle_state
  add column if not exists command_name          text not null default 'ascend',
  add column if not exists raffle_duration_secs  int  not null default 130;
