"""
supabase_sync.py  —  Fire-and-forget Supabase sync for FTK Ascend Monitor
=========================================================================
All public functions run in daemon threads and never block the bot or GUI.
Failures are logged but swallowed so the local system keeps running if
Supabase is unreachable.

Requires local_settings.json to contain:
  "SUPABASE_URL":  "https://your-project.supabase.co"
  "SUPABASE_KEY":  "your-service-role-key"
=========================================================================
"""

import json
import os
import threading
from datetime import datetime, timezone

_client    = None
_init_lock = threading.Lock()

SUPABASE_URL: str = ""
SUPABASE_KEY: str = ""

_settings_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "local_settings.json")
if os.path.exists(_settings_path):
    try:
        with open(_settings_path, "r", encoding="utf-8") as _f:
            _s = json.load(_f)
        SUPABASE_URL = _s.get("SUPABASE_URL", "")
        SUPABASE_KEY = _s.get("SUPABASE_KEY", "")
    except Exception:
        pass


def _get_client():
    global _client
    if _client is not None:
        return _client
    with _init_lock:
        if _client is not None:
            return _client
        if not SUPABASE_URL or not SUPABASE_KEY:
            return None
        try:
            from supabase import create_client
            _client = create_client(SUPABASE_URL, SUPABASE_KEY)
            print("[supabase_sync] Connected.")
        except Exception as exc:
            print(f"[supabase_sync] Init failed: {exc}")
            return None
    return _client


def _run(fn):
    def wrapper():
        try:
            fn()
        except Exception as exc:
            print(f"[supabase_sync] Error: {exc}")
    threading.Thread(target=wrapper, daemon=True).start()


# ─────────────────────────────────────────────────────────────────────────────
# RUSHER QUEUE
# ─────────────────────────────────────────────────────────────────────────────

def load_state_from_supabase() -> dict | None:
    """
    Synchronously read rusher queue, raffle state, and entries from Supabase.
    Returns None if Supabase is unreachable.
    """
    sb = _get_client()
    if not sb:
        return None
    try:
        queued  = sb.table("ftk_rusher_queue").select("*").order("position").execute().data or []
        entries = sb.table("ftk_raffle_entries").select("twitch_name").order("joined_at").execute().data or []
        state   = sb.table("ftk_raffle_state").select("*").eq("id", 1).single().execute().data or {}

        end_time = 0.0
        if state.get("end_time"):
            try:
                from datetime import datetime as _dt, timezone as _tz
                end_time = _dt.fromisoformat(state["end_time"].replace("Z", "+00:00")).timestamp()
            except Exception:
                end_time = 0.0

        return {
            "rusher_queue":    queued,
            "ascend_entries":  [e["twitch_name"] for e in entries],
            "raffle_active":   bool(state.get("active", False)),
            "raffle_end_time": end_time,
            "raffle_rusher":   state.get("rusher_twitch_name"),
        }
    except Exception as exc:
        print(f"[supabase_sync] load_state_from_supabase failed: {exc}")
        return None


def rusher_queue_rotate_top() -> None:
    """Move position-0 rusher to the end without touching other rows."""
    def _do():
        sb = _get_client()
        if not sb:
            return
        rows = sb.table("ftk_rusher_queue").select("id, position").order("position").execute().data or []
        if len(rows) < 2:
            return
        top = rows[0]
        max_pos = rows[-1]["position"]
        sb.table("ftk_rusher_queue").update({"position": max_pos + 1}).eq("id", top["id"]).execute()
        print(f"[supabase_sync] rusher_queue_rotate: moved id={top['id']} to position {max_pos + 1}")
    _run(_do)


def rusher_queue_update(queue: list[dict]) -> None:
    """Replace the entire rusher queue in Supabase."""
    snapshot = list(queue)  # capture before thread starts
    def _do():
        sb = _get_client()
        if not sb:
            return
        sb.table("ftk_rusher_queue").delete().neq("id", 0).execute()
        if snapshot:
            rows = [
                {"position": i, "twitch_name": r["twitch_name"], "group_size": r["group_size"]}
                for i, r in enumerate(snapshot)
            ]
            sb.table("ftk_rusher_queue").insert(rows).execute()
        print(f"[supabase_sync] rusher_queue_update: {len(snapshot)} rushers")
    _run(_do)


# ─────────────────────────────────────────────────────────────────────────────
# RAFFLE STATE
# ─────────────────────────────────────────────────────────────────────────────

def raffle_state_update(active: bool, end_time: float, rusher: str | None, entries: list[str]) -> None:
    """Upsert the singleton raffle state row."""
    end_iso = (
        datetime.fromtimestamp(end_time, tz=timezone.utc).isoformat()
        if end_time else None
    )
    data = {
        "id": 1,
        "active": active,
        "end_time": end_iso,
        "rusher_twitch_name": rusher,
        "entry_count": len(entries),
    }
    def _do():
        sb = _get_client()
        if not sb:
            return
        sb.table("ftk_raffle_state").upsert(data, on_conflict="id").execute()
        print(f"[supabase_sync] raffle_state: active={active} rusher={rusher}")
    _run(_do)


def raffle_pause_update(paused: bool, remaining_secs: int, new_end_time: float = 0) -> None:
    """Update just the paused state and remaining time."""
    end_iso = (
        datetime.fromtimestamp(new_end_time, tz=timezone.utc).isoformat()
        if new_end_time else None
    )
    data = {"id": 1, "paused": paused, "pause_remaining_secs": remaining_secs if paused else None}
    if end_iso:
        data["end_time"] = end_iso
    def _do():
        sb = _get_client()
        if not sb:
            return
        sb.table("ftk_raffle_state").upsert(data, on_conflict="id").execute()
        print(f"[supabase_sync] raffle_pause: paused={paused} remaining={remaining_secs}s")
    _run(_do)


def raffle_entries_update(entries: list[str]) -> None:
    """Replace all current raffle entries."""
    snapshot = list(entries)
    def _do():
        sb = _get_client()
        if not sb:
            return
        sb.table("ftk_raffle_entries").delete().neq("id", 0).execute()
        if snapshot:
            rows = [{"twitch_name": name} for name in snapshot]
            sb.table("ftk_raffle_entries").insert(rows).execute()
        # Also update entry_count on raffle_state
        sb.table("ftk_raffle_state").update({"entry_count": len(snapshot)}).eq("id", 1).execute()
        print(f"[supabase_sync] raffle_entries: {len(snapshot)} entries")
    _run(_do)


def raffle_draw_log(rusher: str | None, winners: list[str], group_size: int = 1, entries_count: int = 0) -> None:
    """Log a completed draw to history."""
    def _do():
        sb = _get_client()
        if not sb:
            return
        sb.table("ftk_draw_log").insert({
            "rusher_twitch_name": rusher,
            "winners": winners,
            "group_size": group_size,
            "entries_count": entries_count,
        }).execute()
        print(f"[supabase_sync] draw_log: {rusher} → {winners}")
    _run(_do)


# ─────────────────────────────────────────────────────────────────────────────
# BAD ACTORS
# ─────────────────────────────────────────────────────────────────────────────

def bad_actor_update(data: dict) -> None:
    """Upsert a bad actor record."""
    row = {
        "twitch_name":      data["twitch_name"],
        "ascend_backouts":  data.get("ascend_backouts", 0),
        "offduty_backouts": data.get("offduty_backouts", 0),
        "banned":           data.get("banned", False),
        "notes":            data.get("notes", ""),
    }
    def _do():
        sb = _get_client()
        if not sb:
            return
        sb.table("ftk_bad_actors").upsert(row, on_conflict="twitch_name").execute()
        print(f"[supabase_sync] bad_actor_update: {row['twitch_name']}")
    _run(_do)
