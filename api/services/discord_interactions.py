"""Discord interaction plumbing for the /chart slash command. Pure helpers.

No FastAPI objects here. The router (api/routers/discord_interactions.py)
verifies + parses with these and schedules `run_chart_job`; the local tool
(tools/discord_chart_commands.py) registers `build_chart_command()`.
"""
from __future__ import annotations

import dataclasses
import json
import logging
import os
import re
import threading
import time
from collections import deque
from dataclasses import dataclass

from api.services import discord_chart_cache as png_cache
from api.services import discord_chart_prefs as prefs_mod
from api.services.discord_chart_render import (STATS_DAILY_BARS, TF_LABEL, WINDOW,
                                               bars_to_request, compute_stats, to_datetime)

log = logging.getLogger(__name__)

DISCORD_API = "https://discord.com/api/v10"
EPHEMERAL = 64  # message flag: only the invoking user sees it
_TICKER_RE = re.compile(r"^[A-Z0-9.^-]{1,12}$")

def render_slot_count(default: int = 4) -> int:
    """Concurrent renders the API will run (env DISCORD_CHART_MAX_CONCURRENT).
    Each slot is a threadpool thread waiting on the renderer for a few seconds;
    the renderer has its own RENDER_MAX_CONCURRENT. Cache hits and single-flight
    waiters never take a slot."""
    raw = os.environ.get("DISCORD_CHART_MAX_CONCURRENT", "")
    try:
        n = int(raw)
        return n if 1 <= n <= 32 else default
    except (TypeError, ValueError):
        return default


# Bounded so a burst can never pin the API's threadpool; extra callers are
# told to retry rather than queue behind a cold Massive fetch.
RENDER_SLOTS = threading.BoundedSemaphore(render_slot_count())
BARS_RETRY_DELAY_S = 1.5
# What the /r/chart page's StockChart asks /api/bars for, on every timeframe.
# The job warms that exact request in-process before the house render so the
# page's own fetch hits the web pod's memory cache (0.2-0.35 s) instead of the
# cold path (7-20 s on 5-minute bars, measured 2026-08-25) - which was long
# enough to time out the renderer's first attempt and cost a 45 s retry.
PAGE_BARS = 5000

# Per-member throttle. A chart costs renderer CPU and one of the shared render
# slots; nobody should be able to hog them. DISCORD_CHART_USER_RATE = "6/60"
# means six charts per rolling sixty seconds per Discord user.
_rate_lock = threading.Lock()
_rate_hits: dict[str, deque] = {}


def user_rate(default: str = "6/60") -> tuple[int, float]:
    raw = os.environ.get("DISCORD_CHART_USER_RATE", default)
    try:
        n, s = raw.split("/")
        n, sec = int(n), float(s)
        if n > 0 and sec > 0:
            return n, sec
    except ValueError:
        pass
    n, s = default.split("/")
    return int(n), float(s)


def user_rate_check(uid: str, now: float | None = None) -> float:
    """0.0 when the member may render now (their hit is recorded); otherwise
    the seconds until their next slot. An unknown uid is never throttled."""
    if not uid:
        return 0.0
    n, window = user_rate()
    now = time.time() if now is None else now
    with _rate_lock:
        q = _rate_hits.setdefault(str(uid), deque())
        while q and now - q[0] >= window:
            q.popleft()
        if len(q) >= n:
            return max(0.0, window - (now - q[0]))
        q.append(now)
        return 0.0


def reset_rate_for_tests() -> None:
    with _rate_lock:
        _rate_hits.clear()


def throttle_message(wait_s: float) -> str:
    n, window = user_rate()
    per = "minute" if int(window) == 60 else f"{int(window)}s"
    return f"Slow down: up to {n} charts per {per} per member. Try again in {max(1, int(wait_s + 0.999))}s."



class CommandError(ValueError):
    """User-facing validation failure; str(exc) is the ephemeral reply."""


@dataclass(frozen=True)
class ChartRequest:
    ticker: str
    tf: str
    mas: str | None = None       # per-call override of the member's MA preference
    volume: bool | None = None   # per-call override of the member's volume preference
    style: str | None = None     # per-call chart style (candles/hollow/bars/line/area/heikin)
    theme: str | None = None     # per-call theme preset
    daily_only: bool = False     # breadth pseudo-tickers: the series is daily-basis, no intraday
    display: str | None = None   # what the reply calls it (breadth: "UCTA5 · % of Stocks Above 5-Day MA")
    breadth_name: str | None = None  # set for a breadth metric: the page paints it the way the app does
    zoom: str | None = None      # per-call visible window (prefs key)
    indicators: str | None = None  # per-call lower-pane indicators (prefs key)
    to: str | None = None        # "Earlier" panning: end the window on this YYYY-MM-DD (None = live)

    def overrides(self) -> dict:
        """The prefs this one call overrides (member request: "/chart APP
        without MAs or volume" without touching saved settings)."""
        return {k: v for k, v in (("mas", self.mas), ("volume", self.volume),
                                  ("style", self.style), ("theme", self.theme),
                                  ("zoom", self.zoom), ("indicators", self.indicators)) if v is not None}


def verify_signature(public_key_hex: str, signature_hex: str, timestamp: str, body: bytes) -> bool:
    """Ed25519 check over timestamp+body with the app's public key. Never raises."""
    try:
        from nacl.signing import VerifyKey
        VerifyKey(bytes.fromhex(public_key_hex)).verify(
            (timestamp or "").encode() + body, bytes.fromhex(signature_hex))
        return True
    except Exception:
        return False


def parse_chart_command(interaction: dict, default_tf: str = "D") -> ChartRequest:
    data = interaction.get("data") or {}
    opts = {o.get("name"): o.get("value") for o in (data.get("options") or []) if isinstance(o, dict)}
    ticker = str(opts.get("ticker") or "").strip().upper().lstrip("$")
    if not _TICKER_RE.match(ticker):
        raise CommandError("Ticker must be 1-12 letters/digits (e.g. NVDA, BRK.B).")
    tf = str(opts.get("tf") or default_tf or "D")
    if tf not in WINDOW:
        raise CommandError("Timeframe must be one of: " + ", ".join(TF_LABEL.values()) + ".")
    mas = opts.get("mas")
    if mas is not None:
        mas = str(mas)
        if mas not in prefs_mod.MA_CHOICES:
            raise CommandError("mas must be one of: " + ", ".join(prefs_mod.MA_CHOICES) + ".")
    volume = opts.get("volume")
    if volume is not None and not isinstance(volume, bool):
        raise CommandError("volume must be true or false.")
    style = opts.get("style")
    if style is not None and str(style) not in prefs_mod.STYLE_CHOICES:
        raise CommandError("style must be one of: " + ", ".join(prefs_mod.STYLE_CHOICES) + ".")
    theme = opts.get("theme")
    if theme is not None and str(theme) not in prefs_mod.THEME_CHOICES:
        raise CommandError("theme must be one of: " + ", ".join(prefs_mod.THEME_CHOICES) + ".")
    return ChartRequest(ticker=ticker, tf=tf, mas=mas, volume=volume,
                        style=None if style is None else str(style), theme=None if theme is None else str(theme))


CHART_COMMAND_NAMES = ("chart", "c")
SETTINGS_COMMAND = "chartsettings"

# ── Buttons under every chart ────────────────────────────────────────────────
# Members asked "how do I change the timeframe?" in chat on launch night. The
# reply carries two rows: the timeframes (active one blurple) and MAs / Volume
# toggles, plus a link to the interactive chart on the site. A click is a
# MESSAGE_COMPONENT interaction (type 3); the endpoint answers
# DEFERRED_UPDATE_MESSAGE (6) and the job PATCHes the same message with the new
# image, so the chart re-renders IN PLACE. custom_id carries the full state.
COMPONENT_PREFIX = "chart"
ACTIVITY_PREFIX = "activity"     # the "Open in Discord" button: same state, launches the Activity
LAUNCH_COMMAND = "launch"        # the Entry Point command (type 4) the App Launcher shows
BUTTON_TFS = (("D", "D"), ("W", "W"), ("60", "60m"), ("15", "15m"), ("5", "5m"))
_STYLE_PRIMARY, _STYLE_SECONDARY, _STYLE_LINK = 1, 2, 5


def activity_guilds() -> frozenset:
    """Where the "Open in Discord" button shows. An UNVERIFIED Activity launches
    only for the app's developers/testers and only in servers under 25 members,
    so until Discord verifies it the button is offered only in the dev server
    (DISCORD_ACTIVITY_GUILDS, comma-separated; blank = nowhere)."""
    raw = os.environ.get("DISCORD_ACTIVITY_GUILDS", "")
    return frozenset(x.strip() for x in raw.split(",") if x.strip())


def public_site_url() -> str:
    return (os.environ.get("CHART_RENDER_BASE_URL") or "https://uctintelligence.com").rstrip("/")


STATE_PREFIX = "c2"              # button/select state: c2|SYM|tf|mas|vol|zoom|ind|style|theme|to
SAVE_VALUE = "save"              # the Look dropdown's "save these as my defaults" pick
SELECT_ZOOM, SELECT_IND, SELECT_LOOK = "zoom", "ind", "look"
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Calendar days one "Earlier"/"Later" step moves the window, per zoom.
_PAN_DAYS_D = {"auto": 95, "1m": 31, "3m": 95, "6m": 185, "1y": 366, "2y": 731}
_PAN_DAYS_W = {"auto": 366, "1m": 35, "3m": 95, "6m": 185, "1y": 366, "2y": 731}
_MA_CYCLE = ("house", "10-20-50", "off")


def _state_of(req: ChartRequest, prefs: dict | None = None) -> dict:
    """What THIS image shows: the request's explicit choices over the member's prefs."""
    p = {**prefs_mod.DEFAULTS, **(prefs or {})}
    return {
        "ticker": req.ticker, "tf": req.tf,
        "mas": req.mas if req.mas is not None else p["mas"],
        "vol": req.volume if req.volume is not None else bool(p["volume"]),
        "zoom": req.zoom if req.zoom is not None else p["zoom"],
        "ind": req.indicators if req.indicators is not None else p["indicators"],
        "style": req.style if req.style is not None else p["style"],
        "theme": req.theme if req.theme is not None else p["theme"],
        "to": req.to or "",
    }


def _encode(st: dict, tag: str = "") -> str:
    # The trailing tag names the CONTROL (tf button, earlier, later, mas, vol) and
    # is ignored by the parser: Discord requires every custom_id in a message to
    # be unique, and two controls can legitimately point at the same state (the
    # active timeframe button and a disabled "Later" both mean "this chart").
    return "|".join([STATE_PREFIX, st["ticker"], st["tf"], st["mas"], "1" if st["vol"] else "0",
                     st["zoom"], st["ind"], st["style"], st["theme"], st["to"] or "", tag])


def component_id(ticker: str, tf: str, mas: str, volume: bool, **rest) -> str:
    st = {"ticker": ticker, "tf": tf, "mas": mas, "vol": bool(volume),
          "zoom": rest.get("zoom", "auto"), "ind": rest.get("ind", "none"),
          "style": rest.get("style", "candles"), "theme": rest.get("theme", "house"), "to": rest.get("to", "")}
    return _encode(st)


def _request_from_state(parts: list) -> ChartRequest:
    _, ticker, tf, mas, vol, zoom, ind, style, theme, to = parts
    ticker = ticker.strip().upper()
    ok = (_TICKER_RE.match(ticker) and tf in WINDOW and mas in prefs_mod.MA_CHOICES and vol in ("0", "1")
          and zoom in prefs_mod.ZOOM_CHOICES and ind in prefs_mod.INDICATOR_CHOICES
          and style in prefs_mod.STYLE_CHOICES and theme in prefs_mod.THEME_CHOICES
          and (to == "" or _DATE_RE.match(to)))
    if not ok:
        raise CommandError("Unknown button.")
    return ChartRequest(ticker=ticker, tf=tf, mas=mas, volume=(vol == "1"), zoom=zoom, indicators=ind,
                        style=style, theme=theme, to=to or None)


def component_kind(interaction: dict) -> str:
    """'chart' (re-render in place) or 'activity' (launch the Activity)."""
    cid = str(((interaction.get("data") or {}).get("custom_id")) or "")
    head = cid.split("|", 1)[0]
    if head == ACTIVITY_PREFIX:
        return "activity"
    if head in (COMPONENT_PREFIX, STATE_PREFIX, SELECT_ZOOM, SELECT_IND, SELECT_LOOK):
        return "chart"
    raise CommandError("Unknown button.")


def parse_component(interaction: dict) -> ChartRequest:
    """A button click or a dropdown pick -> the chart it asks for. Only our own
    custom_ids parse; anything else is a CommandError (an unknown control is
    not a chart). Legacy 5-part `chart|…` ids (messages sent before the
    dropdowns) still parse."""
    data = interaction.get("data") or {}
    cid = str(data.get("custom_id") or "")
    parts = cid.split("|")
    head = parts[0]
    if head in (COMPONENT_PREFIX, ACTIVITY_PREFIX) and len(parts) == 5:
        _, ticker, tf, mas, vol = parts
        ticker = ticker.strip().upper()
        if not _TICKER_RE.match(ticker) or tf not in WINDOW or mas not in prefs_mod.MA_CHOICES or vol not in ("0", "1"):
            raise CommandError("Unknown button.")
        return ChartRequest(ticker=ticker, tf=tf, mas=mas, volume=(vol == "1"))
    if head == STATE_PREFIX and len(parts) == 11:
        return _request_from_state(parts[:10])          # parts[10] = the control tag
    if head in (SELECT_ZOOM, SELECT_IND, SELECT_LOOK) and len(parts) == 12:
        req = _request_from_state(parts[1:11])
        values = data.get("values") or []
        value = str(values[0]) if values else ""
        if head == SELECT_ZOOM:
            if value not in prefs_mod.ZOOM_CHOICES:
                raise CommandError("Unknown zoom.")
            return dataclasses.replace(req, zoom=value, to=None)     # a new window starts from live
        if head == SELECT_IND:
            if value not in prefs_mod.INDICATOR_CHOICES:
                raise CommandError("Unknown indicator set.")
            return dataclasses.replace(req, indicators=value)
        if value == SAVE_VALUE:
            return req                                             # the router saves this state
        kind, _, choice = value.partition(":")
        if kind == "style" and choice in prefs_mod.STYLE_CHOICES:
            return dataclasses.replace(req, style=choice)
        if kind == "theme" and choice in prefs_mod.THEME_CHOICES:
            return dataclasses.replace(req, theme=choice)
        raise CommandError("Unknown look.")
    raise CommandError("Unknown button.")


def is_save_pick(interaction: dict) -> bool:
    """True when a Look dropdown pick is "save these as my defaults"."""
    data = interaction.get("data") or {}
    cid = str(data.get("custom_id") or "")
    values = data.get("values") or []
    return cid.startswith(SELECT_LOOK + "|") and bool(values) and str(values[0]) == SAVE_VALUE


def prefs_from_request(req: ChartRequest) -> dict:
    """The member-settable prefs a chart's state carries (what "save" writes)."""
    out = {"tf": req.tf}
    for key in ("mas", "volume", "zoom", "indicators", "style", "theme"):
        v = getattr(req, key)
        if v is not None:
            out[key] = v
    return out


def pan_to(current_to: str | None, tf: str, zoom: str, direction: int, today: str | None = None) -> str | None:
    """The end date one step earlier (-1) or later (+1); None = back to live."""
    import datetime as _dt
    days = (_PAN_DAYS_W if tf == "W" else _PAN_DAYS_D).get(zoom, 95)
    today_d = _dt.date.fromisoformat(today) if today else _dt.date.today()
    base = _dt.date.fromisoformat(current_to) if current_to else today_d
    nxt = base + _dt.timedelta(days=days * direction)
    if nxt >= today_d:
        return None
    return nxt.isoformat()


def chart_components(req: ChartRequest, prefs: dict | None = None, guild_id: str | None = None) -> list:
    """The rows under a chart, reflecting what THIS image shows. Five rows is
    Discord's ceiling: timeframes · Zoom · Indicators · Look · pan/MAs/volume."""
    st = _state_of(req, prefs)
    sid = lambda tag="", **changes: _encode({**st, **changes}, tag)  # noqa: E731
    tf_choices = [(tf, label) for tf, label in BUTTON_TFS if not req.daily_only or tf in ("D", "W")]
    tfs = [{"type": 2, "style": _STYLE_PRIMARY if tf == st["tf"] else _STYLE_SECONDARY, "label": label,
            "custom_id": sid("t", tf=tf, to="", zoom=st["zoom"] if st["zoom"] in prefs_mod.zoom_choices(tf) else "auto")}
           for tf, label in tf_choices]
    zooms = prefs_mod.zoom_choices(st["tf"])
    zoom_now = st["zoom"] if st["zoom"] in zooms else "auto"
    zoom_sel = {"type": 3, "custom_id": f"{SELECT_ZOOM}|{sid()}", "placeholder": "Zoom",
                "options": [{"label": f"Zoom: {label}", "value": v, "default": v == zoom_now} for v, label in zooms.items()]}
    ind_sel = {"type": 3, "custom_id": f"{SELECT_IND}|{sid()}", "placeholder": "Indicators",
               "options": [{"label": f"Indicators: {label}", "value": v, "default": v == st["ind"]}
                           for v, label in prefs_mod.INDICATOR_CHOICES.items()]}
    look_sel = {"type": 3, "custom_id": f"{SELECT_LOOK}|{sid()}", "placeholder": "Look",
                "options": ([{"label": f"Style: {label}", "value": f"style:{v}", "default": v == st["style"]}
                             for v, label in prefs_mod.STYLE_CHOICES.items()] +
                            # ONE default per single-select (Discord: COMPONENT_TOO_MANY_DEFAULT_VALUES) -
                            # the style carries it; the theme is read off the image.
                            [{"label": f"Theme: {label}", "value": f"theme:{v}", "default": False}
                             for v, label in prefs_mod.THEME_CHOICES.items()] +
                            # last, so the first option stays the chart's own style
                            [{"label": "\U0001f4be Save this chart's settings as my defaults", "value": SAVE_VALUE,
                              "description": "Timeframe, zoom, indicators, MAs, volume, style, theme"}])}
    ma_next = _MA_CYCLE[(_MA_CYCLE.index(st["mas"]) + 1) % len(_MA_CYCLE)] if st["mas"] in _MA_CYCLE else "house"
    ma_label = {"house": "MAs: House", "10-20-50": "MAs: 10/20/50", "off": "MAs: off"}.get(st["mas"], "MAs")
    can_pan = st["tf"] in ("D", "W")
    earlier = pan_to(st["to"] or None, st["tf"], zoom_now, -1)
    later = pan_to(st["to"] or None, st["tf"], zoom_now, +1) if st["to"] else None
    row5 = []
    if can_pan:
        row5.append({"type": 2, "style": _STYLE_SECONDARY, "label": "\u25c0 Earlier", "custom_id": sid("e", to=earlier or "")})
        row5.append({"type": 2, "style": _STYLE_SECONDARY, "label": "Later \u25b6", "custom_id": sid("l", to=later or ""),
                     "disabled": not st["to"]})
    row5.append({"type": 2, "style": _STYLE_SECONDARY, "label": ma_label, "custom_id": sid("m", mas=ma_next)})
    row5.append({"type": 2, "style": _STYLE_SECONDARY, "label": "Volume off" if st["vol"] else "Volume on",
                 "custom_id": sid("v", vol=not st["vol"])})
    if guild_id and str(guild_id) in activity_guilds():
        # The (parked) Activity: in an activity guild the last slot launches it instead of linking out.
        row5.append({"type": 2, "style": _STYLE_PRIMARY, "label": "Open in Discord",
                     "custom_id": f"{ACTIVITY_PREFIX}|{req.ticker}|{req.tf}|{st['mas']}|{1 if st['vol'] else 0}"})
    else:
        row5.append({"type": 2, "style": _STYLE_LINK, "label": "Open interactive \u2197",
                     "url": f"{public_site_url()}/research/{req.ticker}"})
    return [{"type": 1, "components": tfs}, {"type": 1, "components": [zoom_sel]},
            {"type": 1, "components": [ind_sel]}, {"type": 1, "components": [look_sel]},
            {"type": 1, "components": row5}]


def parse_autocomplete(interaction: dict) -> str:
    """The text the member has typed into the focused option (ticker), uppercased."""
    data = interaction.get("data") or {}
    for o in data.get("options") or []:
        if isinstance(o, dict) and o.get("focused"):
            return str(o.get("value") or "").strip().upper()[:10]
    return ""


def interaction_user_id(interaction: dict) -> str:
    """Discord user id: `member.user.id` in a guild, `user.id` in a DM."""
    m = interaction.get("member") or {}
    u = (m.get("user") if isinstance(m, dict) else None) or interaction.get("user") or {}
    return str(u.get("id") or "") if isinstance(u, dict) else ""


def parse_settings_command(interaction: dict) -> tuple:
    """/chartsettings show|set|reset -> ("show"|"set"|"reset", {changes})."""
    data = interaction.get("data") or {}
    subs = [o for o in (data.get("options") or []) if isinstance(o, dict) and o.get("type") == 1]
    if not subs:
        raise CommandError("Use /chartsettings show, set or reset.")
    sub = str(subs[0].get("name") or "")
    if sub in ("show", "reset"):
        return sub, {}
    if sub != "set":
        raise CommandError("Use /chartsettings show, set or reset.")
    changes = {o.get("name"): o.get("value") for o in (subs[0].get("options") or []) if isinstance(o, dict)}
    changes = {k: v for k, v in changes.items() if k in prefs_mod.DEFAULTS and v is not None}
    if not changes:
        raise CommandError("Nothing to set. Pick at least one option (" + ", ".join(prefs_mod.DEFAULTS) + ").")
    return "set", changes


def build_chart_command() -> dict:
    """The application-command payload Discord receives at registration."""
    return {
        "name": "chart",
        "type": 1,  # CHAT_INPUT
        "description": "House chart image: candles, volume, EMA 9/20 + SMA 50/200. Defaults: /chartsettings",
        "options": [
            {"name": "ticker", "description": "Ticker symbol, e.g. NVDA", "type": 3, "required": True,
             "autocomplete": True},
            {"name": "tf", "description": "Timeframe (default: your /chartsettings, else Daily)", "type": 3,
             "required": False,
             "choices": [{"name": label, "value": value} for value, label in TF_LABEL.items()]},
            {"name": "mas", "description": "Moving averages for THIS chart only", "type": 3, "required": False,
             "choices": [{"name": label, "value": value} for value, label in prefs_mod.MA_CHOICES.items()]},
            {"name": "volume", "description": "Volume pane for THIS chart only (True/False)", "type": 5,
             "required": False},
            {"name": "style", "description": "Chart style for THIS chart only", "type": 3, "required": False,
             "choices": [{"name": label, "value": value} for value, label in prefs_mod.STYLE_CHOICES.items()]},
            {"name": "theme", "description": "Theme for THIS chart only", "type": 3, "required": False,
             "choices": [{"name": label, "value": value} for value, label in prefs_mod.THEME_CHOICES.items()]},
        ],
    }


def build_alias_command() -> dict:
    """`/c` - the same command under a two-keystroke name (member request)."""
    cmd = build_chart_command()
    return {**cmd, "name": "c", "description": "Chart, short form: /c NVDA"}


def build_settings_command() -> dict:
    """`/chartsettings show|set|reset` - per-user defaults for /chart."""
    ch = lambda d: [{"name": label, "value": value} for value, label in d.items()]  # noqa: E731
    return {
        "name": SETTINGS_COMMAND, "type": 1,
        "description": "Your personal /chart defaults: timeframe, MAs, theme, style, scale, indicators, volume, grid…",
        "options": [
            {"name": "show", "type": 1, "description": "Show your current /chart settings"},
            {"name": "set", "type": 1, "description": "Change one or more settings", "options": [
                {"name": "tf", "type": 3, "required": False, "description": "Default timeframe", "choices": ch(TF_LABEL)},
                {"name": "mas", "type": 3, "required": False, "description": "Moving averages", "choices": ch(prefs_mod.MA_CHOICES)},
                {"name": "theme", "type": 3, "required": False, "description": "Theme preset", "choices": ch(prefs_mod.THEME_CHOICES)},
                {"name": "style", "type": 3, "required": False, "description": "Chart style", "choices": ch(prefs_mod.STYLE_CHOICES)},
                {"name": "scale", "type": 3, "required": False, "description": "Price scale", "choices": ch(prefs_mod.SCALE_CHOICES)},
                {"name": "indicators", "type": 3, "required": False, "description": "Lower-pane indicators", "choices": ch(prefs_mod.INDICATOR_CHOICES)},
                {"name": "zoom", "type": 3, "required": False, "description": "Visible window (months/years on D/W, days intraday)", "choices": ch(prefs_mod.ZOOM_CHOICES)},
                {"name": "volume", "type": 5, "required": False, "description": "Show the volume pane"},
                {"name": "grid", "type": 5, "required": False, "description": "Show the grid"},
                {"name": "watermark", "type": 5, "required": False, "description": "Show the ticker/company watermark"},
                {"name": "ext", "type": 5, "required": False, "description": "Extended-hours candles on intraday charts (the Pre/Post price chip always shows)"},
                {"name": "stats", "type": 5, "required": False, "description": "Show the stats strip (OHLC, gap, 52w, RVOL, ADR)"},
            ]},
            {"name": "reset", "type": 1, "description": "Back to the defaults"},
        ],
    }


# The ONLY servers this app serves. A public bot (or a stale guild install
# made before the app was locked down) can still deliver interactions from
# anywhere; every command handler refuses anything outside this set. Override
# with DISCORD_CHART_ALLOWED_GUILDS (comma-separated ids); the default is the
# two UCT servers so a deploy alone closes the door.
DEFAULT_ALLOWED_GUILDS = frozenset({
    "882293203485720596",   # Uncharted Territory (members)
    "1524909611054792786",  # UCT Intelligence (dev/admin)
})
NOT_ALLOWED_MESSAGE = "This app only works inside the Uncharted Territory and UCT Intelligence servers."


def allowed_guilds() -> frozenset:
    raw = os.environ.get("DISCORD_CHART_ALLOWED_GUILDS", "")
    ids = {x.strip() for x in raw.split(",") if x.strip()}
    return frozenset(ids) if ids else DEFAULT_ALLOWED_GUILDS


def guild_allowed(interaction: dict, allowed: frozenset | None = None) -> bool:
    """True only for a command sent from inside one of our servers.

    Refuses DMs / private channels (no guild, or a non-guild `context`), any
    user-install authorization (`authorizing_integration_owners` carrying the
    USER_INSTALL key "1"), and any guild id outside the allowlist."""
    allowed = allowed if allowed is not None else allowed_guilds()
    gid = str(interaction.get("guild_id") or "")
    if not gid or gid not in allowed:
        return False
    ctx = interaction.get("context")
    if ctx is not None and ctx != 0:  # 0 = GUILD
        return False
    owners = interaction.get("authorizing_integration_owners")
    if isinstance(owners, dict) and "1" in owners:
        return False
    return True


# Where the commands may be installed and used: GUILD_INSTALL only (never a
# user install, which would let any Discord user carry /chart into any server
# or DM), and only inside a guild. Registered on every command so a global
# PUT can never inherit the app's install contexts.
GUILD_ONLY = {"integration_types": [0], "contexts": [0]}


def build_launch_command() -> dict:
    """The Entry Point command (type 4). Enabling Activities auto-creates one
    named "Launch" with Discord handling the launch; ours uses APP_HANDLER so
    the endpoint answers LAUNCH_ACTIVITY itself, and it is ADMIN-ONLY until
    Discord verifies the Activity (an unverified one refuses members anyway).
    A bulk PUT overwrites every command, so this must ride along or it is gone."""
    return {"name": LAUNCH_COMMAND, "type": 4, "handler": 1,
            "description": "Open the interactive UCT chart",
            "default_member_permissions": "8"}


def build_commands(activity: bool = False) -> list:
    """Every application command this bot registers (one authority).
    `activity=True` adds the Entry Point command (only valid once Activities
    are enabled on the app)."""
    cmds = [build_chart_command(), build_alias_command(), build_settings_command()]
    if activity:
        cmds.append(build_launch_command())
    return [dict(c, **GUILD_ONLY) for c in cmds]


def attachment_name(ticker: str, tf: str, last_t) -> str:
    """TICKER_TF_YYYY-MM-DD_Chart.png, the house chart naming convention."""
    safe = re.sub(r"[^A-Z0-9]", "", ticker.upper())
    tf_tag = tf if tf in ("D", "W") else f"{tf}m"
    return f"{safe}_{tf_tag}_{to_datetime(last_t, tf).strftime('%Y-%m-%d')}_Chart.png"


def edit_original(app_id: str, token: str, *, content: str, png: bytes | None = None,
                  filename: str | None = None, components: list | None = None, client=None) -> bool:
    """PATCH the deferred reply (or, for a button click, the message the button
    is on). With `png`, multipart (payload_json + files[0]); without, JSON.
    `components` = the button rows to show under it; None leaves the message's
    existing rows alone. Returns True on 2xx. Never raises."""
    url = f"{DISCORD_API}/webhooks/{app_id}/{token}/messages/@original"
    try:
        import httpx
        own = client is None
        c = client or httpx.Client(timeout=15.0)
        try:
            def _send(comps):
                payload: dict = {"content": content}
                if comps is not None:
                    payload["components"] = comps
                if png is not None:
                    payload["attachments"] = [{"id": 0, "filename": filename}]
                    return c.patch(url, data={"payload_json": json.dumps(payload)},
                                   files={"files[0]": (filename, png, "image/png")})
                return c.patch(url, json=payload)
            r = _send(components)
            if not r.is_success and components is not None and 400 <= r.status_code < 500:
                # Discord validates the whole control tree and refuses the edit as a
                # unit; the member would sit on "thinking..." forever. The chart is
                # the product - post it without the rows and say so.
                log.warning("[discord-chart] edit_original HTTP %s with components: %s - retrying without them",
                            r.status_code, r.text[:300])
                r = _send([])
                if r.is_success:
                    c.post(url.rsplit("/messages/", 1)[0],
                           json={"content": "Chart controls are unavailable on this one - re-run /chart to get them back.",
                                 "flags": EPHEMERAL})
        finally:
            if own:
                c.close()
        if not r.is_success:
            log.warning("[discord-chart] edit_original HTTP %s: %s", r.status_code, r.text[:200])
        return bool(r.is_success)
    except Exception as e:  # noqa: BLE001 — a background job must never raise
        log.warning("[discord-chart] edit_original failed: %s", e)
        return False


def run_chart_job(app_id: str, token: str, req: ChartRequest, *, bars_fn, render_fn, edit_fn,
                  house_fn=None, prefs=None, quote_fn=None, components_fn=None, context_fn=None) -> str:
    """Background job: cache → bars → PNG → edit the reply. Returns an outcome
    tag for logs/tests: ok | busy | no_bars | render_failed | error. Never raises.

    Order of work (fast paths first):
      1. a fresh cached PNG for (symbol, timeframe) is sent as-is;
      2. simultaneous requests for the same chart share ONE production;
      3. daily bars (stats + "does this symbol exist") → the house render
         (`house_fn(ticker, tf, stats) -> bytes | None`, the real /r/chart page);
      4. only if that yields nothing: the timeframe's bars → the mplfinance
         `render_fn`. An unknown symbol therefore never pays for a render."""
    label = TF_LABEL[req.tf]
    prefs = prefs or {}
    options = prefs_mod.render_options(prefs, req.tf)
    if req.to:
        options["to"] = req.to
    key = f"{req.ticker}:{req.tf}:{prefs_mod.style_signature(prefs)}" + (f":{req.to}" if req.to else "")
    # Buttons only when the caller wants them (the slash command and button
    # clicks do; older callers and tests keep the plain edit).
    extra = {"components": components_fn(req, prefs)} if components_fn is not None else {}
    headline = (req.display or req.ticker) + f" · {label}"

    def _context_follow_up():
        # The context line (next earnings, implied move, today's catalyst) is
        # edited in AFTER the image is up: a member never waits on a lookup for
        # the chart, and a failed lookup costs nothing but the line. A
        # content-only edit keeps the attachment and the controls (Discord
        # keeps what the payload omits). Breadth symbols have no earnings.
        if context_fn is None or req.breadth_name:
            return
        try:
            line = context_fn(req.ticker)
        except Exception as e:  # noqa: BLE001
            log.warning("[discord-chart] context line failed %s: %s", req.ticker, e)
            return
        if line:
            try:
                edit_fn(app_id, token, content=headline + "\n" + line)
            except Exception as e:  # noqa: BLE001
                log.warning("[discord-chart] context edit failed %s: %s", req.ticker, e)

    try:
        hit = png_cache.get(key)
        if hit:
            png, filename = hit
            edit_fn(app_id, token, content=headline, png=png, filename=filename, **extra)
            _context_follow_up()
            return "ok"

        def _fetch(tf, n):
            # One retry after a short pause: a cold intraday pull can miss once
            # (provider timeout, a fetch-on-miss still landing) and answer fine
            # a second later - two members hit "No bars" on a symbol the feed
            # served seconds after.
            for attempt in (0, 1):
                try:
                    bars = bars_fn(req.ticker, tf, n) or None
                except Exception as e:  # noqa: BLE001
                    log.warning("[discord-chart] bars failed %s %s: %s", req.ticker, tf, e)
                    bars = None
                if bars or attempt:
                    return bars
                time.sleep(BARS_RETRY_DELAY_S)
            return None

        def produce():
            if not RENDER_SLOTS.acquire(blocking=False):
                return ("busy", None, None)
            try:
                if req.tf == "D":
                    bars = daily = _fetch("D", bars_to_request("D"))
                    if not bars:
                        return ("no_bars", None, None)
                else:
                    bars = None
                    daily = _fetch("D", STATS_DAILY_BARS)
                png = None
                warm = None
                if house_fn is not None and daily:
                    if req.tf != "D":
                        warm = _fetch(req.tf, PAGE_BARS)   # pre-warm the page's fetch (see PAGE_BARS)
                    house_opts = dict(options)
                    if req.breadth_name:
                        house_opts["breadth"] = req.breadth_name
                    if quote_fn is not None:
                        # The live pre/post-market print -> the orange Pre/Post chip on the
                        # right axis (never a candle). Best-effort: no quote, no chip.
                        try:
                            house_opts["exttag"] = quote_fn(req.ticker) or None
                        except Exception as e:  # noqa: BLE001
                            log.warning("[discord-chart] ext quote failed %s: %s", req.ticker, e)
                    try:
                        png = house_fn(req.ticker, req.tf, compute_stats(daily), house_opts)
                    except Exception as e:  # noqa: BLE001
                        log.warning("[discord-chart] house render raised %s %s: %s", req.ticker, req.tf, e)
                        png = None
                    if png:
                        return ("ok", png, attachment_name(req.ticker, req.tf, daily[-1]["t"]))
                if bars is None:
                    bars = warm[-bars_to_request(req.tf):] if warm else _fetch(req.tf, bars_to_request(req.tf))
                    if not bars:
                        return ("no_bars", None, None)
                kw = {"daily_bars": daily if options["stats"] else None}
                if prefs.get("mas") == "off":
                    kw["show_mas"] = False
                if prefs.get("volume") is False:
                    kw["show_volume"] = False
                try:
                    png = render_fn(req.ticker, req.tf, bars, **kw)
                except Exception as e:  # noqa: BLE001
                    log.warning("[discord-chart] render failed %s %s: %s", req.ticker, req.tf, e)
                    return ("render_failed", None, None)
                return ("ok", png, attachment_name(req.ticker, req.tf, bars[-1]["t"]))
            finally:
                RENDER_SLOTS.release()

        result = png_cache.single_flight(
            key, produce, ttl_s=png_cache.ttl_for(req.tf),
            cache_value=lambda r: (r[1], r[2]) if r and r[0] == "ok" else None)
        outcome = result[0] if result else "render_failed"
        if outcome == "ok":
            edit_fn(app_id, token, content=headline, png=result[1], filename=result[2], **extra)
            _context_follow_up()
        elif outcome == "busy":
            edit_fn(app_id, token, content="Busy, try again in a few seconds.")
        elif outcome == "no_bars":
            edit_fn(app_id, token, content=(f"No bars for {req.ticker} ({label}). Unknown ticker, or the feed is "
                                            "still catching up on it - try again in a minute."))
        else:
            edit_fn(app_id, token, content="Chart failed, try again.")
        return outcome
    except Exception:  # noqa: BLE001
        log.exception("[discord-chart] job crashed %s %s", req.ticker, req.tf)
        return "error"
