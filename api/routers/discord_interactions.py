"""POST /api/discord/interactions: HTTP endpoint for the /chart slash command.

Discord signs every interaction (Ed25519 over timestamp+body). The handler
verifies, answers within Discord's 3 s budget, and hands the slow part (bars,
render, upload) to a background task. Public key unset ⇒ 503: the endpoint is
dark rather than trusting anything unsigned.
"""
from __future__ import annotations

import dataclasses
import functools
import json
import logging
import os

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from api.services import discord_activity_handoff as handoff
from api.services import discord_chart_context as chart_context
from api.services import discord_chart_house as house
from api.services import discord_chart_prefs as prefs_mod
from api.services import discord_interactions as di
from api.services.discord_chart_render import compute_stats, render_chart_png

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
    # serve_bars = the LOCAL serve core (get_bars is now an async route with a proxy
    # path; in-process callers must hit the core directly, not the proxy).
    resp = bars_router.serve_bars(ticker, tf, n, "", "", 0)
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
        # `type` MUST be passed: ticker_search's signature is (q, limit, type) with a
        # Query() default for `type`, which only resolves over HTTP. Called in-process
        # without it, `type` stays a Query object → AttributeError inside the route →
        # this whole function returned [] (no suggestions on /flow OR /chart).
        rows = (ts.ticker_search(q=q, limit=limit, type="") or {}).get("results") or []
        out = []
        # Breadth reads as a chart (`/chart UCTA5`) and nothing ever told anyone
        # so — the autocomplete is where a member would find out.
        try:
            from api.services import breadth_symbols as bs
            needle = (q or "").strip().upper()
            for symbol, meta in (bs.SYMBOLS or {}).items():
                nm = str((meta or {}).get("name") or "")
                if needle and (symbol.startswith(needle) or needle in nm.upper() or needle in ("BREADTH", "UCT")):
                    out.append({"name": f"{symbol} - {nm}"[:100] if nm else symbol, "value": symbol})
                if len(out) >= 5:
                    break
        except Exception as e:  # noqa: BLE001 — breadth is a bonus, never the reason autocomplete fails
            log.debug("[discord-chart] breadth autocomplete skipped: %s", e)
        for row in rows:
            t = str(row.get("ticker") or "")
            if not t:
                continue
            name = row.get("name")
            out.append({"name": (f"{t} - {name}" if name else t)[:100], "value": t})
        # ⭐ THE UNIVERSE IS A SUGGESTION LIST, NOT A GATE. `cap_universe.json`
        # holds the ~3,685 names over $300M, and the chart path never consults
        # it - measured 2026-08-26, AEHL, TCEHY, FNMA, BTC-USD, ^IXIC and BRK.B
        # all render perfectly and NONE of them are in it. But the autocomplete
        # answered "no options match", which reads to a member as "this bot does
        # not know that ticker", so they never press Enter on a chart that would
        # have worked. Offer what they typed back to them; the dashboard's own
        # SymbolSearch has carried the same "Go to {TICKER}" fallback for months.
        #
        # ⛔ ONLY when nothing matched. A member typing "NV" on their way to NVDA
        # must not be offered "NV - chart it" as though it were a ticker; the
        # complaint being fixed is the EMPTY list, not a short one.
        typed = (q or "").strip().upper().lstrip("$")
        if not out and typed and di._TICKER_RE.match(typed):
            out.append({"name": f"{typed} - chart it"[:100], "value": typed})
        return out[:25]
    except Exception as e:  # noqa: BLE001
        log.warning("[discord-chart] ticker autocomplete failed %r: %s", q, e)
        return []


def buzz_ticker_choices(q: str, limit: int = 25) -> list[dict]:
    """Autocomplete from what the room ACTUALLY said, not from cap_universe.
    v20's lesson: a picker whose silence is indistinguishable from a refusal
    reads as a refusal. Here every suggestion is a name with real counts."""
    from api.services import buzz_store
    try:
        return [{"name": f"{t} — {n} mention(s)", "value": t}
                for t, n in buzz_store.known_tickers(q or "", limit=limit)]
    except Exception as e:  # noqa: BLE001
        log.warning("[buzz] ticker autocomplete failed %r: %s", q, e)
        return []


def run_buzz_image_job(app_id: str, token: str, content: str, window: str, *, render_fn=None, edit_fn=None) -> None:
    """Background job for a ticker-less /buzz: render the board PNG and PATCH
    it onto the deferred reply -- mirroring `di.run_chart_job`'s cache/render/
    edit shape, simplified (no cache, no retry): a failed or empty render just
    leaves the text-only reply, never an apology. `edit_original` already
    re-declares `attachments` on the image path, so the PATCH cannot drop the
    file the way `desk_session_announce._edit` once did."""
    from api.services import buzz_image
    render = render_fn or buzz_image.render_board_png
    edit = edit_fn or di.edit_original
    try:
        png = render(window)
    except Exception as e:  # noqa: BLE001 — a background job must never raise
        log.warning("[buzz] image render failed: %s", e)
        png = None
    if png:
        edit(app_id, token, content=content, png=png, filename="buzz.png")
    else:
        edit(app_id, token, content=content)


def _flow_fmt_m(v) -> str:
    v = float(v or 0)
    if v >= 1e9:
        return f"${v / 1e9:.1f}B"
    if v >= 1e6:
        return f"${v / 1e6:.1f}M"
    return f"${v / 1e3:.0f}K"


def _flow_window_phrase(w: dict) -> str:
    req = str((w or {}).get("days_requested") or "").lower()
    if req == "all":
        return "all history"
    return f"last {req} trading days" if req and req != "1" else "today"


def _post_image_webhook(webhook: str, png: bytes, content: str, filename: str) -> tuple[bool, str]:
    """POST a PNG to a Discord webhook (public, in the webhook's channel). No
    username override → the message uses the webhook's own name + avatar. Returns
    (ok, detail); never raises."""
    try:
        import httpx
        payload = {"content": content[:1900], "allowed_mentions": {"parse": []}}
        r = httpx.post(webhook, data={"payload_json": json.dumps(payload)},
                       files={"files[0]": (filename, png, "image/png")}, timeout=20.0)
        return (r.is_success, f"discord {r.status_code}")
    except Exception as e:  # noqa: BLE001
        return (False, f"post error: {e}")


def run_flow_card_job(app_id: str, token: str, ticker: str, days: str,
                      *, fetch_fn=None, render_fn=None, edit_fn=None, post_fn=None) -> None:
    """Background job for /flow. Fetch the ticker's flow summary from the
    FLOW-WORKER (which owns flow.db), render the card, and POST it PUBLICLY to the
    channel via FLOW_CMD_WEBHOOK_URL (the bot has no post rights in that channel —
    the webhook does). The interaction reply is the requester's PRIVATE ack, edited
    to a confirmation / honest error. Never raises (a background job must not); an
    empty or errored read stays private (no false zero in the public channel)."""
    from api.flow_ticker_card import render_ticker_flow_card
    render = render_fn or render_ticker_flow_card
    ack = edit_fn or di.edit_original            # edits the EPHEMERAL ack (requester-only)
    post = post_fn or _post_image_webhook        # posts the PUBLIC card to the channel
    data = None
    try:
        if fetch_fn is not None:
            data = fetch_fn(ticker, days)
        else:
            base = (os.environ.get("WORKER_INTERNAL_URL") or "").rstrip("/")
            if base:
                import httpx
                r = httpx.get(f"{base}/api/live/massive/ticker-flow",
                              params={"symbol": ticker, "days": days, "source": "stocks"},
                              timeout=30.0)
                data = r.json() if r.is_success else None
            else:
                from api import live_massive_router as lmr   # single-service fallback
                data = lmr._compute_ticker_flow(ticker, days, "stocks", 15)
    except Exception as e:  # noqa: BLE001 — a background job must never raise
        log.warning("[flow] fetch failed %s (%s): %s", ticker, days, e)
        data = None

    if not data or not data.get("ok"):
        ack(app_id, token,
            content=f"⚠️ The flow feed is reconnecting — couldn't read **{ticker}** right now. Try again in a moment.")
        return
    win = _flow_window_phrase(data.get("window") or {})
    if not (data.get("contracts") or []):
        ack(app_id, token, content=f"**{ticker}** — no significant options flow {win}.")
        return
    net = data.get("net") or {}
    _nd = (net.get("bull") or 0) - (net.get("bear") or 0)
    try:
        png = render(data)
    except Exception as e:  # noqa: BLE001
        log.warning("[flow] render failed %s: %s", ticker, e)
        ack(app_id, token, content="Couldn't render the card — try again in a moment.")
        return
    # IMAGE-ONLY post — the card already carries the ticker, window and net read, so a
    # message-text line above it is redundant (owner 2026-09-06; same call as the EOD
    # Top Flow card). The requester still gets a private net summary in the ack below.
    webhook = (os.environ.get("FLOW_CMD_WEBHOOK_URL") or "").strip()
    if not webhook:
        di.edit_original(app_id, token, content="", png=png, filename=f"{ticker}_flow.png")   # dev fallback
        return
    ok, detail = post(webhook, png, "", f"{ticker}_flow.png")
    if ok:
        ack(app_id, token, content=(f"✓ Posted **{ticker}** flow — net **{net.get('dir', '')}** "
                                    f"{'+' if _nd >= 0 else '−'}{_flow_fmt_m(abs(_nd))} · {win}"))
    else:
        log.warning("[flow] webhook post failed %s: %s", ticker, detail)
        ack(app_id, token, content=f"Couldn't post the card right now ({detail}). Try again in a moment.")


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
                                  display=f"{req.ticker} · {name}" if name else req.ticker,
                                  breadth_name=name or req.ticker)
        out = {**prefs, "stats": False, "ext": False}
        # The app's Charts widget draws breadth as a LINE (ChartPane's breadth
        # Line/Candles toggle, the owner's setting) - a percentage reads as a line,
        # not as candles. A member who asks for a style explicitly still gets it.
        if req.style is None:
            out["style"] = "line"
        return req, out
    except Exception as e:  # noqa: BLE001
        log.warning("[discord-chart] breadth check failed %s: %s", getattr(req, "ticker", "?"), e)
        return req, prefs


def _autocomplete(choices: list) -> dict:
    return {"type": 8, "data": {"choices": choices}}


def _ephemeral(message: str) -> dict:
    return {"type": 4, "data": {"content": message, "flags": di.EPHEMERAL}}


def _channel_nudge() -> dict:
    """Private redirect when /chart or /flow is run outside the allowed channel."""
    want = di.cmd_channel_id()
    return _ephemeral(f"Please use <#{want}> for chart & flow requests." if want
                      else "Not available in this channel.")


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
        if name == di.BUZZ_COMMAND:
            # Backed by what the room ACTUALLY said, so an empty query is still
            # useful: it offers the most-mentioned names.
            return _autocomplete(buzz_ticker_choices(di.parse_autocomplete(interaction)))
        if name == di.FLOW_COMMAND:
            fname, fval = di.focused_option(interaction)
            if fname == "days":                     # suggest day-window presets
                return _autocomplete(di.flow_days_choices(fval))
            q = (fval or "").strip().upper().lstrip("$")[:10]   # ticker field
            return _autocomplete(fetch_ticker_choices(q) if q else [])
        if name not in di.CHART_COMMAND_NAMES:
            return _autocomplete([])
        q = di.parse_autocomplete(interaction)
        return _autocomplete(fetch_ticker_choices(q) if q else [])
    if itype == 2 and name == di.LAUNCH_COMMAND:
        # The Entry Point command (App Launcher). The Activity page reads the
        # channel's newest handoff itself; nothing to record here.
        return {"type": 12}
    if itype == 2 and name == di.MULTI_COMMAND:
        if not di.cmd_channel_ok(interaction):     # /charts restricted to the channel
            return _channel_nudge()
        uid = di.interaction_user_id(interaction)
        prefs = _prefs_for(uid)
        try:
            reqs = di.parse_charts_command(interaction, default_tf=prefs.get("tf", "D"))
        except di.CommandError as e:
            return _ephemeral(str(e))
        for _ in reqs:                                   # each chart counts against the member's rate
            wait = di.user_rate_check(uid)
            if wait:
                return _ephemeral(di.throttle_message(wait))
        items = [breadth_adjust(req, dict(prefs)) for req in reqs]
        app_id = str(interaction.get("application_id") or os.environ.get("DISCORD_CHART_APP_ID") or "")
        token = str(interaction.get("token") or "")
        if not app_id or not token:
            return _ephemeral("Discord did not supply a reply token.")
        background.add_task(di.run_multi_chart_job, app_id, token, items,
                            bars_fn=fetch_bars, render_fn=render_chart_png, edit_fn=di.edit_original,
                            house_fn=house.render_house_chart if house.house_enabled() else None,
                            quote_fn=fetch_ext_quote, components_fn=di.multi_components)
        return {"type": 5}
    if itype == 2 and name == di.BUZZ_COMMAND:
        import time as _t
        from api.services import buzz_image, buzz_reply
        # ⛔ ON-DEMAND /buzz IS EPHEMERAL AND THROTTLED; the SCHEDULED post is
        # neither. Owner ruling 2026-09-02. The two are different doors on
        # purpose: the room gets the shared board seven times a session, and a
        # member checking it in between does not put a second copy in front of
        # 750 people. Nothing here can reach the scheduled path -- that one
        # posts through discord_buzz_digest._post_as_bot (POST /channels/{id}/
        # messages with the bot token), where message flags do not even apply.
        #
        # The budget is SHARED with /chart rather than given its own: both end
        # up on the same 4-slot render valve, so one per-member budget is the
        # honest model. 12/minute (DISCORD_CHART_USER_RATE) is far above real
        # use -- this bounds a member pinning a render slot in a loop, not
        # anyone's normal reading.
        uid = di.interaction_user_id(interaction)
        wait = di.user_rate_check(uid)
        if wait:
            return _ephemeral(di.throttle_message(wait, noun="boards"))
        opts = {o["name"]: o.get("value") for o in
                ((interaction.get("data") or {}).get("options") or [])}
        window = (opts.get("window") or "open").strip()
        ticker = (opts.get("ticker") or "").strip().upper()
        now = int(_t.time())
        try:
            # ⛔ OFF THE EVENT LOOP. This handler is `async def`, and both
            # builders do synchronous SQLite -- measured 8.5ms for
            # build_board_text on a 36.6k-row store, growing with the number of
            # tickers clearing MIN_CURRENT. Blocking the ONE shared loop on a
            # single-process pod is the 2026-07-01 root cause by name, and
            # every other heavy path in this file already defers. Cheap today;
            # the point is that it cannot get expensive quietly.
            text = await run_in_threadpool(
                (lambda: buzz_reply.build_ticker_text(ticker, window, now)) if ticker
                else (lambda: buzz_reply.build_board_text(now, window)))
        except Exception as e:  # noqa: BLE001
            logging.getLogger(__name__).warning("[buzz] reply failed: %s", e)
            return _ephemeral("Could not read the counts right now.")
        # No ticker = the board reply, which is worth an image. A ticker
        # narrows to one name's numbers -- that stays the immediate text
        # reply it always was (unchanged behaviour, no wait on a render).
        if not ticker and buzz_image.image_enabled():
            app_id = str(interaction.get("application_id") or os.environ.get("DISCORD_CHART_APP_ID") or "")
            token = str(interaction.get("token") or "")
            if app_id and token:
                background.add_task(run_buzz_image_job, app_id, token, text, window)
                # ⛔ THE FLAG GOES ON THE DEFER, NOT THE FOLLOW-UP. Discord fixes
                # a deferred reply's visibility at type 5; setting flags later on
                # the PATCH is silently ignored and the board lands PUBLICLY.
                # run_buzz_image_job edits via `edit_original`
                # (PATCH /webhooks/{app}/{token}/messages/@original), which keeps
                # whatever this response declared.
                return {"type": 5, "data": {"flags": di.EPHEMERAL}}
        return {"type": 4, "data": {"content": text, "flags": di.EPHEMERAL}}
    if itype == 2 and name == di.FLOW_COMMAND:
        # /flow <ticker> <days> — a PUBLIC options-flow card, gated to one channel
        # (owner decision). Refused elsewhere with a pointer to that channel.
        if not di.cmd_channel_ok(interaction):
            return _channel_nudge()
        uid = di.interaction_user_id(interaction)
        wait = di.user_rate_check(uid)   # shares the /chart render budget (one valve)
        if wait:
            return _ephemeral(di.throttle_message(wait, noun="flow cards"))
        try:
            tkr, days = di.parse_flow_command(interaction)
        except di.CommandError as e:
            return _ephemeral(str(e))
        app_id = str(interaction.get("application_id") or os.environ.get("DISCORD_CHART_APP_ID") or "")
        token = str(interaction.get("token") or "")
        if not app_id or not token:
            return _ephemeral("Discord did not supply a reply token.")
        background.add_task(run_flow_card_job, app_id, token, tkr, days)
        # EPHEMERAL defer: the requester gets a private "thinking…" that resolves to a
        # confirmation; the PUBLIC card is posted to the channel via FLOW_CMD_WEBHOOK_URL
        # (the bot has no post rights in that channel). Flags go on the DEFER, not the
        # follow-up (Discord fixes visibility at defer time).
        return {"type": 5, "data": {"flags": di.EPHEMERAL}}
    if (itype == 2 and name in di.CHART_COMMAND_NAMES) or itype == 3:
        # Gate the SLASH invocation to the channel (owner). NOT component clicks
        # (itype 3) — buttons under an already-posted chart must keep working.
        if itype == 2 and not di.cmd_channel_ok(interaction):
            return _channel_nudge()
        uid = di.interaction_user_id(interaction)
        prefs = _prefs_for(uid)
        app_id = str(interaction.get("application_id") or os.environ.get("DISCORD_CHART_APP_ID") or "")
        token = str(interaction.get("token") or "")
        try:
            if itype == 3:
                kind = di.component_kind(interaction)
                if kind == "charts":                            # a /charts timeframe button
                    reqs = di.parse_multi_component(interaction)
                    for _ in reqs:
                        wait = di.user_rate_check(uid)
                        if wait:
                            return _ephemeral(di.throttle_message(wait))
                    if not app_id or not token:
                        return _ephemeral("Discord did not supply a reply token.")
                    background.add_task(di.run_multi_chart_job, app_id, token,
                                        [breadth_adjust(q, dict(prefs)) for q in reqs],
                                        bars_fn=fetch_bars, render_fn=render_chart_png, edit_fn=di.edit_original,
                                        house_fn=house.render_house_chart if house.house_enabled() else None,
                                        quote_fn=fetch_ext_quote, components_fn=di.multi_components)
                    return {"type": 6}
                req = di.parse_component(interaction)          # a button under a chart
            else:
                kind = "chart"
                reqs = di.parse_chart_requests(interaction, default_tf=prefs.get("tf", "D"))
                if len(reqs) > 1:               # /chart NVDA AMD AVGO — one door, one message
                    for _ in reqs:
                        wait = di.user_rate_check(uid)
                        if wait:
                            return _ephemeral(di.throttle_message(wait))
                    if not app_id or not token:
                        return _ephemeral("Discord did not supply a reply token.")
                    background.add_task(di.run_multi_chart_job, app_id, token,
                                        [breadth_adjust(q, dict(prefs)) for q in reqs],
                                        bars_fn=fetch_bars, render_fn=render_chart_png, edit_fn=di.edit_original,
                                        house_fn=house.render_house_chart if house.house_enabled() else None,
                                        quote_fn=fetch_ext_quote, components_fn=di.multi_components)
                    return {"type": 5}
                req = reqs[0]
        except di.CommandError as e:
            return _ephemeral(str(e))
        if kind == "chart" and itype == 3 and di.is_help_pick(interaction):
            # "How these controls work" — answer privately and put the dropdown
            # back where it was (a select keeps showing whatever was picked).
            data: dict = {"components": di.chart_components(req, prefs, guild_id=str(interaction.get("guild_id") or "")),
                          "content": str((interaction.get("message") or {}).get("content") or "")}
            att = di.message_attachment_ids(interaction)
            if att:
                data["attachments"] = [{"id": i} for i in att]
            if app_id and token:
                background.add_task(di.followup_ephemeral, app_id, token, di.chart_help_text())
            return {"type": 7, "data": data}
        if kind == "chart" and itype == 3 and di.is_save_pick(interaction):
            # "Save this chart's settings as my defaults" - writes the member's
            # /chartsettings from the message's state; no re-render.
            if not uid:
                return _ephemeral("Could not tell who you are; try again from a server channel.")
            try:
                saved = prefs_mod.set_prefs(uid, **di.prefs_from_request(req))
            except ValueError as e:
                return _ephemeral(f"Not saved: {e}")
            except Exception as e:  # noqa: BLE001
                log.warning("[discord-chart] save-defaults failed for %s: %s", uid, e)
                return _ephemeral("Settings are unavailable right now, try again in a minute.")
            # Answer with UPDATE_MESSAGE rather than a bare ephemeral: a select
            # keeps showing whatever was last PICKED, so a plain ephemeral left
            # "\U0001f4be Save this chart's settings…" standing where the chart's
            # style should be, until the member happened to click something else.
            # Re-sending the same rows resets it.
            #
            # ⛔ The message's FILES ARE RE-DECLARED from the interaction payload
            # (`message_attachment_ids`), never omitted - an UPDATE_MESSAGE that
            # does not list them is the same wager `edit_original`'s follow-up
            # refuses, and losing it would delete the chart from the message.
            # Content is restated for the same reason (it carries the context line).
            data: dict = {"components": di.chart_components(req, saved, guild_id=str(interaction.get("guild_id") or "")),
                          "content": str((interaction.get("message") or {}).get("content") or "")}
            att = di.message_attachment_ids(interaction)
            if att:
                data["attachments"] = [{"id": i} for i in att]
            if app_id and token:
                # The confirmation cannot ride an UPDATE_MESSAGE; it follows as a
                # private message. Best-effort: a lost follow-up costs the receipt,
                # never the save (already written) or the reset rows.
                background.add_task(di.followup_ephemeral, app_id, token,
                                    "Saved as your defaults: " + prefs_mod.describe(saved))
            return {"type": 7, "data": data}
        if kind == "activity":
            # "Open in Discord": remember what this channel is looking at, then let
            # Discord open the Activity (LAUNCH_ACTIVITY carries no parameters).
            handoff.record(str(interaction.get("channel_id") or ""), user_id=uid, ticker=req.ticker, tf=req.tf,
                           prefs={**prefs, **req.overrides()})
            return {"type": 12}
        wait = di.user_rate_check(uid)
        if wait:
            return _ephemeral(di.throttle_message(wait))
        prefs = {**prefs, **req.overrides()}   # this call only; saved settings untouched
        req, prefs = breadth_adjust(req, prefs)
        if not app_id or not token:
            return _ephemeral("Discord did not supply a reply token.")
        background.add_task(di.run_chart_job, app_id, token, req,
                            bars_fn=fetch_bars, render_fn=render_chart_png, edit_fn=di.edit_original,
                            house_fn=house.render_house_chart if house.house_enabled() else None,
                            prefs=prefs, quote_fn=fetch_ext_quote,
                            context_fn=chart_context.context_line if chart_context.enabled() else None,
                            components_fn=functools.partial(di.chart_components, guild_id=str(interaction.get("guild_id") or "")))
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


def run_index_close(*, force: bool = False, dry_run: bool = False) -> dict:
    """The into-the-close post, wired to the SAME authorities /chart uses: the
    bars router, `compute_stats`, the house renderer and the house attachment
    name. One wiring, used by both the scheduler and the manual trigger, so a
    hand-fired post cannot differ from the scheduled one."""
    from api.services import discord_index_close as idx
    return idx.run_close_post(
        bars_fn=fetch_bars,
        house_fn=house.render_house_chart,
        stats_fn=compute_stats,
        name_fn=di.attachment_name,
        options=prefs_mod.render_options(dict(prefs_mod.DEFAULTS), idx.CHART_TF),
        force=force, dry_run=dry_run)


# The last hand-fired run, so its outcome can be READ BACK. Rendering eight
# charts takes about a minute, which is longer than Cloudflare will hold a
# connection (it answered 524 on 2026-08-27), and a caller who never sees the
# result cannot tell "it posted" from "it died" - which, for a public channel,
# is the difference between firing again and double-posting.
_LAST_INDEX_CLOSE: dict = {"state": "never run"}


def _index_close_worker(force: bool, dry: bool) -> None:
    global _LAST_INDEX_CLOSE
    _LAST_INDEX_CLOSE = {"state": "running", "force": force, "dry_run": dry}
    try:
        report = run_index_close(force=force, dry_run=dry)
        report.pop("bytes", None)
        _LAST_INDEX_CLOSE = {"state": "done", **report}
        log.info("[index-close] manual run %s", report)
    except Exception as e:  # noqa: BLE001
        log.exception("[index-close] manual run failed")
        _LAST_INDEX_CLOSE = {"state": "error", "error": str(e)}


@router.post("/api/discord/index-close/run")
def index_close_run(request: Request, background: BackgroundTasks,
                    force: bool = False, dry: bool = False):
    """Fire (or dry-run) the into-the-close post by hand. Gated by the
    PUSH_SECRET bearer like sessions-status. `dry=1` renders everything and
    reports what WOULD go out without posting - the way to look at a change
    before a public channel does. `force=1` ignores the flag, the trading-day
    check and the already-posted marker; it is the deliberate one-off.

    ⛔ IT RETURNS IMMEDIATELY AND RENDERS IN THE BACKGROUND. Two reasons, both
    learned the hard way on 2026-08-27: eight house renders take about a minute,
    which is past Cloudflare's patience (it answered 524 while the job was still
    working, leaving the caller unable to tell whether it had posted), and this
    was an `async def` calling straight into that blocking work - on a pod that
    is ONE uvicorn process with ONE event loop, that pins every other member's
    request for the duration. Read the outcome from /index-close/status."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    if _LAST_INDEX_CLOSE.get("state") == "running":
        return {"started": False, "reason": "a run is already in flight"}
    background.add_task(_index_close_worker, force, dry)
    return {"started": True, "force": force, "dry_run": dry,
            "read_the_result_at": "/api/discord/index-close/status"}


@router.get("/api/discord/index-close/status")
def index_close_status(request: Request):
    """What the last hand-fired run did, plus the session already posted for.
    Gated by the PUSH_SECRET bearer."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    from api.services import discord_index_close as idx
    return {"last_run": _LAST_INDEX_CLOSE, "last_posted_session": idx.last_posted(),
            "armed": idx.enabled(), "webhook_configured": bool(idx.webhook_url())}


@router.get("/api/discord/activity/handoff")
def activity_handoff(channel_id: str = ""):
    """What the Discord Activity in `channel_id` should open: the channel's
    newest "Open in Discord" click within the TTL, else nothing. Public and
    harmless - a ticker and a timeframe - and the Activity page has no session."""
    entry = handoff.latest(channel_id) if channel_id else None
    if not entry:
        return {"ticker": None, "tf": None, "prefs": None}
    return {"ticker": entry["ticker"], "tf": entry["tf"], "prefs": entry.get("prefs") or None}
