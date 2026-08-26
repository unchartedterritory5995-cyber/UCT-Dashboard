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
# `ext` = extended-hours CANDLES on intraday charts. Off by owner decision
# (8/25): the pre/post-market print shows as the orange Pre/Post price chip on
# the right axis instead, like the Charts widget - candles for it squashed a
# session into a strip of flat overnight bars.
# Everything below maps onto something the /r/chart page ALREADY honours: a
# preset (`?preset=`), a partial chart-settings override (`?indicators=`), or
# engine indicator instances (`?instances=`). Nothing here teaches the chart a
# new trick; it only lets a member pick among the app's own.
THEME_CHOICES = {
    "house": "House (the owner's theme)",
    "classic": "Classic Dark",
    "oled": "OLED Black",
    "tradingview": "TradingView",
    "light": "Light",
}
STYLE_CHOICES = {
    "candles": "Candles",
    "hollow": "Hollow candles",
    "bars": "OHLC bars",
    "line": "Line",
    "area": "Area",
    "heikin": "Heikin-Ashi",
}
SCALE_CHOICES = {"linear": "Linear", "log": "Log"}
INDICATOR_CHOICES = {
    "none": "None",
    "rsi": "RSI (14)",
    "macd": "MACD (12/26/9)",
    "rsi+macd": "RSI + MACD",
}
_CHOICE_KEYS = {"mas": MA_CHOICES, "theme": THEME_CHOICES, "style": STYLE_CHOICES,
                "scale": SCALE_CHOICES, "indicators": INDICATOR_CHOICES}
DEFAULTS = {"tf": "D", "mas": "house", "volume": True, "ext": False, "stats": True,
            "theme": "house", "style": "candles", "scale": "linear", "grid": True, "watermark": True,
            "indicators": "none"}
_BOOL_KEYS = ("volume", "ext", "stats", "grid", "watermark")

# Engine indicator instances, in the shape `instances.js::validateInstance`
# accepts (instanceId in the user namespace, defId = the registry id, declared
# inputs only). Defaults are the registry's own (nativeRegistry.js).
_INSTANCES = {
    "rsi": {"instanceId": "inst:rsi:1", "defId": "rsi", "inputs": {"period": 14}, "hidden": False},
    "macd": {"instanceId": "inst:macd:1", "defId": "macd",
             "inputs": {"fastPeriod": 12, "slowPeriod": 26, "signalPeriod": 9}, "hidden": False},
}


def _instances_for(choice: str):
    out = []
    for k in str(choice or "").split("+"):
        if k in _INSTANCES:
            inst = dict(_INSTANCES[k]); inst["inputs"] = dict(inst["inputs"]); out.append(inst)
    return out or None

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
        elif k in _CHOICE_KEYS:
            if v not in _CHOICE_KEYS[k]:
                raise ValueError(f"{k} must be one of " + ", ".join(_CHOICE_KEYS[k]))
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
    onoff = lambda k: "on" if p[k] else "off"  # noqa: E731
    return (f"Timeframe {TF_LABEL.get(p['tf'], p['tf'])} · MAs: {MA_CHOICES.get(p['mas'], p['mas'])} · "
            f"Volume {onoff('volume')} · Pre/post-market candles {onoff('ext')} · Stats strip {onoff('stats')} · "
            f"Theme: {THEME_CHOICES.get(p['theme'], p['theme'])} · Style: {STYLE_CHOICES.get(p['style'], p['style'])} · "
            f"Scale: {SCALE_CHOICES.get(p['scale'], p['scale'])} · Grid {onoff('grid')} · Watermark {onoff('watermark')} · "
            f"Indicators: {INDICATOR_CHOICES.get(p['indicators'], p['indicators'])}")


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
    if p["style"] == "heikin":
        ind["heikinAshi"] = True
    elif p["style"] != "candles":
        ind["chartType"] = p["style"]
    if p["scale"] == "log":
        ind["logScale"] = True
    if not p["grid"]:
        ind["grid"] = {"visible": False}
    if not p["watermark"]:
        ind["watermark"] = {"visible": False}
    return {"indicators": ind or None, "ext": bool(p["ext"]), "stats": bool(p["stats"]),
            "preset": p["theme"] if p["theme"] != "house" else None,
            "instances": _instances_for(p["indicators"]) if p["indicators"] != "none" else None}


def style_signature(prefs: dict) -> str:
    """Short, stable key for the render-affecting prefs (never the timeframe)."""
    p = {**DEFAULTS, **(prefs or {})}
    if all(p[k] == DEFAULTS[k] for k in DEFAULTS if k != "tf"):
        return "default"
    return ",".join(f"{k}={int(p[k]) if isinstance(p[k], bool) else p[k]}" for k in sorted(DEFAULTS) if k != "tf")
