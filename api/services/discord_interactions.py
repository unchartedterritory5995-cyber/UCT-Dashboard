"""Discord interaction plumbing for the /chart slash command. Pure helpers.

No FastAPI objects here. The router (api/routers/discord_interactions.py)
verifies + parses with these and schedules `run_chart_job`; the local tool
(tools/discord_chart_commands.py) registers `build_chart_command()`.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from dataclasses import dataclass

from api.services.discord_chart_render import (STATS_DAILY_BARS, TF_LABEL, WINDOW,
                                               bars_to_request, compute_stats, to_datetime)

log = logging.getLogger(__name__)

DISCORD_API = "https://discord.com/api/v10"
EPHEMERAL = 64  # message flag: only the invoking user sees it
_TICKER_RE = re.compile(r"^[A-Z0-9.^-]{1,12}$")

# Two renders at a time protects the API's event loop and memory; a third
# caller is told to retry rather than queue behind a cold Massive fetch.
RENDER_SLOTS = threading.BoundedSemaphore(2)


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


def parse_chart_command(interaction: dict) -> ChartRequest:
    data = interaction.get("data") or {}
    opts = {o.get("name"): o.get("value") for o in (data.get("options") or []) if isinstance(o, dict)}
    ticker = str(opts.get("ticker") or "").strip().upper().lstrip("$")
    if not _TICKER_RE.match(ticker):
        raise CommandError("Ticker must be 1-12 letters/digits (e.g. NVDA, BRK.B).")
    tf = str(opts.get("tf") or "D")
    if tf not in WINDOW:
        raise CommandError("Timeframe must be one of: " + ", ".join(TF_LABEL.values()) + ".")
    return ChartRequest(ticker=ticker, tf=tf)


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
                  house_fn=None) -> str:
    """Background job: bars → PNG → edit the reply. Returns an outcome tag for
    logs/tests: ok | busy | no_bars | render_failed | error. Never raises.

    `house_fn(ticker, tf, stats) -> bytes | None` is the house renderer (the
    real /r/chart page via chart-renderer); when it yields nothing the
    mplfinance `render_fn` draws the chart instead."""
    label = TF_LABEL[req.tf]
    if not RENDER_SLOTS.acquire(blocking=False):
        try:
            edit_fn(app_id, token, content="Busy, try again in a few seconds.")
        except Exception as e:  # noqa: BLE001
            log.warning("[discord-chart] busy-edit failed: %s", e)
        return "busy"
    try:
        try:
            bars = bars_fn(req.ticker, req.tf, bars_to_request(req.tf))
        except Exception as e:  # noqa: BLE001
            log.warning("[discord-chart] bars failed %s %s: %s", req.ticker, req.tf, e)
            bars = None
        if not bars:
            edit_fn(app_id, token, content=f"No bars for {req.ticker} ({label}).")
            return "no_bars"
        # The stats strip always reads DAILY bars. A daily chart already has
        # them; every other timeframe fetches a second, small daily series and
        # renders without the strip if that fetch fails.
        if req.tf == "D":
            daily = bars
        else:
            try:
                daily = bars_fn(req.ticker, "D", STATS_DAILY_BARS) or None
            except Exception as e:  # noqa: BLE001
                log.warning("[discord-chart] daily stats bars failed %s: %s", req.ticker, e)
                daily = None
        png = None
        if house_fn is not None:
            try:
                png = house_fn(req.ticker, req.tf, compute_stats(daily) if daily else {})
            except Exception as e:  # noqa: BLE001
                log.warning("[discord-chart] house render raised %s %s: %s", req.ticker, req.tf, e)
                png = None
        if not png:
            try:
                png = render_fn(req.ticker, req.tf, bars, daily_bars=daily)
            except Exception as e:  # noqa: BLE001
                log.warning("[discord-chart] render failed %s %s: %s", req.ticker, req.tf, e)
                edit_fn(app_id, token, content="Chart failed, try again.")
                return "render_failed"
        edit_fn(app_id, token, content=f"{req.ticker} · {label}", png=png,
                filename=attachment_name(req.ticker, req.tf, bars[-1]["t"]))
        return "ok"
    except Exception:  # noqa: BLE001
        log.exception("[discord-chart] job crashed %s %s", req.ticker, req.tf)
        return "error"
    finally:
        RENDER_SLOTS.release()
