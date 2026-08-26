"""Chart handoff for the Discord Activity.

A Discord Activity launch carries no parameters - Discord opens the root URL
and appends only instance/channel/guild ids. So when a member clicks "Open in
Discord" under a chart, the endpoint records "this channel just launched
NVDA · D (with this style)" here, and the Activity page asks for the newest
handoff in its channel. In-memory with a short TTL: the web pod is one
process, and a handoff older than a few minutes is not what anyone meant.
"""
from __future__ import annotations

import threading
import time

TTL_S = 300.0
_lock = threading.Lock()
_by_channel: dict[str, dict] = {}


def record(channel_id: str, *, user_id: str, ticker: str, tf: str, prefs: dict | None = None,
           now: float | None = None) -> dict:
    entry = {"channel_id": str(channel_id), "user_id": str(user_id or ""), "ticker": str(ticker).upper(),
             "tf": str(tf), "prefs": dict(prefs or {}), "ts": time.time() if now is None else now}
    with _lock:
        _by_channel[str(channel_id)] = entry
    return dict(entry)


def latest(channel_id: str, *, now: float | None = None) -> dict | None:
    """The newest handoff for the channel, or None once it is older than TTL_S."""
    now = time.time() if now is None else now
    with _lock:
        entry = _by_channel.get(str(channel_id))
        if entry is None:
            return None
        if now - entry["ts"] > TTL_S:
            _by_channel.pop(str(channel_id), None)
            return None
        return dict(entry)


def clear_for_tests() -> None:
    with _lock:
        _by_channel.clear()
