"""Per-Discord-user chart preferences for /chart (set with /chartsettings).

Stored by Discord user id in a small SQLite file on the web volume. The
preferences shape the render three ways: a partial chart-settings override
(`?indicators=`) for the house page, the `ext` / `stats` URL switches, and the
mplfinance fallback's flags. `style_signature` folds the render-affecting
prefs into the PNG cache key so two members with different styles never
share an image; the default timeframe is NOT part of the style.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time

_DB_PATH = os.environ.get("DISCORD_CHART_PREFS_DB_PATH", "/data/discord_chart_prefs.db")

TF_LABEL = {"D": "Daily", "W": "Weekly", "60": "60 min", "30": "30 min", "15": "15 min", "5": "5 min"}
MA_CHOICES = {
    "house": "House (EMA 9/20 · SMA 50/200)",
    "10-20-50": "SMA 10/20/50",
    "off": "No moving averages",
}
DEFAULTS = {"tf": "D", "mas": "house", "volume": True, "ext": True, "stats": True}
_BOOL_KEYS = ("volume", "ext", "stats")

# Complete overlay slots (the page's override merge replaces the array as a
# whole). Colours follow the dashboard's own overlay palette.
_SLOT = {"lineWidth": 1, "lineStyle": "solid", "offset": 0, "plotStyle": "line", "onTop": False}
_OFF = [{"enabled": False, "type": "SMA", "period": p, "color": "#888888", **_SLOT} for p in (9, 20, 50, 200, 5)]
_SMA_10_20_50 = [
    {"enabled": True, "type": "SMA", "period": 10, "color": "#4ade80", **_SLOT},
    {"enabled": True, "type": "SMA", "period": 20, "color": "#f472b6", **_SLOT},
    {"enabled": True, "type": "SMA", "period": 50, "color": "#60a5fa", **_SLOT},
    {"enabled": False, "type": "SMA", "period": 200, "color": "#fb923c", **_SLOT},
    {"enabled": False, "type": "SMA", "period": 5, "color": "rgba(168,162,144,0.55)", **_SLOT},
]

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _db_path() -> str:
    return os.environ.get("DISCORD_CHART_PREFS_DB_PATH", _DB_PATH)


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        path = _db_path()
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        c = sqlite3.connect(path, check_same_thread=False)
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("CREATE TABLE IF NOT EXISTS prefs (discord_user_id TEXT PRIMARY KEY, prefs_json TEXT NOT NULL, updated_at REAL NOT NULL)")
        c.commit()
        _conn = c
    return _conn


def reset_connection_for_tests() -> None:
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn = None


def _validate(changes: dict) -> dict:
    out = {}
    for k, v in changes.items():
        if k == "tf":
            if v not in TF_LABEL:
                raise ValueError("tf must be one of " + ", ".join(TF_LABEL))
            out[k] = v
        elif k == "mas":
            if v not in MA_CHOICES:
                raise ValueError("mas must be one of " + ", ".join(MA_CHOICES))
            out[k] = v
        elif k in _BOOL_KEYS:
            if not isinstance(v, bool):
                raise ValueError(f"{k} must be true or false")
            out[k] = v
        else:
            raise ValueError(f"unknown preference {k!r}")
    return out


def get_prefs(user_id: str) -> dict:
    with _lock:
        row = _connect().execute("SELECT prefs_json FROM prefs WHERE discord_user_id = ?", (str(user_id),)).fetchone()
    stored = {}
    if row:
        try:
            stored = json.loads(row[0]) or {}
        except ValueError:
            stored = {}
    merged = dict(DEFAULTS)
    for k, v in stored.items():
        if k in DEFAULTS:
            merged[k] = v
    return merged


def set_prefs(user_id: str, **changes) -> dict:
    """Validate every change first, then write; a bad value writes nothing."""
    clean = _validate(changes)
    merged = {**get_prefs(user_id), **clean}
    with _lock:
        c = _connect()
        c.execute("INSERT INTO prefs (discord_user_id, prefs_json, updated_at) VALUES (?, ?, ?) "
                  "ON CONFLICT(discord_user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = excluded.updated_at",
                  (str(user_id), json.dumps(merged), time.time()))
        c.commit()
    return merged


def reset_prefs(user_id: str) -> dict:
    with _lock:
        c = _connect()
        c.execute("DELETE FROM prefs WHERE discord_user_id = ?", (str(user_id),))
        c.commit()
    return dict(DEFAULTS)


def describe(prefs: dict) -> str:
    p = {**DEFAULTS, **(prefs or {})}
    return (f"Timeframe {TF_LABEL.get(p['tf'], p['tf'])} · MAs: {MA_CHOICES.get(p['mas'], p['mas'])} · "
            f"Volume {'on' if p['volume'] else 'off'} · Pre/post-market {'on' if p['ext'] else 'off'} · "
            f"Stats strip {'on' if p['stats'] else 'off'}")


def render_options(prefs: dict) -> dict:
    """What the house URL needs: a partial chart-settings override (or None),
    and the ext / stats switches."""
    p = {**DEFAULTS, **(prefs or {})}
    ind: dict = {}
    if p["mas"] == "off":
        ind["overlays"] = [dict(o) for o in _OFF]
    elif p["mas"] == "10-20-50":
        ind["overlays"] = [dict(o) for o in _SMA_10_20_50]
    if not p["volume"]:
        ind["volume"] = {"visible": False}
    return {"indicators": ind or None, "ext": bool(p["ext"]), "stats": bool(p["stats"])}


def style_signature(prefs: dict) -> str:
    """Short, stable key for the render-affecting prefs (never the timeframe)."""
    p = {**DEFAULTS, **(prefs or {})}
    if p["mas"] == DEFAULTS["mas"] and all(p[k] == DEFAULTS[k] for k in _BOOL_KEYS):
        return "default"
    return f"mas={p['mas']},vol={int(p['volume'])},ext={int(p['ext'])},stats={int(p['stats'])}"
