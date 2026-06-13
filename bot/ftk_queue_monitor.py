"""
FTK Ascend Monitor — single-queue raffle system.

!onduty #    — rusher signs up with group size (1-5)
!offduty     — rusher leaves the queue
!ascend      — Barricade starts a raffle; others join it
"""

import asyncio
import json
import os
import re
import random
import threading
import time
from datetime import datetime

import requests
from flask import Flask as _Flask, request as _flask_request, jsonify as _jsonify
import customtkinter as ctk
from tkinter import messagebox
from twitchio.ext import commands
import supabase_sync as sb_sync

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION  (overridable via local_settings.json)
# ─────────────────────────────────────────────────────────────────────────────

TWITCH_CLIENT_ID       = "i0y8ctjbhrpc6zwo6x0shwn1d21yov"
PSYNISTER_ACCESS_TOKEN = ""
CADE_CHANNEL           = "barricade"
CADE_USERNAME          = "barricade"      # account that triggers !ascend raffles in Cade's channel
PSYNISTER_CHANNEL      = "psynister"
PSYNISTER_USERNAME     = "psynister"      # account that triggers !ascend raffles in psynister's channel
DISCORD_WEBHOOK_URL    = ""

# YouTube — set these in local_settings.json
YOUTUBE_API_KEY        = "AIzaSyCHJ7v5wvyQTcCVX4GdEfwzO7heWX7lkxg"  # public API key (read-only)
YOUTUBE_CHANNEL_ID     = "UCYAsWy-GosLjQSQVPNyukNA"                   # Barricade's channel
YOUTUBE_ACCESS_TOKEN   = ""   # OAuth access token — needed only for posting to chat
YOUTUBE_REFRESH_TOKEN  = ""   # OAuth refresh token
YOUTUBE_CLIENT_ID      = ""   # Google OAuth client ID
YOUTUBE_CLIENT_SECRET  = ""   # Google OAuth client secret

RAFFLE_DURATION        = 130              # seconds the entry window stays open
TEST_TIMER_DURATION    = 10               # seconds when test mode is on
_test_timer_mode       = False            # toggled via GUI
MAX_GROUP_SIZE         = 5

_OVERRIDEABLE = {
    "PSYNISTER_ACCESS_TOKEN", "TWITCH_CLIENT_ID",
    "CADE_CHANNEL", "CADE_USERNAME", "DISCORD_WEBHOOK_URL",
    "YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID",
    "YOUTUBE_ACCESS_TOKEN", "YOUTUBE_REFRESH_TOKEN",
    "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET",
}

# ─────────────────────────────────────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────────────────────────────────────

_DIR             = os.path.dirname(os.path.abspath(__file__))
_LOCAL_SETTINGS  = os.path.join(_DIR, "local_settings.json")
_STATE_FILE      = os.path.join(_DIR, "ftk_state.json")
_BAD_ACTORS_FILE = os.path.join(_DIR, "ftk_bad_actors.json")

# ─────────────────────────────────────────────────────────────────────────────
# LOCAL SETTINGS
# ─────────────────────────────────────────────────────────────────────────────

def _load_local_settings() -> None:
    if not os.path.exists(_LOCAL_SETTINGS):
        return
    try:
        with open(_LOCAL_SETTINGS) as f:
            data = json.load(f)
        for key in _OVERRIDEABLE:
            if key in data:
                globals()[key] = data[key]
    except Exception as e:
        print(f"[settings] Failed to load: {e}")

_load_local_settings()

# ─────────────────────────────────────────────────────────────────────────────
# SHARED STATE
# ─────────────────────────────────────────────────────────────────────────────

_state_lock = threading.Lock()

# Ordered rusher queue: [{"twitch_name": str, "group_size": int}, ...]
rusher_queue: list[dict] = []

# Current raffle entry list
ascend_entries: list[str] = []

# Raffle state
raffle_active    = False
raffle_end_time  = 0.0          # time.time() + RAFFLE_DURATION
raffle_rusher: str | None = None  # twitch_name of rusher assigned to current raffle
raffle_paused    = False
raffle_pause_remaining = 0.0    # seconds remaining when paused

# Users who triggered this raffle then backed out — excluded from winning
backed_out_users: set[str] = set()

# Bad actors: {twitch_name_lower: {"twitch_name", "ascend_backouts", "offduty_backouts", "banned", "notes"}}
bad_actors: dict[str, dict] = {}

bot_instance           = None
_active_channel: str   = CADE_CHANNEL

_log_lines: list[str]  = []
_MAX_LOG_LINES         = 300

# ─────────────────────────────────────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────────────────────────────────────

def _log(msg: str) -> None:
    ts   = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}]  {msg}"
    _log_lines.append(line)
    if len(_log_lines) > _MAX_LOG_LINES:
        _log_lines.pop(0)
    print(line)

# ─────────────────────────────────────────────────────────────────────────────
# PERSISTENCE
# ─────────────────────────────────────────────────────────────────────────────

def _save_state() -> None:
    try:
        with open(_STATE_FILE, "w") as f:
            json.dump({"rusher_queue": rusher_queue, "ascend_entries": ascend_entries}, f, indent=2)
    except Exception as e:
        _log(f"[state] Save failed: {e}")

def _load_state() -> None:
    global rusher_queue, ascend_entries, raffle_active, raffle_end_time, raffle_rusher
    # Try Supabase first — it's the source of truth
    remote = sb_sync.load_state_from_supabase()
    if remote:
        rusher_queue    = remote["rusher_queue"]
        ascend_entries  = remote["ascend_entries"]
        raffle_active   = remote["raffle_active"]
        raffle_end_time = remote["raffle_end_time"]
        raffle_rusher   = remote["raffle_rusher"]
        _log(f"[state] Loaded from Supabase — {len(rusher_queue)} rushers, {len(ascend_entries)} entries")
        return
    # Fall back to local JSON
    if not os.path.exists(_STATE_FILE):
        return
    try:
        with open(_STATE_FILE) as f:
            data = json.load(f)
        rusher_queue   = data.get("rusher_queue", [])
        ascend_entries = data.get("ascend_entries", [])
        _log(f"[state] Loaded from local file — {len(rusher_queue)} rushers")
    except Exception as e:
        _log(f"[state] Load failed: {e}")

def _save_bad_actors() -> None:
    try:
        with open(_BAD_ACTORS_FILE, "w") as f:
            json.dump(bad_actors, f, indent=2)
    except Exception as e:
        _log(f"[bad_actors] Save failed: {e}")

def _load_bad_actors() -> None:
    global bad_actors
    if not os.path.exists(_BAD_ACTORS_FILE):
        return
    try:
        with open(_BAD_ACTORS_FILE) as f:
            bad_actors = json.load(f)
    except Exception as e:
        _log(f"[bad_actors] Load failed: {e}")

_load_state()
_load_bad_actors()

# ─────────────────────────────────────────────────────────────────────────────
# RUSHER QUEUE OPERATIONS
# ─────────────────────────────────────────────────────────────────────────────

def rusher_add(twitch_name: str, group_size: int) -> bool:
    """Add rusher to end of queue. Returns False if already in queue."""
    with _state_lock:
        if any(r["twitch_name"].lower() == twitch_name.lower() for r in rusher_queue):
            return False
        pos = (max((r.get("position", i) for i, r in enumerate(rusher_queue)), default=-1) + 1)
        rusher_queue.append({"twitch_name": twitch_name, "group_size": group_size, "position": pos})
    _save_state()
    sb_sync.rusher_queue_update(list(rusher_queue))
    return True

def rusher_remove(twitch_name: str) -> bool:
    """Remove rusher from queue. Returns False if not found."""
    with _state_lock:
        before = len(rusher_queue)
        rusher_queue[:] = [r for r in rusher_queue if r["twitch_name"].lower() != twitch_name.lower()]
    if len(rusher_queue) < before:
        _save_state()
        sb_sync.rusher_queue_update(list(rusher_queue))
        return True
    return False

def rusher_move(twitch_name: str, delta: int) -> bool:
    """Move rusher up (delta=-1) or down (delta=+1) in queue."""
    with _state_lock:
        idx = next((i for i, r in enumerate(rusher_queue)
                    if r["twitch_name"].lower() == twitch_name.lower()), None)
        if idx is None:
            return False
        new_idx = max(0, min(len(rusher_queue) - 1, idx + delta))
        if new_idx == idx:
            return False
        rusher_queue.insert(new_idx, rusher_queue.pop(idx))
    _save_state()
    sb_sync.rusher_queue_update(list(rusher_queue))
    return True

def rusher_update_size(twitch_name: str, group_size: int) -> bool:
    """Update the group size for an existing rusher."""
    with _state_lock:
        for r in rusher_queue:
            if r["twitch_name"].lower() == twitch_name.lower():
                r["group_size"] = group_size
                break
        else:
            return False
    _save_state()
    sb_sync.rusher_queue_update(list(rusher_queue))
    return True

def _resync_rusher_queue(delay: float = 0.0) -> None:
    """Reload rusher_queue from Supabase after a delay (in a daemon thread)."""
    def _do():
        if delay:
            time.sleep(delay)
        data = sb_sync.load_state_from_supabase()
        if data and "rusher_queue" in data:
            with _state_lock:
                rusher_queue.clear()
                rusher_queue.extend(data["rusher_queue"])
            _log("[rusher] re-synced queue from Supabase")
    threading.Thread(target=_do, daemon=True).start()

# ─────────────────────────────────────────────────────────────────────────────
# RAFFLE OPERATIONS
# ─────────────────────────────────────────────────────────────────────────────

def raffle_start() -> None:
    """Called when Barricade types !ascend. Opens a raffle for the current head of the rusher queue."""
    global raffle_active, raffle_end_time, raffle_rusher, backed_out_users
    with _state_lock:
        ascend_entries.clear()
        backed_out_users = set()
        raffle_active    = True
        _dur = TEST_TIMER_DURATION if _test_timer_mode else RAFFLE_DURATION
        raffle_end_time  = time.time() + _dur
        raffle_rusher    = rusher_queue[0]["twitch_name"] if rusher_queue else None
    _save_state()
    sb_sync.raffle_state_update(True, raffle_end_time, raffle_rusher, [])
    sb_sync.raffle_entries_update([])   # clear Supabase entries on new raffle
    _log(f"[raffle] Started — rusher: {raffle_rusher or 'none'} — {_dur}s window")

def raffle_reopen() -> None:
    """Reopen / extend the raffle window without changing rusher or entries."""
    global raffle_active, raffle_end_time
    with _state_lock:
        raffle_active   = True
        _dur = TEST_TIMER_DURATION if _test_timer_mode else RAFFLE_DURATION
        raffle_end_time = time.time() + _dur
    sb_sync.raffle_state_update(True, raffle_end_time, raffle_rusher, list(ascend_entries))
    _log(f"[raffle] Reopened — {_dur}s window")

def raffle_add_entry(twitch_name: str) -> bool:
    """Add a user to the current raffle. Returns False if not active, already in, or backed out."""
    with _state_lock:
        if not raffle_active:
            return False
        name_lower = twitch_name.lower()
        if name_lower in (e.lower() for e in ascend_entries):
            return False
        if name_lower in backed_out_users:
            return False
        ascend_entries.append(twitch_name)
    sb_sync.raffle_entries_update(list(ascend_entries))
    return True

def raffle_draw(count: int) -> list[str]:
    """Shuffle 3x and draw up to count winners from ascend_entries."""
    with _state_lock:
        pool = list(ascend_entries)
    for _ in range(3):
        random.shuffle(pool)
    return pool[:count]

def raffle_close() -> None:
    global raffle_active
    with _state_lock:
        raffle_active = False
    sb_sync.raffle_state_update(False, 0, raffle_rusher, list(ascend_entries))

def raffle_pause() -> None:
    global raffle_paused, raffle_pause_remaining
    with _state_lock:
        if not raffle_active or raffle_paused:
            return
        raffle_paused = True
        raffle_pause_remaining = max(0.0, raffle_end_time - time.time())
    sb_sync.raffle_pause_update(True, int(raffle_pause_remaining))
    _log(f"[raffle] Paused — {int(raffle_pause_remaining)}s remaining")

def raffle_unpause() -> None:
    global raffle_paused, raffle_end_time
    with _state_lock:
        if not raffle_active or not raffle_paused:
            return
        raffle_paused = False
        raffle_end_time = time.time() + raffle_pause_remaining
    sb_sync.raffle_pause_update(False, 0, raffle_end_time)
    _log(f"[raffle] Unpaused — {int(raffle_pause_remaining)}s remaining")

def rusher_backout_of_raffle(twitch_name: str) -> None:
    """Active rusher typed !ascend — they back out. Record it, remove from queue."""
    global raffle_rusher
    with _state_lock:
        backed_out_users.add(twitch_name.lower())
        ascend_entries[:] = [e for e in ascend_entries if e.lower() != twitch_name.lower()]
        rusher_queue[:] = [r for r in rusher_queue if r["twitch_name"].lower() != twitch_name.lower()]
        raffle_rusher = rusher_queue[0]["twitch_name"] if rusher_queue else None
    _record_bad_actor(twitch_name, "ascend_backout")
    _save_state()
    sb_sync.rusher_queue_update(list(rusher_queue))
    sb_sync.raffle_state_update(raffle_active, raffle_end_time, raffle_rusher, list(ascend_entries))

# ─────────────────────────────────────────────────────────────────────────────
# BAD ACTOR TRACKING
# ─────────────────────────────────────────────────────────────────────────────

def _record_bad_actor(twitch_name: str, event: str) -> None:
    """event: 'ascend_backout' | 'offduty_backout'"""
    key = twitch_name.lower()
    if key not in bad_actors:
        bad_actors[key] = {
            "twitch_name": twitch_name,
            "ascend_backouts": 0,
            "offduty_backouts": 0,
            "banned": False,
            "notes": "",
        }
    if event == "ascend_backout":
        bad_actors[key]["ascend_backouts"] += 1
    elif event == "offduty_backout":
        bad_actors[key]["offduty_backouts"] += 1
    _save_bad_actors()
    sb_sync.bad_actor_update(bad_actors[key])
    _log(f"[bad_actor] {event} recorded for {twitch_name}")

def is_banned(twitch_name: str) -> bool:
    return bad_actors.get(twitch_name.lower(), {}).get("banned", False)

def ban_user(twitch_name: str) -> None:
    key = twitch_name.lower()
    if key not in bad_actors:
        bad_actors[key] = {
            "twitch_name": twitch_name,
            "ascend_backouts": 0,
            "offduty_backouts": 0,
            "banned": False,
            "notes": "",
        }
    bad_actors[key]["banned"] = True
    _save_bad_actors()
    sb_sync.bad_actor_update(bad_actors[key])
    _log(f"[ban] {twitch_name} banned")

def unban_user(twitch_name: str) -> None:
    key = twitch_name.lower()
    if key in bad_actors:
        bad_actors[key]["banned"] = False
        _save_bad_actors()
        sb_sync.bad_actor_update(bad_actors[key])
    _log(f"[ban] {twitch_name} unbanned")

# ─────────────────────────────────────────────────────────────────────────────
# CHAT
# ─────────────────────────────────────────────────────────────────────────────

async def _post_chat(text: str) -> None:
    if not bot_instance:
        _log("⚠ Bot not ready")
        return
    channel = bot_instance.get_channel(_active_channel)
    if channel:
        await channel.send(text)
    else:
        _log("⚠ Could not get channel")

def post_chat_threadsafe(text: str) -> None:
    if bot_instance:
        asyncio.run_coroutine_threadsafe(_post_chat(text), bot_instance.loop)

def post_announcement_threadsafe(text: str) -> None:
    def _send():
        token = PSYNISTER_ACCESS_TOKEN
        if not token:
            post_chat_threadsafe(text)
            return
        try:
            sender_resp = requests.get(
                "https://api.twitch.tv/helix/users",
                headers={"Authorization": f"Bearer {token}", "Client-Id": TWITCH_CLIENT_ID},
                params={"login": "Psynister"},
                timeout=10,
            )
            bcast_resp = requests.get(
                "https://api.twitch.tv/helix/users",
                headers={"Authorization": f"Bearer {token}", "Client-Id": TWITCH_CLIENT_ID},
                params={"login": _active_channel},
                timeout=10,
            )
            s_data = sender_resp.json().get("data", [])
            b_data = bcast_resp.json().get("data", [])
            if not s_data or not b_data:
                post_chat_threadsafe(text)
                return
            ann_resp = requests.post(
                "https://api.twitch.tv/helix/chat/announcements",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Client-Id": TWITCH_CLIENT_ID,
                    "Content-Type": "application/json",
                },
                params={"broadcaster_id": b_data[0]["id"], "moderator_id": s_data[0]["id"]},
                json={"message": text, "color": "purple"},
                timeout=10,
            )
            if ann_resp.status_code not in (200, 204):
                post_chat_threadsafe(text)
            else:
                _log(f"[announce] {text[:80]}")
        except Exception:
            post_chat_threadsafe(text)
    threading.Thread(target=_send, daemon=True).start()

# ─────────────────────────────────────────────────────────────────────────────
# YOUTUBE CHAT
# ─────────────────────────────────────────────────────────────────────────────

_YT_BASE        = "https://www.googleapis.com/youtube/v3"
_yt_chat_id: str | None = None
_yt_page_token: str | None = None
_yt_lock        = threading.Lock()


def _yt_headers() -> dict:
    return {"Authorization": f"Bearer {YOUTUBE_ACCESS_TOKEN}",
            "Content-Type": "application/json"}


def _yt_refresh_token() -> bool:
    """Attempt to refresh the YouTube access token. Returns True on success."""
    global YOUTUBE_ACCESS_TOKEN
    if not YOUTUBE_REFRESH_TOKEN or not YOUTUBE_CLIENT_ID or not YOUTUBE_CLIENT_SECRET:
        return False
    try:
        resp = requests.post(
            "https://oauth2.googleapis.com/token",
            json={
                "client_id":     YOUTUBE_CLIENT_ID,
                "client_secret": YOUTUBE_CLIENT_SECRET,
                "refresh_token": YOUTUBE_REFRESH_TOKEN,
                "grant_type":    "refresh_token",
            },
            timeout=10,
        )
        data = resp.json()
        if "access_token" in data:
            YOUTUBE_ACCESS_TOKEN = data["access_token"]
            _log("[yt] Token refreshed")
            return True
        _log(f"[yt] Token refresh failed: {data.get('error_description', data)}")
    except Exception as exc:
        _log(f"[yt] Token refresh error: {exc}")
    return False


def _yt_find_live_chat_id() -> str | None:
    """Find the live chat ID for the currently active broadcast via public API key."""
    if not YOUTUBE_API_KEY or not YOUTUBE_CHANNEL_ID:
        return None
    try:
        # Find the active live video ID for the channel
        search_resp = requests.get(
            f"{_YT_BASE}/search",
            params={
                "part":      "id",
                "channelId": YOUTUBE_CHANNEL_ID,
                "eventType": "live",
                "type":      "video",
                "key":       YOUTUBE_API_KEY,
            },
            timeout=10,
        )
        items = search_resp.json().get("items", [])
        if not items:
            return None
        video_id = items[0]["id"]["videoId"]

        # Get the live chat ID from the video
        video_resp = requests.get(
            f"{_YT_BASE}/videos",
            params={
                "part": "liveStreamingDetails",
                "id":   video_id,
                "key":  YOUTUBE_API_KEY,
            },
            timeout=10,
        )
        videos = video_resp.json().get("items", [])
        if not videos:
            return None
        chat_id = videos[0].get("liveStreamingDetails", {}).get("activeLiveChatId")
        if chat_id:
            _log(f"[yt] Live chat found for video {video_id}")
        return chat_id
    except Exception as exc:
        _log(f"[yt] Error finding live chat: {exc}")
    return None


def post_youtube_chat(text: str) -> None:
    """Post a message to YouTube live chat in a daemon thread."""
    def _send():
        with _yt_lock:
            chat_id = _yt_chat_id
        if not chat_id or not YOUTUBE_ACCESS_TOKEN:
            _log("[yt] Cannot post — no live chat or token")
            return
        try:
            resp = requests.post(
                f"{_YT_BASE}/liveChat/messages",
                headers=_yt_headers(),
                params={"part": "snippet"},
                json={
                    "snippet": {
                        "liveChatId": chat_id,
                        "type": "textMessageEvent",
                        "textMessageDetails": {"messageText": text},
                    }
                },
                timeout=10,
            )
            if resp.status_code == 401:
                if _yt_refresh_token():
                    post_youtube_chat(text)  # retry once
            elif resp.status_code not in (200, 201):
                _log(f"[yt] Post failed ({resp.status_code}): {resp.text[:120]}")
            else:
                _log(f"[yt] Posted: {text[:80]}")
        except Exception as exc:
            _log(f"[yt] Post error: {exc}")
    threading.Thread(target=_send, daemon=True).start()


def _youtube_chat_loop() -> None:
    """Background thread: poll YouTube live chat and feed !ascend entries into the raffle."""
    global _yt_chat_id, _yt_page_token

    # Find the live chat ID, retrying until stream goes live
    while True:
        chat_id = _yt_find_live_chat_id()
        if chat_id:
            with _yt_lock:
                _yt_chat_id = chat_id
                _yt_page_token = None
            break
        time.sleep(30)

    poll_interval = 5.0   # seconds; YouTube will tell us the real interval

    while True:
        time.sleep(poll_interval)
        with _yt_lock:
            chat_id   = _yt_chat_id
            page_token = _yt_page_token

        if not chat_id or not YOUTUBE_ACCESS_TOKEN:
            continue

        try:
            params = {
                "part":       "snippet,authorDetails",
                "liveChatId": chat_id,
                "maxResults": 200,
                "key":        YOUTUBE_API_KEY,
            }
            if page_token:
                params["pageToken"] = page_token

            resp = requests.get(
                f"{_YT_BASE}/liveChat/messages",
                params=params,
                timeout=15,
            )

            if resp.status_code == 403:
                # Chat ended or stream offline — wait and look for a new broadcast
                _log("[yt] Chat unavailable (403) — waiting for next stream")
                with _yt_lock:
                    _yt_chat_id = None
                    _yt_page_token = None
                time.sleep(60)
                new_id = _yt_find_live_chat_id()
                if new_id:
                    with _yt_lock:
                        _yt_chat_id = new_id
                continue
            if resp.status_code != 200:
                continue

            data = resp.json()
            poll_interval = max(3.0, data.get("pollingIntervalMillis", 5000) / 1000)

            new_token = data.get("nextPageToken")
            with _yt_lock:
                _yt_page_token = new_token

            # Only process messages if we already had a page token
            # (first poll just establishes position — we don't replay old chat)
            if not page_token:
                continue

            for item in data.get("items", []):
                msg_type = item["snippet"].get("type")
                if msg_type != "textMessageEvent":
                    continue
                text     = item["snippet"]["textMessageDetails"].get("messageText", "").strip().lower()
                author   = item["authorDetails"].get("displayName", "")
                if not text.startswith("!ascend") or not author:
                    continue
                if is_banned(author):
                    continue
                with _state_lock:
                    in_raffle   = raffle_active
                    curr_rusher = raffle_rusher
                if not in_raffle:
                    continue
                # YouTube users cannot be the active rusher (raffle is triggered from Twitch)
                added = raffle_add_entry(author)
                if added:
                    _log(f"[yt] {author} joined raffle via YouTube")

        except Exception as exc:
            _log(f"[yt] Poll error: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# RAFFLE TIMER THREAD
# ─────────────────────────────────────────────────────────────────────────────

def _raffle_timer_loop() -> None:
    """Background thread: fires the draw when the raffle window expires."""
    while True:
        time.sleep(1)
        with _state_lock:
            if not raffle_active or raffle_paused:
                continue
            remaining = raffle_end_time - time.time()
        if remaining <= 0:
            _fire_raffle_draw()

def _fire_raffle_draw() -> None:
    raffle_close()
    with _state_lock:
        active = rusher_queue[0] if rusher_queue else None
        count  = active["group_size"] if active else 1
        rusher = raffle_rusher
        if not ascend_entries:
            _log("[raffle] Timer expired — no entries")
            return

    winners = raffle_draw(count)
    if not winners:
        _log("[raffle] No winners drawn")
        return

    # Remove winners from the pool so they can't be re-drawn (entries stay for replacement draws)
    winner_set = {w.lower() for w in winners}
    with _state_lock:
        ascend_entries[:] = [e for e in ascend_entries if e.lower() not in winner_set]

    pings      = " ".join(f"@{w}" for w in winners)
    spots_left = count - len(winners)
    suffix     = f" and room for {spots_left} more" if spots_left > 0 else ""
    if rusher:
        twitch_msg = f"@{CADE_USERNAME} - @{rusher} carrying {pings}{suffix}"
        yt_msg     = f"@{rusher} carrying {pings}{suffix}"
    else:
        twitch_msg = f"@{CADE_USERNAME} - need a carry for {pings}{suffix}"
        yt_msg     = f"Need a carry for {pings}{suffix}"

    post_chat_threadsafe(twitch_msg)
    post_youtube_chat(yt_msg)
    _log(f"[raffle] Drew {len(winners)}: {', '.join(winners)}")
    sb_sync.raffle_draw_log(rusher, winners, count, len(ascend_entries) + len(winners))

    # Sync remaining entries to Supabase (winners already removed from local list)
    with _state_lock:
        remaining = list(ascend_entries)
    sb_sync.raffle_entries_update(remaining)

    # Rotate rusher queue: move current rusher to back, then push full list to Supabase
    with _state_lock:
        if len(rusher_queue) > 1:
            rusher_queue.append(rusher_queue.pop(0))
        rotated = list(rusher_queue)
    sb_sync.rusher_queue_update(rotated)

# ─────────────────────────────────────────────────────────────────────────────
# BOT
# ─────────────────────────────────────────────────────────────────────────────

class FTKBot(commands.Bot):
    def __init__(self):
        token = PSYNISTER_ACCESS_TOKEN or "MISSING_TOKEN"
        super().__init__(
            token=token,
            client_id=TWITCH_CLIENT_ID,
            nick="Psynister",
            prefix="!",
            initial_channels=[CADE_CHANNEL, PSYNISTER_CHANNEL],
        )

    async def event_ready(self):
        global bot_instance
        bot_instance = self
        _log(f"FTK Bot connected to #{CADE_CHANNEL}")

    async def event_message(self, message):
        if message.echo:
            return
        await self.handle_commands(message)

    async def event_usernotice(self, channel, tags: dict):
        """Handle USERNOTICE events — auto-shoutout raids on psynister's channel."""
        if tags.get("msg-id") != "raid":
            return
        raider  = tags.get("display-name") or tags.get("login", "someone")
        viewers = int(tags.get("msg-param-viewerCount", 0))
        ch = bot_instance.get_channel(PSYNISTER_CHANNEL)
        if ch:
            await ch.send(
                f"@{raider} just raided with {viewers} viewer{'s' if viewers != 1 else ''}! "
                f"Give them a follow at twitch.tv/{raider} — go check out their stream!"
            )
            await ch.send(f"/shoutout {raider}")
        _log(f"[raid] Auto-shoutout: {raider} ({viewers} viewers)")

    @commands.command(name="onduty")
    async def cmd_onduty(self, ctx):
        username = ctx.author.name
        nums = re.findall(r"\d+", ctx.message.content)
        if not nums:
            await ctx.send(
                f"@{username} We need to know how many you can carry. "
                f"Please type the command again, followed by a number."
            )
            return
        count = int(nums[0])
        if count < 1 or count > MAX_GROUP_SIZE:
            await ctx.send(f"@{username} Group size must be between 1 and {MAX_GROUP_SIZE}.")
            return
        # If already in queue, update their group size instead
        with _state_lock:
            existing = next((r for r in rusher_queue
                             if r["twitch_name"].lower() == username.lower()), None)
        if existing:
            rusher_update_size(username, count)
            _log(f"[rusher] {username} updated group size → {count}")
        else:
            rusher_add(username, count)
            _log(f"[rusher] {username} on duty for ×{count}")

    @commands.command(name="offduty")
    async def cmd_offduty(self, ctx):
        username = ctx.author.name
        with _state_lock:
            is_active  = (bool(rusher_queue) and
                          rusher_queue[0]["twitch_name"].lower() == username.lower())
            in_raffle  = raffle_active

        if is_active and in_raffle:
            _record_bad_actor(username, "offduty_backout")
            rusher_remove(username)
            _log(f"[rusher] {username} went off duty mid-raffle (offduty backout recorded)")
            with _state_lock:
                new_rusher = rusher_queue[0]["twitch_name"] if rusher_queue else None
            if not new_rusher:
                post_chat_threadsafe(
                    f"@{CADE_USERNAME} - the rusher stepped away. "
                    f"Does anyone want to step up? Type !onduty followed by your group size."
                )
        else:
            rusher_remove(username)
            _log(f"[rusher] {username} off duty")

    @commands.command(name="ascend")
    async def cmd_ascend(self, ctx):
        username = ctx.author.name

        if is_banned(username):
            return  # silently ignore banned users

        # Who triggers a new raffle depends on which channel we're in
        trigger_username = (
            PSYNISTER_USERNAME if _active_channel.lower() == PSYNISTER_CHANNEL.lower()
            else CADE_USERNAME
        )

        if username.lower() == trigger_username.lower():
            # Channel owner triggers a new raffle
            raffle_start()
            return

        # Everyone else — only meaningful during an active raffle
        with _state_lock:
            in_raffle    = raffle_active
            curr_rusher  = raffle_rusher

        if not in_raffle:
            return

        # Active rusher backing out of their own carry
        if curr_rusher and username.lower() == curr_rusher.lower():
            rusher_backout_of_raffle(username)
            post_chat_threadsafe(
                f"@{CADE_USERNAME} - @{curr_rusher} has backed out of the ascension carry."
            )
            _log(f"[raffle] {curr_rusher} backed out")
            with _state_lock:
                new_rusher = rusher_queue[0]["twitch_name"] if rusher_queue else None
            if not new_rusher:
                post_chat_threadsafe(
                    f"@{CADE_USERNAME} - no rusher available. "
                    f"Does anyone want to step up? Type !onduty followed by your group size."
                )
            return

        # Regular entry
        added = raffle_add_entry(username)
        if added:
            _log(f"[raffle] {username} joined")

def _run_bot() -> None:
    asyncio.set_event_loop(asyncio.new_event_loop())
    FTKBot().run()

# ─────────────────────────────────────────────────────────────────────────────
# CHANNEL SWITCHING
# ─────────────────────────────────────────────────────────────────────────────

async def _switch_channel_async(old_ch: str, new_ch: str) -> None:
    global _active_channel
    if bot_instance:
        try:
            await bot_instance.part_channels([old_ch])
        except Exception:
            pass
        await bot_instance.join_channels([new_ch])
    _active_channel = new_ch
    _log(f"[channel] Switched to #{new_ch}")

def switch_channel_threadsafe(new_ch: str) -> None:
    global _active_channel
    old_ch = _active_channel
    if new_ch == old_ch:
        return
    if bot_instance:
        asyncio.run_coroutine_threadsafe(
            _switch_channel_async(old_ch, new_ch), bot_instance.loop
        )
    else:
        _active_channel = new_ch
        _log(f"[channel] Set active channel to #{new_ch}")

# ─────────────────────────────────────────────────────────────────────────────
# GUI CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

_BTN_DANGER  = {"fg_color": "#6B1010", "hover_color": "#8B2020"}
_BTN_SUCCESS = {"fg_color": "#1A6B1A", "hover_color": "#2A8B2A"}
_BTN_WARN    = {"fg_color": "#6B4A10", "hover_color": "#8B6A20"}
_BTN_PURPLE  = {"fg_color": "#4A1A7A", "hover_color": "#6A2AAA"}

# ─────────────────────────────────────────────────────────────────────────────
# MAIN APP
# ─────────────────────────────────────────────────────────────────────────────

class FTKApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("FTK Ascend Monitor")
        self.geometry("1000x780")
        self.minsize(800, 600)
        self._ch_btns: dict[str, ctk.CTkButton] = {}
        self._build_ui()
        self._poll()

    # ─────────────────────────────────────────────────────────────────────────
    # UI BUILD
    # ─────────────────────────────────────────────────────────────────────────

    def _build_ui(self):
        # ── Top bar ──────────────────────────────────────────────────────────
        topbar = ctk.CTkFrame(self, fg_color="transparent")
        topbar.pack(fill="x", padx=16, pady=(12, 0))

        ctk.CTkLabel(
            topbar, text="FTK Ascend Monitor",
            font=ctk.CTkFont(size=20, weight="bold"),
        ).pack(side="left")

        self._status_dot = ctk.CTkLabel(
            topbar, text="● Connecting…",
            font=ctk.CTkFont(size=12), text_color="gray",
        )
        self._status_dot.pack(side="right", padx=4)

        ctk.CTkButton(
            topbar, text="↺ Reload Settings",
            command=self._reload_settings,
            width=120, height=26, font=ctk.CTkFont(size=11),
        ).pack(side="right", padx=(0, 8))

        self._test_timer_btn = ctk.CTkButton(
            topbar, text="⏱ Test Timer: OFF",
            command=self._toggle_test_timer,
            width=130, height=26, font=ctk.CTkFont(size=11),
            fg_color=("gray55", "gray28"), hover_color=("gray45", "gray38"),
        )
        self._test_timer_btn.pack(side="right", padx=(0, 4))

        # Channel toggle
        ch_frame = ctk.CTkFrame(topbar, fg_color="transparent")
        ch_frame.pack(side="right", padx=(0, 12))
        ctk.CTkLabel(ch_frame, text="Channel:", font=ctk.CTkFont(size=11)).pack(side="left", padx=(0, 4))
        for ch in ["barricade", "psynister"]:
            btn = ctk.CTkButton(
                ch_frame, text=ch, width=80, height=26,
                font=ctk.CTkFont(size=11),
                command=lambda c=ch: self._switch_channel(c),
            )
            btn.pack(side="left", padx=2)
            self._ch_btns[ch] = btn
        self._update_channel_buttons(_active_channel)

        # ── Main content: left=raffle, right=rushers ──────────────────────────
        content = ctk.CTkFrame(self, fg_color="transparent")
        content.pack(fill="both", expand=True, padx=16, pady=8)
        content.columnconfigure(0, weight=3)
        content.columnconfigure(1, weight=2)
        content.rowconfigure(0, weight=1)

        self._build_raffle_panel(content)
        self._build_rusher_panel(content)

        # ── Log ───────────────────────────────────────────────────────────────
        log_frame = ctk.CTkFrame(self)
        log_frame.pack(fill="x", padx=16, pady=(0, 10))
        ctk.CTkLabel(
            log_frame, text="Activity",
            font=ctk.CTkFont(size=12, weight="bold"),
        ).pack(anchor="w", padx=10, pady=(6, 2))
        self._log_box = ctk.CTkTextbox(
            log_frame, height=100, state="disabled",
            font=ctk.CTkFont(size=11, family="Courier"),
        )
        self._log_box.pack(fill="x", padx=8, pady=(0, 8))

    def _build_raffle_panel(self, parent):
        frame = ctk.CTkFrame(parent)
        frame.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        frame.rowconfigure(1, weight=1)
        frame.columnconfigure(0, weight=1)

        # Header
        hdr = ctk.CTkFrame(frame, fg_color="transparent")
        hdr.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 4))
        ctk.CTkLabel(
            hdr, text="!ascend Queue",
            font=ctk.CTkFont(size=14, weight="bold"),
        ).pack(side="left")
        self._timer_label = ctk.CTkLabel(hdr, text="", font=ctk.CTkFont(size=13), text_color="gray")
        self._timer_label.pack(side="left", padx=12)
        self._entry_badge = ctk.CTkLabel(
            hdr, text=" 0 ", font=ctk.CTkFont(size=11),
            fg_color=("gray65", "gray30"), corner_radius=8,
        )
        self._entry_badge.pack(side="right")

        # Entry list
        self._entry_list = ctk.CTkTextbox(
            frame, font=ctk.CTkFont(size=12, family="Courier"), state="disabled",
        )
        self._entry_list.grid(row=1, column=0, sticky="nsew", padx=10, pady=(0, 6))

        # Controls
        ctrl = ctk.CTkFrame(frame, fg_color="transparent")
        ctrl.grid(row=2, column=0, sticky="ew", padx=10, pady=(0, 8))
        ctrl.columnconfigure(0, weight=1)

        ctk.CTkButton(
            ctrl, text="🔄 Reopen Queue (new 130s window)",
            command=self._reopen_queue, height=32,
        ).grid(row=0, column=0, sticky="ew", pady=(0, 6))

        # Manual add row
        add_row = ctk.CTkFrame(ctrl, fg_color="transparent")
        add_row.grid(row=1, column=0, sticky="ew", pady=(0, 4))
        add_row.columnconfigure(0, weight=1)
        self._manual_entry_var = ctk.StringVar()
        ctk.CTkEntry(
            add_row, textvariable=self._manual_entry_var,
            placeholder_text="Add username to queue…", height=30,
        ).grid(row=0, column=0, sticky="ew", padx=(0, 4))
        ctk.CTkButton(
            add_row, text="+ Add", width=60, height=30,
            command=self._manual_add_entry,
        ).grid(row=0, column=1)
        ctk.CTkButton(
            add_row, text="Test ×10", width=70, height=30,
            command=self._populate_test_entries,
            fg_color=("gray50", "gray30"), hover_color=("gray40", "gray25"),
        ).grid(row=0, column=2, padx=(4, 0))

        # Manual draw row
        draw_row = ctk.CTkFrame(ctrl, fg_color="transparent")
        draw_row.grid(row=2, column=0, sticky="ew")

        ctk.CTkLabel(draw_row, text="Draw:", width=42, anchor="w").pack(side="left")
        self._draw_count = ctk.IntVar(value=1)
        ctk.CTkEntry(draw_row, textvariable=self._draw_count, width=42).pack(side="left")
        ctk.CTkButton(
            draw_row, text="▲", width=24, height=24,
            command=lambda: self._draw_count.set(min(MAX_GROUP_SIZE, self._draw_count.get() + 1)),
        ).pack(side="left", padx=(2, 0))
        ctk.CTkButton(
            draw_row, text="▼", width=24, height=24,
            command=lambda: self._draw_count.set(max(1, self._draw_count.get() - 1)),
        ).pack(side="left", padx=2)
        ctk.CTkButton(
            draw_row, text="▶ Manual Draw", height=30,
            command=self._manual_draw, **_BTN_SUCCESS,
        ).pack(side="left", padx=(10, 0))

        ctk.CTkButton(
            ctrl, text="⚠ Bad Actors", height=28, font=ctk.CTkFont(size=11),
            command=self._open_bad_actors, **_BTN_PURPLE,
        ).grid(row=3, column=0, sticky="w", pady=(8, 0))

    def _build_rusher_panel(self, parent):
        frame = ctk.CTkFrame(parent)
        frame.grid(row=0, column=1, sticky="nsew")
        frame.rowconfigure(1, weight=1)
        frame.columnconfigure(0, weight=1)

        hdr = ctk.CTkFrame(frame, fg_color="transparent")
        hdr.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 4))
        ctk.CTkLabel(
            hdr, text="Rushers",
            font=ctk.CTkFont(size=14, weight="bold"),
        ).pack(side="left")
        self._rusher_badge = ctk.CTkLabel(
            hdr, text=" 0 ", font=ctk.CTkFont(size=11),
            fg_color=("gray65", "gray30"), corner_radius=8,
        )
        self._rusher_badge.pack(side="right")

        self._rusher_scroll = ctk.CTkScrollableFrame(frame)
        self._rusher_scroll.grid(row=1, column=0, sticky="nsew", padx=10, pady=(0, 10))
        self._rusher_scroll.columnconfigure(0, weight=1)

    # ─────────────────────────────────────────────────────────────────────────
    # ACTIONS
    # ─────────────────────────────────────────────────────────────────────────

    def _reload_settings(self):
        _load_local_settings()
        _log("[settings] Reloaded local_settings.json")

    def _toggle_test_timer(self):
        global _test_timer_mode
        _test_timer_mode = not _test_timer_mode
        if _test_timer_mode:
            self._test_timer_btn.configure(
                text="⏱ Test Timer: ON",
                fg_color="#8B4000", hover_color="#A05000",
            )
            _log(f"[test] Timer set to {TEST_TIMER_DURATION}s")
        else:
            self._test_timer_btn.configure(
                text="⏱ Test Timer: OFF",
                fg_color=("gray55", "gray28"), hover_color=("gray45", "gray38"),
            )
            _log(f"[test] Timer restored to {RAFFLE_DURATION}s")

    def _switch_channel(self, channel: str):
        switch_channel_threadsafe(channel)
        self._update_channel_buttons(channel)

    def _update_channel_buttons(self, active: str):
        for ch, btn in self._ch_btns.items():
            if ch == active:
                btn.configure(fg_color="#1A6B1A", hover_color="#2A8B2A")
            else:
                btn.configure(fg_color=("gray55", "gray28"), hover_color=("gray45", "gray38"))

    def _reopen_queue(self):
        raffle_reopen()

    def _manual_add_entry(self):
        name = self._manual_entry_var.get().strip()
        if not name:
            return
        with _state_lock:
            already = name.lower() in (e.lower() for e in ascend_entries)
            if not already:
                ascend_entries.append(name)
        if not already:
            sb_sync.raffle_entries_update(list(ascend_entries))
            self._manual_entry_var.set("")
            _log(f"[manual] added {name} to ascend queue")
        else:
            _log(f"[manual] {name} already in queue")

    def _populate_test_entries(self):
        with _state_lock:
            for i in range(1, 11):
                name = f"player{i}"
                if name.lower() not in (e.lower() for e in ascend_entries):
                    ascend_entries.append(name)
        sb_sync.raffle_entries_update(list(ascend_entries))
        _log("[manual] added player1–player10 to ascend queue")

    def _manual_draw(self):
        with _state_lock:
            if not ascend_entries:
                messagebox.showwarning("Empty Queue", "No entries in the ascend queue.")
                return
            rusher = raffle_rusher or (rusher_queue[0]["twitch_name"] if rusher_queue else None)
        count   = max(1, min(MAX_GROUP_SIZE, self._draw_count.get()))
        with _state_lock:
            entries_before = len(ascend_entries)
        winners = raffle_draw(count)
        if not winners:
            messagebox.showwarning("No Winners", "Could not draw any winners.")
            return
        # Remove winners from pool so they can't be re-drawn
        winner_set = {w.lower() for w in winners}
        with _state_lock:
            ascend_entries[:] = [e for e in ascend_entries if e.lower() not in winner_set]
        pings      = " ".join(f"@{w}" for w in winners)
        spots_left = count - len(winners)
        suffix     = f" and room for {spots_left} more" if spots_left > 0 else ""
        twitch_msg = (f"@{CADE_USERNAME} - @{rusher} carrying {pings}{suffix}"
                      if rusher else f"@{CADE_USERNAME} - need a carry for {pings}{suffix}")
        yt_msg     = (f"@{rusher} carrying {pings}{suffix}"
                      if rusher else f"Need a carry for {pings}{suffix}")
        post_chat_threadsafe(twitch_msg)
        post_youtube_chat(yt_msg)
        _log(f"[manual draw] {twitch_msg}")
        sb_sync.raffle_draw_log(rusher, winners, count, entries_before)

    def _remove_rusher(self, twitch_name: str):
        if messagebox.askyesno("Remove Rusher", f"Remove {twitch_name} from the queue?"):
            rusher_remove(twitch_name)
            _log(f"[rusher] {twitch_name} removed manually")

    def _open_bad_actors(self):
        win = ctk.CTkToplevel(self)
        win.title("Bad Actors")
        win.geometry("640x420")
        win.lift()
        self._refresh_bad_actors_win(win)

    def _refresh_bad_actors_win(self, win: ctk.CTkToplevel):
        for w in win.winfo_children():
            w.destroy()

        if not bad_actors:
            ctk.CTkLabel(win, text="No bad actors on record.", text_color="gray").pack(pady=30)
            return

        scroll = ctk.CTkScrollableFrame(win)
        scroll.pack(fill="both", expand=True, padx=10, pady=10)
        scroll.columnconfigure(1, weight=1)

        headers = ["Player", "!ascend\nBackouts", "!offduty\nBackouts", "Status", ""]
        for col, h in enumerate(headers):
            ctk.CTkLabel(scroll, text=h, font=ctk.CTkFont(size=11, weight="bold"),
                         text_color="gray").grid(row=0, column=col, padx=6, pady=(0, 6), sticky="w")

        for row_i, (key, data) in enumerate(bad_actors.items(), start=1):
            banned  = data.get("banned", False)
            color   = "#CC4444" if banned else "white"
            status  = "BANNED" if banned else "ok"
            btn_txt = "Unban" if banned else "Ban"
            btn_kw  = _BTN_SUCCESS if banned else _BTN_DANGER

            ctk.CTkLabel(scroll, text=data["twitch_name"], text_color=color,
                         anchor="w").grid(row=row_i, column=0, padx=6, pady=3, sticky="w")
            ctk.CTkLabel(scroll, text=str(data["ascend_backouts"]),
                         anchor="center").grid(row=row_i, column=1, padx=6)
            ctk.CTkLabel(scroll, text=str(data["offduty_backouts"]),
                         anchor="center").grid(row=row_i, column=2, padx=6)
            ctk.CTkLabel(scroll, text=status, text_color=color,
                         anchor="center").grid(row=row_i, column=3, padx=6)
            ctk.CTkButton(
                scroll, text=btn_txt, width=70, height=26,
                command=lambda k=key, w=win: self._toggle_ban(k, w),
                **btn_kw,
            ).grid(row=row_i, column=4, padx=6, pady=2)

    def _toggle_ban(self, key: str, win: ctk.CTkToplevel):
        if bad_actors.get(key, {}).get("banned"):
            unban_user(bad_actors[key]["twitch_name"])
        else:
            ban_user(bad_actors[key]["twitch_name"])
        self._refresh_bad_actors_win(win)

    # ─────────────────────────────────────────────────────────────────────────
    # POLL
    # ─────────────────────────────────────────────────────────────────────────

    def _poll(self):
        self._refresh_entry_list()
        self._refresh_rusher_panel()
        self._refresh_timer()
        self._refresh_log()
        self._refresh_status()
        self.after(500, self._poll)

    def _refresh_entry_list(self):
        with _state_lock:
            entries = list(ascend_entries)
        self._entry_badge.configure(text=f" {len(entries)} ")
        self._entry_list.configure(state="normal")
        self._entry_list.delete("1.0", "end")
        for i, name in enumerate(entries, 1):
            self._entry_list.insert("end", f"{i:3}. {name}\n")
        self._entry_list.configure(state="disabled")

    def _refresh_rusher_panel(self):
        with _state_lock:
            rushers = list(rusher_queue)
        self._rusher_badge.configure(text=f" {len(rushers)} ")

        # Only rebuild widgets if the list actually changed
        snapshot = [(r["twitch_name"], r["group_size"]) for r in rushers]
        if getattr(self, "_last_rusher_snapshot", None) == snapshot:
            return
        self._last_rusher_snapshot = snapshot

        for w in self._rusher_scroll.winfo_children():
            w.destroy()

        for i, r in enumerate(rushers):
            is_active = (i == 0)
            row = ctk.CTkFrame(
                self._rusher_scroll,
                fg_color=("#1C3A1C", "#1C3A1C") if is_active else "transparent",
                corner_radius=6,
            )
            row.grid(row=i, column=0, sticky="ew", pady=3, padx=2)
            row.columnconfigure(1, weight=1)

            ctk.CTkLabel(
                row,
                text="▶" if is_active else f"{i + 1}.",
                width=26, anchor="center",
                font=ctk.CTkFont(size=13, weight="bold" if is_active else "normal"),
                text_color="#4ACD4A" if is_active else "gray",
            ).grid(row=0, column=0, padx=(8, 4), pady=6)

            name = r["twitch_name"]
            size = r["group_size"]
            ctk.CTkLabel(
                row,
                text=f"{name}  ×{size}",
                anchor="w",
                font=ctk.CTkFont(size=12, weight="bold" if is_active else "normal"),
            ).grid(row=0, column=1, sticky="w")

            btn_frame = ctk.CTkFrame(row, fg_color="transparent")
            btn_frame.grid(row=0, column=2, padx=(0, 6), pady=4)

            ctk.CTkButton(
                btn_frame, text="↑", width=28, height=28,
                command=lambda n=name: self._move_up(n),
            ).pack(side="left", padx=1)
            ctk.CTkButton(
                btn_frame, text="↓", width=28, height=28,
                command=lambda n=name: self._move_down(n),
            ).pack(side="left", padx=1)
            ctk.CTkButton(
                btn_frame, text="✕", width=28, height=28,
                command=lambda n=name: self._remove_rusher(n),
                **_BTN_DANGER,
            ).pack(side="left", padx=1)

    def _move_up(self, name: str):
        rusher_move(name, -1)

    def _move_down(self, name: str):
        rusher_move(name, 1)

    def _refresh_timer(self):
        with _state_lock:
            active    = raffle_active
            end_time  = raffle_end_time
        if active:
            remaining = max(0, int(end_time - time.time()))
            m, s = divmod(remaining, 60)
            self._timer_label.configure(
                text=f"⏱ {m}:{s:02d}",
                text_color="#F0A020" if remaining <= 30 else "#60CC60",
            )
        else:
            self._timer_label.configure(text="", text_color="gray")

    def _refresh_log(self):
        lines = list(_log_lines[-30:])
        self._log_box.configure(state="normal")
        self._log_box.delete("1.0", "end")
        self._log_box.insert("end", "\n".join(lines))
        self._log_box.configure(state="disabled")
        self._log_box.see("end")

    def _refresh_status(self):
        if bot_instance:
            self._status_dot.configure(
                text=f"● #{_active_channel}", text_color="#4ACD4A",
            )
        else:
            self._status_dot.configure(text="● Connecting…", text_color="gray")

# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# LOCAL HTTP API  (called by the Next.js web panel)
# ─────────────────────────────────────────────────────────────────────────────

_flask_app = _Flask(__name__)
BOT_API_PORT = 7655

@_flask_app.post("/add-rusher")
def _api_add_rusher():
    data       = _flask_request.get_json(silent=True) or {}
    name       = (data.get("twitch_name") or "").strip().lower()
    group_size = max(1, min(5, int(data.get("group_size", 1))))
    if not name:
        return _jsonify({"error": "twitch_name required"}), 400
    with _state_lock:
        already = any(r["twitch_name"].lower() == name for r in rusher_queue)
        if not already:
            position = (max((r.get("position", i) for i, r in enumerate(rusher_queue)), default=-1) + 1)
            rusher_queue.append({"twitch_name": name, "group_size": group_size, "position": position})
    if already:
        return _jsonify({"error": f"{name} is already in the queue"}), 409
    sb_sync.rusher_queue_update(list(rusher_queue))
    _log(f"[web] added rusher {name} ×{group_size}")
    return _jsonify({"ok": True, "twitch_name": name, "group_size": group_size})

@_flask_app.post("/add-entry")
def _api_add_entry():
    data = _flask_request.get_json(silent=True) or {}
    name = (data.get("twitch_name") or "").strip()
    if not name:
        return _jsonify({"error": "twitch_name required"}), 400
    with _state_lock:
        already = name.lower() in (e.lower() for e in ascend_entries)
        if not already:
            ascend_entries.append(name)
    if already:
        return _jsonify({"error": f"{name} is already in the queue"}), 409
    sb_sync.raffle_entries_update(list(ascend_entries))
    _log(f"[web] added {name} to ascend queue")
    return _jsonify({"ok": True, "twitch_name": name})

@_flask_app.post("/reopen")
def _api_reopen():
    raffle_reopen()
    with _state_lock:
        return _jsonify({"ok": True, "end_time": raffle_end_time, "paused": False})

@_flask_app.post("/pause")
def _api_pause():
    with _state_lock:
        currently_paused = raffle_paused
    if currently_paused:
        raffle_unpause()
    else:
        raffle_pause()
    with _state_lock:
        return _jsonify({"paused": raffle_paused, "remaining": int(raffle_pause_remaining)})

@_flask_app.post("/winners")
def _api_winners():
    """
    POST /winners
    Body: { "winners": ["name1", ...], "rusher": "name" | null, "group_size": 4 }
    Builds the winners message and posts it to Twitch + YouTube chat.
    """
    data      = _flask_request.get_json(silent=True) or {}
    winners   = data.get("winners", [])
    rusher    = data.get("rusher") or None
    count     = int(data.get("group_size", len(winners)))

    if not winners:
        return _jsonify({"error": "no winners provided"}), 400

    pings      = " ".join(f"@{w}" for w in winners)
    spots_left = count - len(winners)
    suffix     = f" and room for {spots_left} more" if spots_left > 0 else ""

    if rusher and rusher.lower() == "barricade":
        twitch_msg = f"@{CADE_USERNAME} - winners: {pings}{suffix}"
        yt_msg     = f"Winners: {pings}{suffix}"
    elif rusher:
        twitch_msg = f"@{CADE_USERNAME} - @{rusher} carrying {pings}{suffix}"
        yt_msg     = f"@{rusher} carrying {pings}{suffix}"
    else:
        twitch_msg = f"@{CADE_USERNAME} - need a carry for {pings}{suffix}"
        yt_msg     = f"Need a carry for {pings}{suffix}"

    post_chat_threadsafe(twitch_msg)
    post_youtube_chat(yt_msg)
    _log(f"[web draw] {twitch_msg}")
    return _jsonify({"ok": True})

def _run_flask() -> None:
    import logging
    log = logging.getLogger("werkzeug")
    log.setLevel(logging.ERROR)
    _flask_app.run(host="127.0.0.1", port=BOT_API_PORT, debug=False, use_reloader=False)

if __name__ == "__main__":
    threading.Thread(target=_run_bot, daemon=True).start()
    threading.Thread(target=_raffle_timer_loop, daemon=True).start()
    threading.Thread(target=_youtube_chat_loop, daemon=True).start()
    threading.Thread(target=_run_flask, daemon=True).start()
    FTKApp().mainloop()
