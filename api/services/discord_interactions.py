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


class CommandError(ValueError):
    """User-facing validation failure; str(exc) is the ephemeral reply."""


@dataclass(frozen=True)
class ChartRequest:
    ticker: str
    tf: str


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
    return ChartRequest(ticker=ticker, tf=tf)


CHART_COMMAND_NAMES = ("chart", "c")
SETTINGS_COMMAND = "chartsettings"


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
        raise CommandError("Nothing to set. Pick at least one option (tf, mas, volume, ext, stats).")
    return "set", changes


def build_chart_command() -> dict:
    """The application-command payload Discord receives at registration."""
    return {
        "name": "chart",
        "type": 1,  # CHAT_INPUT
        "description": "Render a clean chart: candles, volume, 10/20/50 SMA",
        "options": [
            {"name": "ticker", "description": "Ticker symbol, e.g. NVDA", "type": 3, "required": True},
            {"name": "tf", "description": "Timeframe (default Daily)", "type": 3, "required": False,
             "choices": [{"name": label, "value": value} for value, label in TF_LABEL.items()]},
        ],
    }


def build_alias_command() -> dict:
    """`/c` - the same command under a two-keystroke name (member request)."""
    cmd = build_chart_command()
    return {**cmd, "name": "c", "description": "Chart, short form: /c NVDA"}


def build_settings_command() -> dict:
    """`/chartsettings show|set|reset` - per-user defaults for /chart."""
    tf_choices = [{"name": label, "value": value} for value, label in TF_LABEL.items()]
    ma_choices = [{"name": label, "value": value} for value, label in prefs_mod.MA_CHOICES.items()]
    return {
        "name": SETTINGS_COMMAND, "type": 1,
        "description": "Your personal /chart defaults (timeframe, moving averages, volume, pre/post-market, stats)",
        "options": [
            {"name": "show", "type": 1, "description": "Show your current /chart settings"},
            {"name": "set", "type": 1, "description": "Change one or more settings", "options": [
                {"name": "tf", "type": 3, "required": False, "description": "Default timeframe", "choices": tf_choices},
                {"name": "mas", "type": 3, "required": False, "description": "Moving averages", "choices": ma_choices},
                {"name": "volume", "type": 5, "required": False, "description": "Show the volume pane"},
                {"name": "ext", "type": 5, "required": False, "description": "Pre/post-market candles on intraday charts"},
                {"name": "stats", "type": 5, "required": False, "description": "Show the stats strip (OHLC, gap, 52w, RVOL, ADR)"},
            ]},
            {"name": "reset", "type": 1, "description": "Back to the defaults"},
        ],
    }


def build_commands() -> list:
    """Every application command this bot registers (one authority)."""
    return [build_chart_command(), build_alias_command(), build_settings_command()]


def attachment_name(ticker: str, tf: str, last_t) -> str:
    """TICKER_TF_YYYY-MM-DD_Chart.png, the house chart naming convention."""
    safe = re.sub(r"[^A-Z0-9]", "", ticker.upper())
    tf_tag = tf if tf in ("D", "W") else f"{tf}m"
    return f"{safe}_{tf_tag}_{to_datetime(last_t, tf).strftime('%Y-%m-%d')}_Chart.png"


def edit_original(app_id: str, token: str, *, content: str, png: bytes | None = None,
                  filename: str | None = None, client=None) -> bool:
    """PATCH the deferred reply. With `png`, multipart (payload_json + files[0]);
    without, JSON. Returns True on 2xx. Never raises."""
    url = f"{DISCORD_API}/webhooks/{app_id}/{token}/messages/@original"
    try:
        import httpx
        own = client is None
        c = client or httpx.Client(timeout=15.0)
        try:
            if png is not None:
                payload = {"content": content, "attachments": [{"id": 0, "filename": filename}]}
                r = c.patch(url, data={"payload_json": json.dumps(payload)},
                            files={"files[0]": (filename, png, "image/png")})
            else:
                r = c.patch(url, json={"content": content})
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
                  house_fn=None, prefs=None) -> str:
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
    try:
        hit = png_cache.get(key)
        if hit:
            png, filename = hit
            edit_fn(app_id, token, content=f"{req.ticker} · {label}", png=png, filename=filename)
            return "ok"

        def _fetch(tf, n):
            try:
                return bars_fn(req.ticker, tf, n) or None
            except Exception as e:  # noqa: BLE001
                log.warning("[discord-chart] bars failed %s %s: %s", req.ticker, tf, e)
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
                if house_fn is not None and daily:
                    try:
                        png = house_fn(req.ticker, req.tf, compute_stats(daily), options)
                    except Exception as e:  # noqa: BLE001
                        log.warning("[discord-chart] house render raised %s %s: %s", req.ticker, req.tf, e)
                        png = None
                    if png:
                        return ("ok", png, attachment_name(req.ticker, req.tf, daily[-1]["t"]))
                if bars is None:
                    bars = _fetch(req.tf, bars_to_request(req.tf))
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
            edit_fn(app_id, token, content=f"{req.ticker} · {label}", png=result[1], filename=result[2])
        elif outcome == "busy":
            edit_fn(app_id, token, content="Busy, try again in a few seconds.")
        elif outcome == "no_bars":
            edit_fn(app_id, token, content=f"No bars for {req.ticker} ({label}).")
        else:
            edit_fn(app_id, token, content="Chart failed, try again.")
        return outcome
    except Exception:  # noqa: BLE001
        log.exception("[discord-chart] job crashed %s %s", req.ticker, req.tf)
        return "error"
