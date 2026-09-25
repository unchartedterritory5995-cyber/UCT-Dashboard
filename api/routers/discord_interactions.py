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
        # ⛔ MEMBER. This job exists because a member typed `/buzz` and is watching a
        # deferred reply; it is background only in the sense of WHERE it runs.
        from api.services.render_gate import MEMBER
        png = render(window, cls=MEMBER)
    except Exception as e:  # noqa: BLE001 — a background job must never raise
        log.warning("[buzz] image render failed: %s", e)
        png = None
    if png:
        edit(app_id, token, content=content, png=png, filename="buzz.png")
    else:
        edit(app_id, token, content=content)


def run_buzz_job(app_id: str, token: str, ticker: str, window: str, now: int,
                 *, build_fn=None, render_fn=None, edit_fn=None) -> None:
    """OI-36 — ALL of `/buzz`'s work, moved to AFTER the defer.

    ⚰️ WHAT THIS FIXES, MEASURED. The handler used to `await run_in_threadpool(...)` to
    build the reply text and only THEN return `{"type": 5}`. That await is bounded by the
    shared anyio thread limiter (64 tokens, `api/main.py:2847`) — which every one of this
    router's ten sync `background.add_task` render jobs also draws from, because Starlette
    runs sync background tasks in that same pool. So the ack was bounded by POOL
    AVAILABILITY, not by its own ~8.5 ms of SQLite: **1.05 ms free, 2,001 ms exhausted**,
    against Discord's 3 s initial-ack deadline.

    ⭐ THE ORDERING IS THE WHOLE FIX. Nothing here is faster than it was; the work simply
    stopped standing between the member and the ack. This is exactly the shape V2 already
    had — `_enqueue` offers the job and returns the defer with no work in between, measured
    at p50 0.0023 ms with every render slot starved (C-02).

    ⛔ It does NOT move the work off the threadpool — `build_board_text` still belongs
    there. Running 8.5 ms of synchronous SQLite on the ONE shared event loop of a
    single-process pod is the 2026-07-01 outage by name, and the comment that put it in a
    threadpool was right. The bug was where the await sat, not that it existed.
    """
    from api.services import buzz_image, buzz_reply
    build = build_fn or (lambda: buzz_reply.build_ticker_text(ticker, window, now) if ticker
                         else buzz_reply.build_board_text(now, window))
    edit = edit_fn or di.edit_original
    try:
        text = build()
    except Exception as e:  # noqa: BLE001 — a background job must never raise
        log.warning("[buzz] reply failed: %s", e)
        # ⛔ The member is already looking at a "thinking…" that only we can resolve. The
        # pre-fix code could `return _ephemeral(...)` here because it had not acked yet;
        # after the defer, saying nothing leaves the spinner forever.
        try:
            edit(app_id, token, content="Could not read the counts right now.")
        except Exception as e2:  # noqa: BLE001
            log.warning("[buzz] failure edit failed: %s", e2)
        return
    # A ticker narrows to one name's numbers — text only, exactly as before. No ticker is
    # the board, which is worth an image.
    if not ticker and buzz_image.image_enabled():
        run_buzz_image_job(app_id, token, text, window, render_fn=render_fn, edit_fn=edit_fn)
        return
    edit(app_id, token, content=text)


def _flow_fmt_m(v) -> str:
    v = float(v or 0)
    if v >= 1e9:
        return f"${v / 1e9:.1f}B"
    if v >= 1e6:
        return f"${v / 1e6:.1f}M"
    return f"${v / 1e3:.0f}K"


def _flow_window_phrase(w: dict) -> str:
    """The window a reply names. When the backend WIDENED (`window.widened_from`, the ladder in
    `live_massive_router.TICKER_FLOW_WIDEN_LADDER`), the phrase says both halves — the window
    served AND the one the member asked for — so a 20-day card never reads as today's tape."""
    w = w or {}
    req = str(w.get("days_requested") or "").lower()
    served = "all history" if req == "all" else (f"last {req} trading days" if req and req != "1" else "today")
    frm = str(w.get("widened_from") or "").lower()
    if frm and frm != req:
        asked = "all history" if frm == "all" else (f"the last {frm} trading days" if frm != "1" else "today")
        return f"{served} (nothing significant {asked})"
    return served


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
                      *, fetch_fn=None, render_fn=None, edit_fn=None, fail_fn=None,
                      timeout_s: float = 30.0, cid: str | None = None, source: str | None = None) -> None:
    """Background job for /flow. Fetch the ticker's flow summary from the FLOW-WORKER,
    render the card, and post it PUBLICLY as the bot — the deferred interaction
    @original is app-owned, so the 'View chart' button routes back to us. Never raises;
    an empty or errored read resolves the reply with an honest note (no false zero).

    `fail_fn(cls, detail)` (the Discord render V2 runtime) replaces the per-site
    sentences with the failure contract, and gets the REAL cause: before it, every
    non-ok read said "the flow feed is reconnecting" — a 30 s timeout on 2026-09-11,
    a flow-worker restart on 2026-09-08, and every other cause alike. Without
    `fail_fn` the replies are byte-identical to what members get today.
    `cid` rides to flow-worker as a query parameter, so its access log carries the
    correlation id without any change to a flow-worker file.
    `source` is the flow partition: the default `stocks` is what every pre-V2 reply reads; the V2
    handler passes `etfs` for an ETF or index underlying (C-14, `discord_render.symbols.flow_source`)."""
    # ⛔⛔ THE PARTITION IS RESOLVED HERE, IN THE BACKGROUND JOB, AND NOT AT THE DISPATCH.
    # ⚰️ W1 shipped it at the dispatch (`background.add_task(..., source=flow_source(tkr))`) and
    # that put a COLD FIRST CALL on the ACK PATH — `flow_source` lazily imports
    # `api.massive_processor` and loads the ETF universe. Measured locally: first call 125.9 ms,
    # second 0.5 ms. Measured on the live pod the same afternoon, on the first `/flow` after the
    # deploy: `entry_to_ack = 65,462.6 ms`, with the next command at 1.4 ms — the shape of a cold
    # start, 21x the 3,000 ms Discord budget, and the member got "The application did not respond".
    # ⚠️ 65 s is ~500x the local cold cost, so this is a SUSPECT and not a proven cause; the pod
    # was two minutes into its boot storm. It is moved anyway, because the rule does not depend on
    # winning the argument: NOTHING THAT CAN BLOCK BELONGS BEFORE THE DEFER. The ack path parses
    # and defers; everything else is the job's.
    # ⭐ Behaviour is unchanged on the wire — V2 still passes `source` explicitly and wins; only a
    # caller that supplies none now gets it resolved here instead of one frame earlier.
    if source is None:
        from api.services.discord_render import symbols as _symbols
        source = _symbols.flow_source(ticker)
    from api.flow_ticker_card import render_ticker_flow_card
    render = render_fn or render_ticker_flow_card
    ack = edit_fn or di.edit_original            # edits/posts the deferred interaction reply
    data = None
    fail_cls, fail_detail = "flow_error", ""
    # ⭐ OPTION A (2026-09-25, dark under DISCORD_FLOW_CARD_SOURCE=page): the card derived from
    # the Options Flow PAGE's own product, so it reads what a member sees when they open the
    # page. When the product cannot be derived for any rung the rollup below answers instead,
    # LABELLED (`derivation: rollup`) — a degraded delivery, never a silent second truth.
    from api.services import flow_card_from_page as _page
    if _page.enabled():                      # on BOTH paths: `fetch_fn` (V2) is the fallback, not a bypass
        try:
            data = _page.page_derived_payload(ticker, days, source, timeout_s=timeout_s)
        except Exception as e:  # noqa: BLE001 — the rollup is the fallback
            log.warning("[flow] page-derived card failed %s (%s): %s", ticker, days, e)
            data = None
        if data is None:
            log.info("[flow] page-derived card unavailable for %s (%s); rollup fallback", ticker, days)
    try:
        if data is not None:
            pass
        elif fetch_fn is not None:
            data = fetch_fn(ticker, days)
        else:
            base = (os.environ.get("WORKER_INTERNAL_URL") or "").rstrip("/")
            if base:
                import httpx
                # `widen=1`: an empty window climbs 1→5→20→all server-side and the payload says
                # so (`window.widened_from`); the card and the sentence both name it. Owner
                # ruling 2026-09-24: a blank card reads as an error, so the reply is the
                # nearest window that HAS flow, never a blank one.
                params = {"symbol": ticker, "days": days, "source": source, "widen": "1"}
                if cid:
                    params["cid"] = cid
                try:
                    r = httpx.get(f"{base}/api/live/massive/ticker-flow", params=params, timeout=timeout_s)
                except httpx.TimeoutException:
                    fail_cls, fail_detail = "flow_timeout", f"no answer in {timeout_s:.0f}s"
                    raise
                except httpx.TransportError:
                    fail_cls, fail_detail = "flow_unavailable", "connect/transport error"
                    raise
                if not r.is_success:
                    fail_cls, fail_detail = "flow_error", f"HTTP {r.status_code}"
                data = r.json() if r.is_success else None
            else:
                from api import live_massive_router as lmr   # single-service fallback
                data = lmr._compute_ticker_flow(ticker, days, source, 15, widen=True)
    except Exception as e:  # noqa: BLE001 — a background job must never raise
        log.warning("[flow] fetch failed %s (%s): %s", ticker, days, e)
        fail_detail = fail_detail or type(e).__name__
        data = None

    if not data or not data.get("ok"):
        if fail_fn is not None:
            fail_fn(fail_cls, fail_detail or "ok:false")
            return
        # ⛔⛔ R53 (D-16) — THE PRE-V2 SENTENCE NAMES ITS CAUSE CLASS. It read "the flow feed is
        # reconnecting" for EVERY non-ok read, which `contract.py` already records as the defect
        # the whole failure contract exists to end: "for two weeks /flow answered 'The flow feed
        # is reconnecting' to a 30 s timeout (2026-09-11 AMD/AMDL), to a flow-worker restart
        # (2026-09-08 SPCX) and to every other non-ok read."
        # ⭐ THE CLASS WAS ALREADY COMPUTED AND THEN THROWN AWAY. The fetch block above sets
        # `fail_cls` on every arm — flow_timeout / flow_unavailable / flow_error — and this
        # branch printed one sentence over all of them. So this is not a new taxonomy: it is
        # `contract.plain()`, the SAME table V2 reads, used in the pre-V2 words.
        # ⛔ "Try again in a moment" is kept ONLY where a retry can actually work. A timeout or a
        # transport error may clear; an upstream error is not the member's to retry into.
        from api.services.discord_render import contract as _contract
        _cls = _contract.normalize_class(fail_cls)
        _retryable = _cls in ("flow_timeout", "flow_unavailable")
        ack(app_id, token,
            content=f"⚠️ **{ticker}** — {_contract.plain(_cls)}."
                    + (" Try again in a moment." if _retryable else ""))
        return
    if "derivation" not in data:
        data["derivation"] = "rollup"
    win = _flow_window_phrase(data.get("window") or {})
    if not (data.get("contracts") or []):
        # With `widen`, this is reached only when EVERY rung of the ladder was empty, and the
        # payload says so (`window.widened_checked`). The wider-window clause is spoken ONLY
        # on that evidence: a backend that ignored `widen` returns a plain empty window, and
        # the reply must not vouch for a search that never ran.
        checked = (data.get("window") or {}).get("widened_checked") or []
        tail = (" — and none on record in any wider window (checked back through all history)"
                if "all" in [str(c) for c in checked] else "")
        ack(app_id, token, content=f"**{ticker}** — no significant options flow {win}{tail}.")
        return
    try:
        png = render(data)
    except Exception as e:  # noqa: BLE001
        log.warning("[flow] render failed %s: %s", ticker, e)
        if fail_fn is not None:
            fail_fn("internal", "card render failed")
            return
        ack(app_id, token, content="Couldn't render the card — try again in a moment.")
        return
    # Post the card PUBLICLY as the bot — the deferred interaction @original is
    # app-owned, so the 'View chart' button routes back to us. Image-only (the card
    # already carries ticker/window/net).
    ack(app_id, token, content="", png=png, filename=f"{ticker}_flow.png",
        components=di.flow_components(ticker))


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


def _emit_ack_timing(request) -> dict | None:
    """OI-42 — split the 3 s ack budget into the half we owned and the half we did not.

    ⚰️ WHY THIS EXISTS. 2026-09-15, `#render-smoke`, ONE admin, NO load: `/flow` answered
    "The application did not respond." Its handler is already defer-first and does no I/O
    before the ack (`background.add_task` then `{"type": 5}`), so nothing IN the handler
    could explain it. The starvation was BEFORE handler entry, and nothing measured that.

    Two hops, emitted as ordinary `drender` events:
      `send_to_entry` — Discord's `X-Signature-Timestamp` to our handler entry. This is the
                        half that was invisible: transport plus anything that kept the ONE
                        event loop from reaching this coroutine.
      `entry_to_ack`  — handler entry to the reply object existing. This half was already
                        measured as the S1 SLO; it is emitted beside the other so a reader
                        sees which half spent the budget.

    ⛔⛔ `send_to_entry` HAS ONE-SECOND RESOLUTION AND UNKNOWN CLOCK SKEW, and that is
    stated here rather than discovered by someone trusting a 400 ms reading. Discord's
    timestamp is integer UNIX SECONDS, and our clock is not synchronised to theirs. So:
      * it CAN separate "we got it late" from "we were slow" at the multi-second scale,
        which is the scale a missed 3 s ack lives at -- the case it was built for;
      * it CANNOT be read as a sub-second latency figure, and a negative value means skew,
        not time travel. Negative readings are emitted as-is rather than clamped, because a
        clamped -800 ms renders as a healthy 0 and hides the skew.
    ⭐ The loop-stall reading (`loopwatch`) is the corroborating instrument: a large
    `send_to_entry` WITH a concurrent stall is starvation; without one it is transport.

    Never raises: an observability path that can break the request it observes is worse
    than no observability at all."""
    try:
        stashed = getattr(request.state, "drender_ack_t", None)
        if not stashed:
            return None
        ts, entry_wall, entry_perf = stashed
        import time as _t
        from api.services.discord_render import ids, observe
        seen = getattr(request.state, "drender_interaction", None) or {}
        cmd = str(((seen.get("data") or {}).get("name")) or "") or None
        # ⛔⛔ R54 (D-15) — THE INTERACTION TYPE RIDES IN-BAND, OR THIS STREAM LIES.
        # An AUTOCOMPLETE carries the same `data.name` as the command it is completing, so
        # without this every `/flow` keystroke that reaches us is indistinguishable from a
        # member actually running `/flow`. Measured 2026-09-17: an ack for `cmd:"flow"` at
        # 13:54:16Z with no message in the channel and no command sent for another six minutes.
        # Consumers filter with `observe.is_command_arrival`; unknown is never a command.
        itype = seen.get("type")
        itype = itype if isinstance(itype, int) else None
        entry_to_ack_ms = (_t.perf_counter() - entry_perf) * 1000.0
        out = {"entry_to_ack_ms": entry_to_ack_ms}
        observe.event("ack", cid=ids.current(), cmd=cmd, hop="entry_to_ack", ms=entry_to_ack_ms,
                      itype=itype)
        try:
            send_to_entry_ms = (entry_wall - int(ts)) * 1000.0
        except (TypeError, ValueError):
            send_to_entry_ms = None          # unparsable header: absent, never zero
        if send_to_entry_ms is not None:
            out["send_to_entry_ms"] = send_to_entry_ms
            observe.event("ack", cid=ids.current(), cmd=cmd, hop="send_to_entry", ms=send_to_entry_ms,
                          itype=itype)
        return out
    except Exception:  # noqa: BLE001
        return None


@router.post("/api/discord/interactions")
async def discord_interactions(request: Request, background: BackgroundTasks):
    """The member's reply is produced by `_dispatch_interaction` and returned UNCHANGED.

    ⛔⛔ THE SHADOW RUNS AFTER THE REPLY AND OFF THE LOOP (P2.10). With `RENDER_V2_SHADOW`
    unset — which is every environment until the owner sets it — `shadow.enabled()` is
    False and this wrapper is one comparison. With it set, the shadow is handed to a
    thread AFTER the response object exists, so it cannot delay, alter, or fail the
    member's reply: measuring the cost of measuring is the one thing a shadow must not do
    on a pod with one event loop (C-02)."""
    reply = await _dispatch_interaction(request, background)
    _emit_ack_timing(request)
    try:
        from api.services.discord_render import shadow as _shadow
        seen = getattr(request.state, "drender_interaction", None)
        if seen is not None and _shadow.enabled():
            from api.services.discord_render.commands import _io_pool as _shadow_pool
            _shadow_pool.submit(_shadow.run_safely, seen,
                                reply if isinstance(reply, dict) else None)
    except Exception:  # noqa: BLE001 — a shadow that can break the request it shadows is worse than none
        pass
    return reply


async def _dispatch_interaction(request: Request, background: BackgroundTasks):
    import time as _time
    received = _time.perf_counter()        # the V2 ack SLO (S1) is measured from here
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
    # The parsed interaction, for the shadow wrapper above — the body is already consumed
    # by the time it runs, and re-reading a Request body is not possible.
    request.state.drender_interaction = interaction
    # OI-42 — the two halves of the ack budget, stashed for the wrapper to emit.
    # `received` is already the S1 start; what was never captured is the half BEFORE it.
    request.state.drender_ack_t = (ts, _time.time(), received)

    itype = interaction.get("type")
    if itype == 1:
        return {"type": 1}
    if not di.guild_allowed(interaction):
        log.warning("discord interaction refused: guild=%s context=%s owners=%s",
                    interaction.get("guild_id"), interaction.get("context"),
                    interaction.get("authorizing_integration_owners"))
        # An autocomplete interaction may ONLY be answered with choices (type 8).
        return _autocomplete([]) if itype == 4 else _ephemeral(di.NOT_ALLOWED_MESSAGE)
    # ── Discord render V2 (docs/discord-render/03-architecture.md) ──────────────
    # Behind DISCORD_RENDER_V2_ENABLED (default OFF). When it answers, the interaction
    # never reaches the pre-V2 branches below; when it returns None (flag off, a
    # per-command kill switch, or an interaction V2 leaves to the old path such as the
    # help/save picks) everything below runs exactly as before.
    from api.services.discord_render import commands as render_v2
    # ⛔ /renderhealth is answered whatever the flag says. It is a read-only admin diagnostic that
    # peeks at state and starts nothing, and it is most useful BEFORE the flip — that is how an
    # admin watches the queue and the renderer while V2 is still dark. Every other command stays
    # behind DISCORD_RENDER_V2_ENABLED.
    _v2_always = (interaction.get("data") or {}).get("name") == di.RENDERHEALTH_COMMAND and itype == 2
    if render_v2.enabled() or _v2_always:
        v2_response = await render_v2.handle(interaction, received)
        if v2_response is not None:
            return v2_response
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
        # ⛔ NOTHING IS IMPORTED HERE ANY MORE, AND THAT IS PART OF THE FIX. `buzz_image`
        # and `buzz_reply` were imported at the top of this branch and used before the
        # defer; both now live in `run_buzz_job`, past the ack. A first import of either
        # module is disk I/O on the ack path.
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
        # ⛔⛔ OI-36 — DEFER FIRST, WORK AFTER. Nothing above this line touches the
        # threadpool, the store, or the network: the rate check and the option parse are
        # dict reads. Everything that could block now runs in `run_buzz_job`, on the far
        # side of the ack. See that function for the measurement (1.05 ms free vs 2,001 ms
        # with the shared anyio pool exhausted, against a 3 s deadline).
        app_id = str(interaction.get("application_id") or os.environ.get("DISCORD_CHART_APP_ID") or "")
        token = str(interaction.get("token") or "")
        if not app_id or not token:
            # No token means no follow-up is possible, so a defer would strand the member
            # on a spinner nothing can resolve. This is the one branch that still answers
            # immediately, and it does no work to do so.
            return _ephemeral("Discord did not supply a reply token.")
        background.add_task(run_buzz_job, app_id, token, ticker, window, now)
        # ⛔ THE FLAG GOES ON THE DEFER, NOT THE FOLLOW-UP. Discord fixes a deferred
        # reply's visibility at type 5; setting flags later on the PATCH is silently
        # ignored and the board lands PUBLICLY. `run_buzz_job` edits via `edit_original`
        # (PATCH /webhooks/{app}/{token}/messages/@original), which keeps whatever this
        # response declared.
        # ⚠️ MEMBER-VISIBLE: the TICKER reply was a type-4 immediate text and is now a
        # deferred one. Same words, same ephemeral visibility, one "thinking…" frame
        # first. That is the cost of the ack never being able to miss, and it is stated
        # here rather than discovered.
        return {"type": 5, "data": {"flags": di.EPHEMERAL}}
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
        # ⛔⛔ R53 (D-16) — THE PARTITION IS CHOSEN HERE, OR SPY IS SEARCHED WHERE IT CANNOT BE.
        # This call passed NO `source`, so the signature default `stocks` applied to every
        # pre-V2 /flow. SPY is an ETF: `flow_source`'s own docstring measured **0 contracts
        # under `stocks` against 182 under `etfs`** on 2026-09-13. The read is not merely empty —
        # it is a 30-day aggregation over the whole stocks tape that returns nothing, so as the
        # tape grew it crossed `timeout_s` and members got "the flow feed is reconnecting" for
        # every ETF and index underlying. Measured 2026-09-17: `[flow] fetch failed SPY (30):
        # timed out`, 30.1 s after the ack, pre-market AND at 10:00 ET.
        # ⭐ V2 has always done this (`commands.py` → `symbols.flow_source`); the pre-V2 path
        # simply never learned. One classifier, both paths.
        # ⭐ NO `source=` HERE, DELIBERATELY. The job resolves it (see `run_flow_card_job`), so the
        # ack path stays parse-and-defer. Passing it here is what put a cold `flow_source` call
        # before the 3 s Discord budget and produced a 65,462 ms `entry_to_ack` on the first
        # command after a deploy.
        background.add_task(run_flow_card_job, app_id, token, tkr, days)
        # PUBLIC defer — the "thinking…" resolves into the card, posted as the bot so
        # the 'View chart' button (app-owned message) routes back to us. The bot now
        # has post + attach rights in the channel.
        return {"type": 5}
    if itype == 3 and str(((interaction.get("data") or {}).get("custom_id")) or "").startswith(di.FLOW_CHART_PREFIX + "|"):
        # "View chart" button under a /flow card → open the ticker's chart as an
        # EPHEMERAL popup (only the clicker sees it; Discord's Dismiss closes it).
        # Reuses the /chart house renderer + its TF/control buttons, so the popup is
        # the same interactive chart people already know.
        cid = str((interaction.get("data") or {}).get("custom_id") or "")
        ticker = cid.split("|", 1)[1].strip().upper()
        if not di._TICKER_RE.match(ticker):
            return _ephemeral("Couldn't read that ticker.")
        uid = di.interaction_user_id(interaction)
        wait = di.user_rate_check(uid)
        if wait:
            return _ephemeral(di.throttle_message(wait))
        prefs = _prefs_for(uid)
        req = di.ChartRequest(ticker=ticker, tf=prefs.get("tf", "D"), darkpool=True)  # popup defaults dark-pools ON
        req, prefs = breadth_adjust(req, prefs)
        app_id = str(interaction.get("application_id") or os.environ.get("DISCORD_CHART_APP_ID") or "")
        token = str(interaction.get("token") or "")
        if not app_id or not token:
            return _ephemeral("Discord did not supply a reply token.")
        background.add_task(di.run_chart_job, app_id, token, req,
                            bars_fn=fetch_bars, render_fn=render_chart_png, edit_fn=di.edit_original,
                            house_fn=house.render_house_chart if house.house_enabled() else None,
                            prefs=prefs, quote_fn=fetch_ext_quote,
                            context_fn=chart_context.context_line if chart_context.enabled() else None,
                            components_fn=functools.partial(di.chart_components, guild_id=str(interaction.get("guild_id") or "")))
        return {"type": 5, "data": {"flags": di.EPHEMERAL}}   # ephemeral popup
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


def _renderer_health(timeout_s: float = 2.0) -> dict | None:
    """chart-renderer's own /health, bounded. None when unconfigured; {"ready": False, ...}
    when it does not answer — "could not reach it" is reported, never read as healthy."""
    base = (os.environ.get("CHART_RENDERER_URL") or "").strip().rstrip("/")
    if not base:
        return None
    try:
        import httpx
        r = httpx.get(f"{base}/health", timeout=timeout_s)
        body = r.json() if r.is_success else {}
        return {"reachable": True, "status": r.status_code, "ready": bool(body.get("ready", body.get("browser"))), **body}
    except Exception as e:  # noqa: BLE001
        return {"reachable": False, "ready": False, "error": type(e).__name__}


@router.get("/api/discord/render-health")
def render_health(request: Request):
    """Discord render V2 health: queue, SLOs from the durable jobs table, renderer state and
    the alert rules currently breached. Gated by the PUSH_SECRET bearer like
    /api/discord/index-close/status. Read-only on purpose: with V2 off it does NOT start the
    runtime and does NOT create the jobs database — it says V2 is off."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or auth != f"Bearer {expected}":
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    from api.services.discord_render import commands as render_v2, observe
    from api.services.discord_render.jobs_store import JobsStore, default_path
    runtime = render_v2._runtime                       # peek: never build or start it from here
    store = runtime.store if runtime is not None else (JobsStore() if os.path.exists(default_path()) else None)
    payload = {"v2_enabled": render_v2.enabled(), "runtime_started": runtime is not None,
               "commit": (os.environ.get("RAILWAY_GIT_COMMIT_SHA") or "")[:12]}
    renderer = _renderer_health()
    if store is None:
        # ⛔⛔ OI-42 — THE LOOP READING MUST SURVIVE THIS EARLY RETURN. `loopwatch` is wired
        # at boot (`api/main.py`), is a kill switch so unset means ON, and measures exactly
        # the event-loop starvation that costs a member their 3 s ack (C-02). Its reading is
        # carried by `observe.health_payload`, which this branch never reaches — so on a pod
        # with V2 off and no jobs database, which is EVERY production pod today, the
        # instrument ran and its output was thrown away at the read boundary.
        # ⚰️ Measured 2026-09-15: `/flow` missed its ack in `#render-smoke` with one admin and
        # no load, and the one instrument that could have explained it reported nothing,
        # because of this line. Built, wired, live, and unreachable.
        # ⛔⛔ OI-47 — AND THE SAME EARLY RETURN SWALLOWED THE DURABLE RECORD, ONE WAVE LATER.
        # W1 wired `stall_record` and `token_slots` into `observe.health_payload` — the branch
        # below this one — so on every production pod they were computed by nobody and read by
        # nobody. ⭐ The acceptance test caught it the day it merged (`stall_record_present:
        # false`), which is the whole reason the directive requires reading the fields
        # IN-PROCESS rather than inferring them from a green merge.
        # ⚠️ The protective halves shipped regardless: the page path and the counter write are
        # not on this route. Only the READ surface was blocked — so the volume held the numbers
        # the whole time and a `railway ssh` import could see them. That is what made this cheap
        # to find and expensive to notice.
        return {**payload, "renderer": renderer, "slo": None, "loop": observe._live_loop(),
                "stall_record": observe._live_stall_record(),
                "token_slots": observe._live_token_slots(),
                "note": "no jobs database yet (V2 has never run on this volume)"}
    obs = render_v2._observer                          # its consecutive-miss count, unless this reading is ready
    misses = obs.renderer_misses if obs is not None and not (renderer or {}).get("ready") else None
    return {**payload, **observe.health_payload(runtime, store, renderer=renderer, renderer_misses=misses)}


@router.get("/api/discord/activity/handoff")
def activity_handoff(channel_id: str = ""):
    """What the Discord Activity in `channel_id` should open: the channel's
    newest "Open in Discord" click within the TTL, else nothing. Public and
    harmless - a ticker and a timeframe - and the Activity page has no session."""
    entry = handoff.latest(channel_id) if channel_id else None
    if not entry:
        return {"ticker": None, "tf": None, "prefs": None}
    return {"ticker": entry["ticker"], "tf": entry["tf"], "prefs": entry.get("prefs") or None}
