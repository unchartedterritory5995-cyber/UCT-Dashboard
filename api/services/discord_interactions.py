"""Discord interaction plumbing for the /chart slash command. Pure helpers.

No FastAPI objects here. The router (api/routers/discord_interactions.py)
verifies + parses with these and schedules `run_chart_job`; the local tool
(tools/discord_chart_commands.py) registers `build_chart_command()`.
"""
from __future__ import annotations

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

    def overrides(self) -> dict:
        """The prefs this one call overrides (member request: "/chart APP
        without MAs or volume" without touching saved settings)."""
        return {k: v for k, v in (("mas", self.mas), ("volume", self.volume),
                                  ("style", self.style), ("theme", self.theme)) if v is not None}


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
BUTTON_TFS = (("D", "D"), ("W", "W"), ("60", "60m"), ("15", "15m"), ("5", "5m"))
_STYLE_PRIMARY, _STYLE_SECONDARY, _STYLE_LINK = 1, 2, 5


def public_site_url() -> str:
    return (os.environ.get("CHART_RENDER_BASE_URL") or "https://uctintelligence.com").rstrip("/")


def component_id(ticker: str, tf: str, mas: str, volume: bool) -> str:
    return f"{COMPONENT_PREFIX}|{ticker}|{tf}|{mas}|{1 if volume else 0}"


def parse_component(interaction: dict) -> ChartRequest:
    """A button click -> the chart it asks for. Only our own custom_ids parse;
    anything else is a CommandError (an unknown button is not a chart)."""
    cid = str(((interaction.get("data") or {}).get("custom_id")) or "")
    parts = cid.split("|")
    if len(parts) != 5 or parts[0] != COMPONENT_PREFIX:
        raise CommandError("Unknown button.")
    _, ticker, tf, mas, vol = parts
    ticker = ticker.strip().upper()
    if not _TICKER_RE.match(ticker) or tf not in WINDOW or mas not in prefs_mod.MA_CHOICES or vol not in ("0", "1"):
        raise CommandError("Unknown button.")
    return ChartRequest(ticker=ticker, tf=tf, mas=mas, volume=(vol == "1"))


def chart_components(req: ChartRequest, prefs: dict | None = None) -> list:
    """The two action rows under a chart, reflecting what THIS image shows."""
    p = {**prefs_mod.DEFAULTS, **(prefs or {})}
    mas = req.mas if req.mas is not None else p["mas"]
    vol = req.volume if req.volume is not None else bool(p["volume"])
    tfs = [{"type": 2, "style": _STYLE_PRIMARY if tf == req.tf else _STYLE_SECONDARY, "label": label,
            "custom_id": component_id(req.ticker, tf, mas, vol)} for tf, label in BUTTON_TFS]
    toggles = [
        {"type": 2, "style": _STYLE_SECONDARY, "label": "MAs off" if mas != "off" else "MAs on",
         "custom_id": component_id(req.ticker, req.tf, "off" if mas != "off" else "house", vol)},
        {"type": 2, "style": _STYLE_SECONDARY, "label": "Volume off" if vol else "Volume on",
         "custom_id": component_id(req.ticker, req.tf, mas, not vol)},
        {"type": 2, "style": _STYLE_LINK, "label": "Open interactive \u2197",
         "url": f"{public_site_url()}/research/{req.ticker}"},
    ]
    return [{"type": 1, "components": tfs}, {"type": 1, "components": toggles}]


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


def build_commands() -> list:
    """Every application command this bot registers (one authority)."""
    return [dict(c, **GUILD_ONLY) for c in (build_chart_command(), build_alias_command(), build_settings_command())]


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
            payload: dict = {"content": content}
            if components is not None:
                payload["components"] = components
            if png is not None:
                payload["attachments"] = [{"id": 0, "filename": filename}]
                r = c.patch(url, data={"payload_json": json.dumps(payload)},
                            files={"files[0]": (filename, png, "image/png")})
            else:
                r = c.patch(url, json=payload)
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
                  house_fn=None, prefs=None, quote_fn=None, components_fn=None) -> str:
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
    options = prefs_mod.render_options(prefs)
    key = f"{req.ticker}:{req.tf}:{prefs_mod.style_signature(prefs)}"
    # Buttons only when the caller wants them (the slash command and button
    # clicks do; older callers and tests keep the plain edit).
    extra = {"components": components_fn(req, prefs)} if components_fn is not None else {}
    try:
        hit = png_cache.get(key)
        if hit:
            png, filename = hit
            edit_fn(app_id, token, content=f"{req.ticker} · {label}", png=png, filename=filename, **extra)
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
            edit_fn(app_id, token, content=f"{req.ticker} · {label}", png=result[1], filename=result[2], **extra)
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
