"""POST /api/discord/interactions: HTTP endpoint for the /chart slash command.

Discord signs every interaction (Ed25519 over timestamp+body). The handler
verifies, answers within Discord's 3 s budget, and hands the slow part (bars,
render, upload) to a background task. Public key unset ⇒ 503: the endpoint is
dark rather than trusting anything unsigned.
"""
from __future__ import annotations

import dataclasses
import json
import logging
import os

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse

from api.services import discord_chart_house as house
from api.services import discord_chart_prefs as prefs_mod
from api.services import discord_interactions as di
from api.services.discord_chart_render import render_chart_png

router = APIRouter()
log = logging.getLogger(__name__)


def _public_key() -> str:
    return (os.environ.get("DISCORD_CHART_PUBLIC_KEY") or "").strip()


def fetch_bars(ticker: str, tf: str, n: int) -> list[dict] | None:
    """The one bars adapter: calls the /api/bars router function in-process so
    index/breadth/delisted/yf-only routing and fetch-on-miss all apply. Every
    parameter is passed explicitly because the function's Query(...) defaults
    only resolve over HTTP. Only a 200 with a non-empty `bars` list counts."""
    from api.routers import bars as bars_router
    resp = bars_router.get_bars(ticker, tf, n, "", "", 0)
    if getattr(resp, "status_code", 200) != 200:
        return None
    body = getattr(resp, "body", b"") or b""
    try:
        payload = json.loads(body)
    except ValueError:
        return None
    bars = payload.get("bars") or []
    return bars or None


EXT_SESSION_WORD = {"pre_market": "pre", "post_market": "post", "pre": "pre", "post": "post"}


def fetch_ext_quote(ticker: str):
    """('pre'|'post', price) when the live feed flags an extended-hours print
    for the symbol, else None. Same source as the Charts widget's Pre/Post tag
    (massive.get_batch_rich_snapshots -> _ext_price_for, stale-lastTrade aware).
    Never raises; a missing quote just means no chip."""
    try:
        from api.services import massive
        row = massive._get_client().get_batch_rich_snapshots([ticker]).get(ticker.upper()) or {}
        # massive._detect_session() speaks 'pre_market' / 'post_market' / 'regular'
        # and _ext_price_for echoes that word back as ext_session; the page's chip
        # wants the widget's 'pre' / 'post'. Map, never compare the raw word.
        sess = EXT_SESSION_WORD.get(str(row.get("ext_session") or ""))
        px = row.get("ext_price")
        if sess and isinstance(px, (int, float)) and px > 0:
            return (sess, float(px))
    except Exception as e:  # noqa: BLE001
        log.warning("[discord-chart] ext quote lookup failed %s: %s", ticker, e)
    return None


def fetch_ticker_choices(q: str, limit: int = 10) -> list[dict]:
    """Autocomplete choices from the dashboard's own ticker search (exact >
    prefix > substring over cap_universe, names from the meta cache). Called
    in-process; every arg passed explicitly because the route's Query defaults
    only resolve over HTTP. Never raises - no choices is a valid answer."""
    try:
        from api.routers import ticker_search as ts
        rows = (ts.ticker_search(q=q, limit=limit) or {}).get("results") or []
        out = []
        for row in rows:
            t = str(row.get("ticker") or "")
            if not t:
                continue
            name = row.get("name")
            out.append({"name": (f"{t} - {name}" if name else t)[:100], "value": t})
        return out[:25]
    except Exception as e:  # noqa: BLE001
        log.warning("[discord-chart] ticker autocomplete failed %r: %s", q, e)
        return []


def breadth_adjust(req, prefs: dict):
    """UCTA5 / UCTNH / … are the dashboard's breadth pseudo-tickers: a daily-basis
    series built from the breadth monitor (the bars authority collapses an
    intraday request to daily silently). Make that explicit for the member:
    daily or weekly only, the metric's name in the reply, and no stats strip or
    pre/post treatment (volume, RVOL, gap and ADR are meaningless for a
    percentage). Anything else passes through untouched."""
    try:
        from api.services import breadth_symbols as bs
        if not bs.is_breadth_symbol(req.ticker):
            return req, prefs
        meta = bs.SYMBOLS.get(req.ticker.upper()) or {}
        name = meta.get("name") or ""
        req = dataclasses.replace(req, tf="W" if req.tf == "W" else "D", daily_only=True,
                                  display=f"{req.ticker} · {name}" if name else req.ticker)
        return req, {**prefs, "stats": False, "ext": False, "volume": False}   # a % series has no volume
    except Exception as e:  # noqa: BLE001
        log.warning("[discord-chart] breadth check failed %s: %s", getattr(req, "ticker", "?"), e)
        return req, prefs


def _autocomplete(choices: list) -> dict:
    return {"type": 8, "data": {"choices": choices}}


def _ephemeral(message: str) -> dict:
    return {"type": 4, "data": {"content": message, "flags": di.EPHEMERAL}}


@router.post("/api/discord/interactions")
async def discord_interactions(request: Request, background: BackgroundTasks):
    key = _public_key()
    if not key:
        return JSONResponse(status_code=503, content={"error": "discord interactions not configured"})
    body = await request.body()
    sig = request.headers.get("X-Signature-Ed25519", "")
    ts = request.headers.get("X-Signature-Timestamp", "")
    if not sig or not ts or not di.verify_signature(key, sig, ts, body):
        return JSONResponse(status_code=401, content={"error": "invalid request signature"})
    try:
        interaction = json.loads(body)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "malformed body"})
    if not isinstance(interaction, dict):
        return JSONResponse(status_code=400, content={"error": "malformed body"})

    itype = interaction.get("type")
    if itype == 1:
        return {"type": 1}
    if not di.guild_allowed(interaction):
        log.warning("discord interaction refused: guild=%s context=%s owners=%s",
                    interaction.get("guild_id"), interaction.get("context"),
                    interaction.get("authorizing_integration_owners"))
        # An autocomplete interaction may ONLY be answered with choices (type 8).
        return _autocomplete([]) if itype == 4 else _ephemeral(di.NOT_ALLOWED_MESSAGE)
    name = (interaction.get("data") or {}).get("name")
    if itype == 4:
        if name not in di.CHART_COMMAND_NAMES:
            return _autocomplete([])
        q = di.parse_autocomplete(interaction)
        return _autocomplete(fetch_ticker_choices(q) if q else [])
    if (itype == 2 and name in di.CHART_COMMAND_NAMES) or itype == 3:
        uid = di.interaction_user_id(interaction)
        prefs = _prefs_for(uid)
        try:
            if itype == 3:
                req = di.parse_component(interaction)          # a button under a chart
            else:
                req = di.parse_chart_command(interaction, default_tf=prefs.get("tf", "D"))
        except di.CommandError as e:
            return _ephemeral(str(e))
        wait = di.user_rate_check(uid)
        if wait:
            return _ephemeral(di.throttle_message(wait))
        prefs = {**prefs, **req.overrides()}   # this call only; saved settings untouched
        req, prefs = breadth_adjust(req, prefs)
        app_id = str(interaction.get("application_id") or os.environ.get("DISCORD_CHART_APP_ID") or "")
        token = str(interaction.get("token") or "")
        if not app_id or not token:
            return _ephemeral("Discord did not supply a reply token.")
        background.add_task(di.run_chart_job, app_id, token, req,
                            bars_fn=fetch_bars, render_fn=render_chart_png, edit_fn=di.edit_original,
                            house_fn=house.render_house_chart if house.house_enabled() else None,
                            prefs=prefs, quote_fn=fetch_ext_quote, components_fn=di.chart_components)
        # A button click updates the message it sits on (no loading state, no new
        # message); a slash command gets the deferred "thinking..." reply.
        return {"type": 6} if itype == 3 else {"type": 5}
    if itype == 2 and name == di.SETTINGS_COMMAND:
        return _ephemeral(_settings_reply(interaction))
    return _ephemeral("Unknown command.")


def _prefs_for(uid: str) -> dict:
    """A member's saved /chart preferences; the defaults if unknown or the store misbehaves."""
    if not uid:
        return dict(prefs_mod.DEFAULTS)
    try:
        return prefs_mod.get_prefs(uid)
    except Exception as e:  # noqa: BLE001
        log.warning("[discord-chart] prefs read failed for %s: %s", uid, e)
        return dict(prefs_mod.DEFAULTS)


def _settings_reply(interaction: dict) -> str:
    uid = di.interaction_user_id(interaction)
    if not uid:
        return "Could not tell who you are; try again from a server channel."
    try:
        sub, changes = di.parse_settings_command(interaction)
    except di.CommandError as e:
        return str(e)
    try:
        if sub == "show":
            return "Your /chart settings: " + prefs_mod.describe(prefs_mod.get_prefs(uid))
        if sub == "reset":
            return "Reset to defaults: " + prefs_mod.describe(prefs_mod.reset_prefs(uid))
        return "Saved: " + prefs_mod.describe(prefs_mod.set_prefs(uid, **changes))
    except ValueError as e:
        return f"Not saved: {e}"
    except Exception as e:  # noqa: BLE001
        log.warning("[discord-chart] settings failed for %s: %s", uid, e)
        return "Settings are unavailable right now, try again in a minute."
