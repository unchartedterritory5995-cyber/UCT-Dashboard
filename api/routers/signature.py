"""UCT Signature Indicators — premium, server-computed, serve-stale wrapped.

Prefix is deliberately NOT /api/flow* (flow_proxy's catch-all would swallow it)
and NOT /api/indicator* (that namespace is reserved for Phase B's generic
engine). Flow data is read via the PROXIED /api/flow/ticker/{sym} surface so
the fresh flow.db on flow-worker answers — web's own copy is a FROZEN
pre-cutover snapshot.

THE FOUR RULES THIS MODULE EXISTS TO ENFORCE
--------------------------------------------
1. **No build may raise.** `ServeStale.serve` calls `build()` on the cold path
   with no try/except (serve_stale.py:143), so anything a build raises is a
   500 on a user's chart. Every `_*_build` below catches Exception, logs it
   with a traceback, and returns an envelope `good()` rejects — so a failure is
   visible, is never remembered as the last good payload, and is retried by the
   very next request. That covers the BOOKKEEPING too, not just the provider
   call: a raise while writing a cache is just as fatal as a raise while
   reading a provider.
2. **A ledger refusal is not a user-facing failure.** `record_signal` raises by
   design on any field it cannot key. The signals are already computed and
   correct; refusing to WRITE one must never refuse to SHOW it, so recording is
   wrapped per signal.
3. **Every route is a plain `def`.** The GEX adapter is async and is driven
   with `asyncio.run`, which raises RuntimeError inside an `async def`. Sync
   handlers also run in the anyio threadpool, which is where these blocking
   provider reads belong.
4. **Every route is TTL-cached in FRONT of the stale slot.** `fresh()` is not
   decoration: without it every single request drives a full provider rebuild
   (measured: 10 requests = 10 builds), because ServeStale serves the stale
   payload and then kicks a refresh behind EVERY caller. The TTL cache is what
   makes the stale slot a fallback instead of a treadmill — the shape
   serve_stale.py documents and calendar.py already uses.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import threading
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.cache import cache
from api.services.serve_stale import ServeStale
from api.services.signature import ledger, registry_defs, rules
from api.services.signature.darkpool_levels import fetch_dp_levels
from api.services.signature.flow_breakout import (
    FLOW_COLS, _bar_date_iso, evaluated_window, fcb_signals, flow_by_date,
)
from api.services.signature.gex_walls import fetch_gex_walls
from api.services.signature.rules import parse_money

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/signature", tags=["signature"])

# Must START with a letter. ".", "..", "-" are all valid to a bare
# `[A-Za-z.\-]+` class, and httpx COLLAPSES dot segments — a "symbol" of ".."
# would silently retarget the flow request a path level up. No real ticker
# begins with a dot or a dash.
# No \s in the class either: a symbol is stripped BEFORE it is validated (see
# _sym_or_422), never validated with padding still attached.
_SYM_RE = re.compile(r"^[A-Za-z][A-Za-z.\-]{0,9}$")

_DPL_STALE = ServeStale("sig_dpl", max_age_seconds=1800)
_FCB_STALE = ServeStale("sig_fcb", max_age_seconds=1800)
_GXW_STALE = ServeStale("sig_gxw", max_age_seconds=rules.GXW_MAX_AGE_S)

# Fresh-window TTLs. GEX reads rules.GXW_TTL_S (owner-tunable alongside the rest
# of the indicator's numbers); the other two are router-local because they are
# properties of this SURFACE rather than of the compute: dark-pool levels move
# only when the nightly confirmed-print ledger does, and a breakout is a
# closed-bar event — neither can change between two requests minutes apart.
_DPL_TTL_S = 600
_FCB_TTL_S = 300

# ── GEX negative cache ──────────────────────────────────────────────────────
# `good()` for GEX is "not error", so an auth-down envelope is NEVER remembered
# by ServeStale. Without this dict, every cold request during a Schwab auth
# outage — a routine, hours-long production state — blocks an anyio worker for
# the full ~20s /chains timeout, and the single-flight lock just queues the
# rest behind it. 60s of memory turns that storm into one call per symbol per
# minute while keeping the outage self-healing.
#
# It is strictly a COLD-PATH shield — see _gxw_negative_hit for the ordering
# rule that stops it outranking a payload we can still serve.
_GXW_NEG_CACHE: dict[str, tuple[dict, float]] = {}
_GXW_NEG_LOCK = threading.Lock()
_GXW_NEG_TTL_S = 60.0
_GXW_NEG_MAX_KEYS = 256

# ── FCB negative cache ──────────────────────────────────────────────────────
# The same shape, for the same reason, against a DIFFERENT outage.
#
# Measured on the pod 2026-08-06 10:04 ET: `/api/signature/flow-breakout` for
# SPY/QQQ/NVDA returned `{"error": "flow unavailable"}` after 15-17s, and PASS 2
# COST THE SAME. That is the tell — `_fcb_good()` is `"signals" in p`, so the
# error envelope is refused by the stale slot AND never written to the TTL
# cache, which leaves `fresh()` missing and the slot empty. ServeStale then has
# nothing to serve, so EVERY sequential request rebuilds: 15s of an anyio worker
# each, on the ONE shared uvicorn loop, all session (the 2026-07-01 524 class).
#
# The 15s is `_read_flow_source`'s `timeout=15.0` on the stocks->indexes
# FALLBACK leg: SPY is filed under `indexes`, and during RTH the flow-worker is
# saturated by the live OPRA tape, so a full-history streamed read of `indexes`
# cannot finish inside the request path's budget. Raising that timeout is not a
# fix — it moves the cost onto the request path during the busiest minutes.
#
# 60s of memory turns "every request pays 15s" into "one request per symbol per
# minute pays it", while keeping the outage self-healing. Like GEX's, it is
# strictly a COLD-PATH shield — see _fcb_negative_hit for the ordering rule.
_FCB_NEG_CACHE: dict[str, tuple[dict, float]] = {}
_FCB_NEG_LOCK = threading.Lock()
_FCB_NEG_TTL_S = 60.0
_FCB_NEG_MAX_KEYS = 256

# The strict side domain the FCB compute uses (flow_breakout._is_call/_is_put).
# Deliberately NOT the loose startswith("C") used elsewhere in the repo — see
# _flow_join_stats for why that difference has to be observable.
_FLOW_SIDE_DOMAIN = frozenset({"C", "CALL", "P", "PUT"})

# ── the flow read's budget, and what it is spent on ─────────────────────────
#
# ⭐ ONE BUDGET FOR THE WHOLE READ, NOT ONE PER SOURCE. `_fetch_flow_by_date`
# can issue TWO requests (stocks, then indexes). Each carried its own
# `timeout=15.0`, so an index symbol whose first leg was merely SLOW rather than
# dead could hold an anyio worker for **thirty** seconds — while every comment
# in this module, and the negative cache's entire justification ("every request
# pays 15s"), describes the request path's budget as fifteen. The second leg now
# gets what is LEFT of the budget.
_FLOW_READ_BUDGET_S = 15.0
# Below this there is no point starting a streamed read: it would expire partway
# through the body and the half-parsed join would be thrown away regardless.
# Declining to start is scored as a FAILED read (None), never as an empty tape —
# the caller must retry it next request, not remember "no signal" for 30 minutes.
_FLOW_READ_MIN_LEG_S = 1.0

# The projection the flow join actually reads. Derived from `FLOW_COLS` — the
# tuple `flow_by_date` resolves BY NAME out of the response header — so the
# question we ask and the fields we parse cannot drift apart. Measured against
# production 2026-08-06: `/api/flow/ticker/SPY?source=indexes` is 349,203 rows
# over 22 columns = 40.9 MB of CSV, of which this join reads three fields.
_FLOW_COLS_PARAM = ",".join(FLOW_COLS)

# ── which source a symbol is filed under ────────────────────────────────────
#
# `/api/flow/ticker` defaults to `source=stocks`, and index/ETF symbols live
# under `indexes`, so SPY/QQQ/IWM pay a WHOLE EXTRA ROUND TRIP that can only
# ever return a bare header (measured on prod: 1.06 s TTFB for a 145-byte
# response) before the real read even starts.
#
# This remembers ONLY the proven-index-filed symbols, and only when an `indexes`
# read actually RETURNED ROWS. It is deliberately not the symmetric "remember
# whichever source answered":
#   * `stocks` is already the documented default order, so remembering it would
#     record what the code does anyway;
#   * a symbol that appears in BOTH sources must keep resolving to `stocks`, the
#     order this surface has always had.
# It is never written from a FAILURE (a 500 is not a filing) and never from an
# EMPTY read (that is the poisoning `lesson_market_cap_cache_poison` names), and
# it is UNLEARNED the moment `indexes` stops answering for a symbol that
# `stocks` does — so an upstream re-filing costs one wasted probe, not a
# permanently wrong route.
_FCB_INDEX_FILED: dict[str, float] = {}
_FCB_INDEX_FILED_LOCK = threading.Lock()
_FCB_INDEX_FILED_MAX_KEYS = 512


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="UCT Signature indicators require a paid plan")
    return user


def _sym_or_422(sym: str) -> str:
    """Strip, then validate, then upper.

    The strip comes FIRST because callers do pass padded strings and the regex
    has no whitespace class — validating first would 422 a perfectly good
    symbol. The upper comes last because it is the cache key, the ServeStale
    key AND the ledger's stored symbol; the gex adapter stamps its own
    sym.upper() but that is downstream of a request we would already have
    rejected.
    """
    s = (sym or "").strip()
    if not _SYM_RE.match(s):
        raise HTTPException(status_code=422, detail="invalid symbol")
    return s.upper()


def _ck(kind: str, sym: str) -> str:
    return f"sig:{kind}:{sym}"


# ── Dark Pool Levels ────────────────────────────────────────────────────────

def _dpl_good(p) -> bool:
    return bool(p and p.get("levels") is not None)


def _dpl_build(sym: str) -> dict:
    try:
        payload = fetch_dp_levels(sym)
    except Exception as exc:                       # noqa: BLE001 — see rule 1
        logger.exception("signature: dark-pool levels build failed for %s", sym)
        # `levels: None` (not []) is load-bearing: good() is
        # `levels is not None`, so an empty list here would be remembered as
        # the last GOOD payload and served for the next 30 minutes.
        return {"sym": sym, "version": rules.VERSIONS["dpl"], "levels": None,
                "error": f"dark pool levels unavailable: {exc}", "asOf": time.time()}
    # Bookkeeping gets a guard of its own — the shape FCB and GXW already use.
    # Inside the provider's try, a raise from the CACHE WRITE would have been
    # caught by the provider's handler and reported as "dark pool levels
    # unavailable": a payload we had computed correctly, thrown away and
    # replaced with an error envelope, over a failure that has nothing to do
    # with the levels. Rule 1 wants the write guarded, not the answer discarded.
    try:
        if _dpl_good(payload):
            cache.set(_ck("dpl", sym), payload, ttl=_DPL_TTL_S)
    except Exception:                              # noqa: BLE001
        logger.exception("signature: dpl cache write failed for %s", sym)
    return payload


# ── Flow-Confirmed Breakout ─────────────────────────────────────────────────

def _fetch_bars(sym: str, count: int = 60) -> list[dict]:
    """Daily bars straight from the bars store.

    The timeframe key is "D" — what bars_sqlite actually stores daily rows
    under. "1D" is the PRODUCT label (what the ledger row carries, what the
    surface shows); passing it here matches no rows at all, and the indicator
    ships permanently, silently dead.
    """
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(sym.upper(), "D", int(count))
    out = []
    for r in rows:
        try:
            out.append({"t": int(r[0]), "o": float(r[1]), "h": float(r[2]),
                        "l": float(r[3]), "c": float(r[4]), "v": int(r[5] or 0)})
        except (TypeError, ValueError, IndexError):
            continue
    return out


def _flow_base_url() -> str:
    """Where /api/flow/ticker actually lives, resolved PER CALL.

    Mirrors `ai_search._flow_base_url` — the only other consumer of this
    surface — with an explicit override in front:

    * `SIGNATURE_FLOW_BASE` wins when set (an escape hatch needing no deploy).
    * When the read proxy is on, go STRAIGHT to `WORKER_INTERNAL_URL`: a
      self-request would only be forwarded there anyway, at the cost of an
      extra hop and one more held anyio worker.
    * Otherwise the local app on `$PORT`, defaulting to **8000** (uvicorn's).
      A hardcoded 8080 is wrong in local dev and a guess anywhere else, and it
      fails SILENTLY: the connection is refused, the flow read returns None,
      and the breakout is simply never confirmed.
    """
    override = os.environ.get("SIGNATURE_FLOW_BASE")
    if override:
        return override.rstrip("/")
    try:
        from api import flow_proxy
        if flow_proxy.PROXY_ENABLED and flow_proxy.WORKER_INTERNAL_URL:
            return flow_proxy.WORKER_INTERNAL_URL
    except Exception:                              # noqa: BLE001
        pass
    return f"http://127.0.0.1:{os.environ.get('PORT', '8000')}"


def _read_flow_source(sym: str, source: str, cutoff_iso: str,
                      *, timeout: float = _FLOW_READ_BUDGET_S) -> dict[str, list[dict]] | None:
    """One STREAMED read of ONE flow source, or **None when the read FAILED**.

    An unreachable flow service and a genuinely quiet tape both produce zero
    signals, but only one of them is an answer. Handing back `{}` for a failure
    would let the caller remember "no signal" as a good payload for the next 30
    minutes (`lesson_market_cap_cache_poison`: never cache a failed fetch as a
    value).

    **Streamed, not materialized.** The surface serves gzipped CSV
    (`flow_router.get_flow_ticker` → `_build_gzipped_symbol_csv`) UNCAPPED — a
    liquid name's history is 22 columns over months of tape. `resp.text` +
    `csv.DictReader` held the whole decoded body AND a full 22-key dict per row
    on an anyio worker, on the request path, for three fields the join actually
    reads. `httpx.stream` + `iter_lines` into the shared parser holds one row at
    a time and keeps three keys, inside the bar window it is about to join
    against.

    **And it now ASKS for three fields rather than discarding nineteen.**
    Streaming bounded this side's memory; it did nothing about the other side,
    which still SELECTed 22 columns, CSV-wrote them and gzipped the lot into
    memory before shipping a byte. That build is where the cold seconds were:
    measured on a replica of production's own rows, SPY/indexes went 2585 ms and
    10.2 MB gzipped to 678 ms and 2.1 MB, NVDA 1203 ms to 306 ms, AAPL 610 ms to
    187 ms — and this side's decode+parse fell with it (SPY 1367 ms to 781 ms).
    `cols=` is optional upstream and defaults to every column, so a service that
    has not taken the change yet answers exactly as it does today: slower, never
    wrong. A column it does not recognise is a 400 — which lands here as a
    FAILED read, not as a quiet tape.

    **The SERVICE credential rides, never the member's.** ⚰️ This said
    `/api/flow/ticker/{symbol}` "declares no auth dependency" — false since
    2026-08-09, when every flow read became `require_flow_user`, so this read was
    401 on every call and the flow leg came back empty. It now carries the
    PUSH_SECRET bearer that gate accepts (`flow_proxy.internal_read_headers`);
    the caller's session cookie is still never forwarded.
    """
    from api import flow_proxy
    url = f"{_flow_base_url()}/api/flow/ticker/{sym}"
    try:
        with httpx.stream("GET", url,
                          params={"source": source, "cols": _FLOW_COLS_PARAM},
                          headers=flow_proxy.internal_read_headers(),
                          timeout=timeout) as resp:
            if resp.status_code != 200:
                logger.warning("signature: flow read for %s (%s) returned HTTP %s",
                               sym, source, resp.status_code)
                return None
            return flow_by_date(resp.iter_lines(), cutoff_iso=cutoff_iso)
    except Exception as exc:                       # noqa: BLE001
        logger.warning("signature: flow read for %s (%s) failed: %s", sym, source, exc)
        return None


def _fcb_index_filed(sym: str) -> bool:
    """Has an `indexes` read ever RETURNED ROWS for this symbol?"""
    return sym in _FCB_INDEX_FILED


def _fcb_remember_index_filed(sym: str) -> None:
    # Locked: the prune below ITERATES the dict, so a concurrent writer would
    # raise "dictionary changed size during iteration" — on the cold path,
    # which is a 500 (rule 1). Same shape as the two negative caches.
    with _FCB_INDEX_FILED_LOCK:
        _FCB_INDEX_FILED[sym] = time.time()
        if len(_FCB_INDEX_FILED) > _FCB_INDEX_FILED_MAX_KEYS:  # the key is user input
            oldest_first = sorted(_FCB_INDEX_FILED, key=lambda k: _FCB_INDEX_FILED[k])
            for key in oldest_first[:-_FCB_INDEX_FILED_MAX_KEYS]:
                _FCB_INDEX_FILED.pop(key, None)


def _fcb_forget_index_filed(sym: str) -> None:
    with _FCB_INDEX_FILED_LOCK:
        _FCB_INDEX_FILED.pop(sym, None)


def _fetch_flow_by_date(sym: str, cutoff_iso: str = "") -> dict[str, list[dict]] | None:
    """Read flow via the proxied surface so flow-worker's fresh DB answers.

    **Two sources, tried in order.** `/api/flow/ticker` defaults to
    `source=stocks`, but the flow DB files index/ETF symbols — SPY, QQQ, IWM,
    every XL*, ~200 names — under `source=indexes`, and asking the wrong one
    returns a header with no rows: a 200, no error, and a join that matches
    nothing. That is the silent-death shape this indicator is most exposed to,
    and it lands on exactly the symbols people chart first.

    So: ask `stocks`, and only if the parse yields ZERO rows ask `indexes` once.
    Deliberately not a hardcoded symbol list — membership is upstream's to
    change, and a list would drift out of date without ever failing. A real
    stock still costs exactly one request.

    A FAILED read short-circuits: a 500 is not an empty tape, so it is never
    retried against the other source and never reported as a quiet one. If the
    fallback read itself fails, that failure is returned too — an index symbol
    whose second read died must be retried next request, not remembered as
    signal-free for the next 30 minutes.

    **Two things bound it now.**

    *One budget, not two.* Both legs used to carry their own 15s timeout, so the
    worst case for an index symbol was 30s on an anyio worker. The pair shares
    `_FLOW_READ_BUDGET_S`; the second leg is given the remainder, and if too
    little is left to finish a body it is not started — reported as a FAILED
    read, because "we ran out of time" is not "the tape was quiet".

    *And the wasted probe is learned away.* Once `indexes` has answered for a
    symbol WITH ROWS, that symbol asks `indexes` first and the bare-header
    `stocks` round trip stops being paid. Still not a hardcoded list —
    membership stays upstream's to change, and the memo unlearns itself the
    first time `indexes` comes back empty and `stocks` does not.
    """
    deadline = time.monotonic() + _FLOW_READ_BUDGET_S
    index_first = _fcb_index_filed(sym)
    first = "indexes" if index_first else "stocks"
    second = "stocks" if index_first else "indexes"

    by_date = _read_flow_source(sym, first, cutoff_iso,
                                timeout=_FLOW_READ_BUDGET_S)
    if by_date is None:
        return None
    if by_date:
        if first == "indexes":
            _fcb_remember_index_filed(sym)
        return by_date

    remaining = deadline - time.monotonic()
    if remaining < _FLOW_READ_MIN_LEG_S:
        logger.warning("signature: flow read for %s spent its whole %.0fs budget on "
                       "%s and had %.2fs left for %s — reporting a FAILED read, "
                       "not a quiet tape", sym, _FLOW_READ_BUDGET_S, first,
                       max(remaining, 0.0), second)
        return None

    by_date = _read_flow_source(sym, second, cutoff_iso, timeout=remaining)
    if by_date:
        if second == "indexes":
            _fcb_remember_index_filed(sym)
        else:
            # `indexes` went quiet and `stocks` answered: the memo that sent us
            # to `indexes` first is no longer true. Unlearn it, or this symbol
            # pays the wasted probe forever — the mirror image of the one this
            # memo exists to remove.
            _fcb_forget_index_filed(sym)
    return by_date


def _flow_join_stats(rows) -> dict:
    """Count what the flow→bar join is actually able to USE.

    `rows` is every row that SURVIVED the streamed parse — i.e. rows with a
    readable date inside the bar window. Rows outside the window were never
    going to join anything, so counting them would only dilute the numbers
    below.

    Both of these fail silently toward "no signal", because the compute just
    sums a smaller number — there is no error anywhere:

    * `side_matched` — the compute's side test is STRICT (C/CALL/P/PUT).
      Elsewhere the repo matches with a loose `startswith("C")`, so a new
      upstream encoding would keep working there and silently stop counting
      here.
    * `parsed_to_zero` — `parse_money` returns 0.0 for anything it cannot read
      (including NaN/inf), so a changed Premium format truncates every premium
      to nothing and no threshold is ever met again.

    Returned rather than logged in place so it is directly testable.
    """
    rows_in = side_matched = parsed_to_zero = 0
    unknown_sides: dict[str, int] = {}
    for r in rows:
        rows_in += 1
        side = str(r.get("CallPut") or "").strip().upper()
        if side in _FLOW_SIDE_DOMAIN:
            side_matched += 1
        elif side:
            # A blank side is a missing field, not a mystery encoding — only
            # the values someone would have to go LOOK at are named.
            unknown_sides[side] = unknown_sides.get(side, 0) + 1
        if parse_money(r.get("Premium")) == 0.0:
            parsed_to_zero += 1
    return {"rows_in": rows_in, "side_matched": side_matched,
            "parsed_to_zero": parsed_to_zero, "unknown_sides": unknown_sides}


def _log_flow_join(sym: str, by_date) -> None:
    stats = _flow_join_stats(r for rows in by_date.values() for r in rows)
    logger.info("signature: fcb flow join %s rows_in=%d side_matched=%d parsed_to_zero=%d",
                sym, stats["rows_in"], stats["side_matched"], stats["parsed_to_zero"])
    if stats["unknown_sides"]:
        logger.warning("signature: fcb flow join %s saw unrecognized CallPut values %s "
                       "— these rows contribute NO premium to the signal",
                       sym, sorted(stats["unknown_sides"].items()))


def _fcb_good(p) -> bool:
    return bool(p and "signals" in p)


def _fcb_negative_hit(sym: str) -> dict | None:
    """The remembered flow-outage envelope — but ONLY when nothing better exists.

    Identical ordering rule to `_gxw_negative_hit`, and for the identical
    reason: `ServeStale.serve` checks `fresh()` BEFORE the stale slot, so a
    negative entry returned unconditionally would OUTRANK a perfectly good
    signals payload seconds old — and it would keep doing so, because every
    request it answered skipped the stale path entirely. A user whose chart
    already carries a fine FCB overlay would watch the arrows vanish the moment
    the flow-worker got busy.

    So: peek the stale slot first and stand down if it can still serve. This
    cache is for the COLD herd — the callers who have nothing — and nobody else.
    """
    hit = _FCB_NEG_CACHE.get(sym)
    if not hit:
        return None
    payload, at = hit
    if time.time() - at > _FCB_NEG_TTL_S:
        with _FCB_NEG_LOCK:
            _FCB_NEG_CACHE.pop(sym, None)
        return None
    value, age = _FCB_STALE.peek(sym)
    if value is not None and age is not None and age <= _FCB_STALE.max_age:
        return None                                # a servable payload outranks us
    return payload


def _fcb_remember_error(sym: str, payload: dict) -> None:
    # Locked: the prune below ITERATES the dict, so a concurrent writer would
    # raise "dictionary changed size during iteration" — on the cold path,
    # which is a 500 (rule 1).
    with _FCB_NEG_LOCK:
        _FCB_NEG_CACHE[sym] = (payload, time.time())
        if len(_FCB_NEG_CACHE) > _FCB_NEG_MAX_KEYS:  # bounded: the key is user input
            oldest_first = sorted(_FCB_NEG_CACHE, key=lambda k: _FCB_NEG_CACHE[k][1])
            for key in oldest_first[:-_FCB_NEG_MAX_KEYS]:
                _FCB_NEG_CACHE.pop(key, None)


def _fcb_ledger_signals(sym: str, bars) -> list[dict]:
    """The nightly sweep's ALREADY-COMPUTED signals for this symbol — READ ONLY.

    FCB is a daily, closed-bar signal, and the request path passes
    `include_last=False`, so the newest bar it can ever fire on is the last
    CLOSED session. The 20:05 ET sweep evaluated that same session last night
    and wrote the result here. **During RTH the two cover the same window** —
    no new closed bar has appeared since — so for a swept symbol this is not a
    downgrade of the live compute, it is the same answer without the 15s read.

    Bounded to the window `bars` covers, because the ledger is append-only and
    holds every signal ever recorded; returning all of them would paint arrows
    on a chart window that does not contain them.

    Both sides of the window comparison go through `_bar_date_iso`, the ONE
    decoder the flow join already uses, rather than comparing raw ints: the
    ledger normalizes bar_time to a YYYYMMDD key and the bars store hands back
    the same encoding today, but this module's entire history is encodings
    drifting apart silently. ISO dates sort chronologically, so it is a plain
    string compare.

    Never raises: a fallback that can fail is not a fallback (rule 1).
    """
    if not bars:
        return []
    cutoff_iso = _bar_date_iso(bars[0]["t"])
    want = rules.VERSIONS["fcb"]
    out = []
    try:
        for row in ledger.get_signals(sym, limit=500):
            if (row.get("indicator") != "fcb" or row.get("tf") != "1D"
                    or row.get("version") != want):
                continue
            iso = _bar_date_iso(row.get("bar_time"))
            if not iso or (cutoff_iso and iso < cutoff_iso):
                continue
            meta = {}
            if row.get("meta_json"):
                try:
                    meta = json.loads(row["meta_json"]) or {}
                except (TypeError, ValueError):
                    meta = {}
            out.append({"barTime": row["bar_time"], "direction": row["direction"],
                        "close": row["price"], "version": row["version"],
                        "callPrem": meta.get("callPrem"), "putPrem": meta.get("putPrem")})
    except Exception:                              # noqa: BLE001 — see rule 1
        logger.exception("signature: fcb ledger fallback read failed for %s", sym)
        return []
    # Ascending — lightweight-charts requires markers in ascending time order,
    # and `get_signals` deliberately returns NEWEST-first.
    out.sort(key=lambda s: _bar_date_iso(s["barTime"]))
    return out


def _fcb_ledger_covers(sym: str, bars) -> bool:
    """Does a COVERAGE RECEIPT prove the sweep evaluated THIS window under THIS
    rule version?

    ⭐ THE DIFFERENCE BETWEEN "EVALUATED, NOTHING FOUND" AND "NEVER LOOKED".
    Everything above this line treats an empty ledger read as a failure, and it
    has to: `_fcb_ledger_signals` returning `[]` means the same thing for a
    symbol the nightly sweep walks every night and for one it has never heard
    of. Serving that empty list as an answer is `lesson_market_cap_cache_poison`
    with a confident face on — `_fcb_good()` is `"signals" in p`, so it would be
    cached for 5 minutes and remembered as the last GOOD payload for 30.

    A receipt is what makes the empty list an answer, and it is checked against
    the window THIS request would evaluate — `evaluated_window`, not the fetched
    range, because the first `FCB_LOOKBACK` bars are warm-up that no pass ever
    looks at. `include_last=False` mirrors `_fcb_build`: the request path never
    evaluates the forming session, so it must not demand coverage of it either
    (which would make every symbol uncertified during RTH).

    Never raises — it runs inside `build()`, which ServeStale calls with no
    try/except (rule 1). Every failure direction is False, i.e. "no proof",
    which lands on the pre-existing behaviour.
    """
    try:
        window = evaluated_window(bars, include_last=False)
        if window is None:
            return False
        return ledger.coverage_covers(
            "fcb", rules.VERSIONS["fcb"], sym, "1D",
            first_bar_time=window[0], through_bar_time=window[1])
    except Exception:                                  # noqa: BLE001 — see rule 1
        logger.exception("signature: fcb coverage read failed for %s", sym)
        return False


def _fcb_build(sym: str) -> dict:
    try:
        # Bars FIRST: the flow window is derived from them. Reading flow with no
        # cutoff would pull a symbol's entire filed history to join against 60
        # daily bars — the exact waste the streamed parser exists to avoid.
        bars = _fetch_bars(sym)
        cutoff_iso = _bar_date_iso(bars[0]["t"]) if bars else ""
        by_date = _fetch_flow_by_date(sym, cutoff_iso)
        if by_date is None:
            # The live read failed. Before calling it a failure, ask the ledger
            # what the nightly sweep already computed for this window.
            recorded = _fcb_ledger_signals(sym, bars)
            covered = _fcb_ledger_covers(sym, bars)
            if recorded:
                logger.warning("signature: fcb flow read failed for %s — serving %d "
                               "signal(s) from the nightly ledger instead", sym, len(recorded))
                payload = {"sym": sym, "version": rules.VERSIONS["fcb"],
                           "signals": recorded, "source": "ledger",
                           "covered": covered, "asOf": time.time()}
            elif covered:
                # ⭐ AN EMPTY ANSWER, ON PURPOSE, BECAUSE A RECEIPT SAYS SO.
                # This branch is the whole reason the coverage receipt exists.
                # The nightly sweep evaluated this exact bar window under this
                # exact rule version and wrote nothing, so "no signal" is a
                # measured fact rather than the shape of an outage — and it is
                # the same answer the live read would have produced, without the
                # multi-second read. Serving it is what turns a flow outage from
                # "one request per symbol per minute pays the full timeout" into
                # "answered from local sqlite".
                logger.warning("signature: fcb flow read failed for %s — the nightly "
                               "coverage receipt certifies this window under %s, so "
                               "the empty result is an ANSWER, not an outage",
                               sym, rules.VERSIONS["fcb"])
                payload = {"sym": sym, "version": rules.VERSIONS["fcb"],
                           "signals": [], "source": "ledger",
                           "covered": True, "asOf": time.time()}
            else:
                # Nothing recorded AND nothing certified. An UNSWEPT symbol and
                # a genuinely signal-free one are indistinguishable from here,
                # so this stays a failure. No "signals" key at all: good() is
                # `"signals" in p`, so the envelope is refused by the stale slot
                # and never becomes "no signal" for the next 30 minutes
                # (lesson_market_cap_cache_poison).
                payload = {"sym": sym, "version": rules.VERSIONS["fcb"],
                           "error": "flow unavailable", "asOf": time.time()}
        else:
            _log_flow_join(sym, by_date)
            signals = fcb_signals(bars, by_date, include_last=False)  # NEVER the forming session
            for s in signals:
                # Per SIGNAL, not per build: record_signal raises (ValueError on
                # any unusable field, sqlite3.IntegrityError on a non-UNIQUE
                # constraint failure), and one refused row must not cost the
                # user the others — nor the response. Re-recording is idempotent
                # by UNIQUE key.
                try:
                    ledger.record_signal("fcb", s["version"], sym, "1D", s["direction"],
                                         s["barTime"], s["close"],
                                         meta={"callPrem": s["callPrem"],
                                               "putPrem": s["putPrem"]})
                except Exception:                  # noqa: BLE001
                    logger.exception(
                        "signature: ledger refused fcb %s bar=%r — signal still served",
                        sym, s.get("barTime"))
            payload = {"sym": sym, "version": rules.VERSIONS["fcb"], "signals": signals,
                       "asOf": time.time()}
    except Exception as exc:                       # noqa: BLE001 — see rule 1
        logger.exception("signature: flow-breakout build failed for %s", sym)
        payload = {"sym": sym, "version": rules.VERSIONS["fcb"],
                   "error": f"flow breakout unavailable: {exc}", "asOf": time.time()}
    # Bookkeeping gets a guard of its own: it runs on the same cold path as the
    # build, so a raise HERE is a 500 just the same (rule 1) — and the prune
    # inside _fcb_remember_error is exactly the kind of raise that means.
    try:
        if _fcb_good(payload):
            cache.set(_ck("fcb", sym), payload, ttl=_FCB_TTL_S)
            # Recovery is immediate, not TTL-bound: a good payload pops the
            # negative entry rather than waiting out its 60s.
            with _FCB_NEG_LOCK:
                _FCB_NEG_CACHE.pop(sym, None)
        else:
            _fcb_remember_error(sym, payload)
    except Exception:                              # noqa: BLE001 — see rule 1
        logger.exception("signature: fcb bookkeeping failed for %s", sym)
    return payload


def _fcb_fresh(sym: str) -> dict | None:
    hit = cache.get(_ck("fcb", sym))
    return hit if hit is not None else _fcb_negative_hit(sym)


# ── GEX Walls ───────────────────────────────────────────────────────────────

def _gxw_good(p) -> bool:
    return bool(p and not p.get("error"))


def _gxw_negative_hit(sym: str) -> dict | None:
    """The remembered auth-down envelope — but ONLY when nothing better exists.

    ServeStale checks `fresh()` BEFORE the stale slot, so a negative entry
    returned unconditionally would OUTRANK a perfectly good walls payload
    seconds old — and it would keep doing so, because every request it answered
    skipped the stale path entirely. The only requests that ever saw walls
    would be the ~1-in-60s that fell through on expiry, so during a long outage
    a user with a fine cached overlay would watch it vanish.

    So: peek the stale slot first and stand down if it can still serve. This
    cache is for the COLD herd — the callers who have nothing — and nobody else.
    """
    hit = _GXW_NEG_CACHE.get(sym)
    if not hit:
        return None
    payload, at = hit
    if time.time() - at > _GXW_NEG_TTL_S:
        with _GXW_NEG_LOCK:
            _GXW_NEG_CACHE.pop(sym, None)
        return None
    value, age = _GXW_STALE.peek(sym)
    if value is not None and age is not None and age <= _GXW_STALE.max_age:
        return None                                # a servable payload outranks us
    return payload


def _gxw_remember_error(sym: str, payload: dict) -> None:
    # Locked: the prune below ITERATES the dict, so a concurrent writer would
    # raise "dictionary changed size during iteration" — on the cold path,
    # which is a 500 (rule 1).
    with _GXW_NEG_LOCK:
        _GXW_NEG_CACHE[sym] = (payload, time.time())
        if len(_GXW_NEG_CACHE) > _GXW_NEG_MAX_KEYS:   # bounded: the key is user input
            oldest_first = sorted(_GXW_NEG_CACHE, key=lambda k: _GXW_NEG_CACHE[k][1])
            for key in oldest_first[:-_GXW_NEG_MAX_KEYS]:
                _GXW_NEG_CACHE.pop(key, None)


def _gxw_build(sym: str) -> dict:
    # `asyncio.run` creates a NEW event loop for every build. That is safe
    # today and MUST STAY safe: nothing reachable from `get_gex_data` may touch
    # a module-level asyncio primitive (`schwab_service._CHAIN_SEMAPHORE`,
    # `_TOKEN_REFRESH_LOCK` — created at import and bound to the first loop
    # that awaits them). A cross-loop await raises "attached to a different
    # loop", which arrives here indistinguishable from a Schwab outage: it
    # would be logged as one, negative-cached as one, and chased as one.
    try:
        payload = asyncio.run(fetch_gex_walls(sym))
    except Exception as exc:                       # noqa: BLE001 — see rule 1
        logger.exception("signature: gex walls build failed for %s", sym)
        payload = {"sym": sym.upper(), "levels": [], "version": rules.VERSIONS["gxw"],
                   "error": f"gex walls unavailable: {exc}", "asOf": time.time()}
    # Bookkeeping gets a guard of its own: it runs on the same cold path as the
    # build, so a raise HERE is a 500 just the same (rule 1).
    try:
        if _gxw_good(payload):
            cache.set(_ck("gxw", sym), payload, ttl=rules.GXW_TTL_S)
            # Recovery is immediate, not TTL-bound. NOTE: an empty `levels`
            # list with no error is a NORMAL, healthy state (no wall inside the
            # ±15% band), not a failure — it is cached and remembered.
            with _GXW_NEG_LOCK:
                _GXW_NEG_CACHE.pop(sym, None)
        else:
            _gxw_remember_error(sym, payload)
    except Exception:                              # noqa: BLE001
        logger.exception("signature: gex bookkeeping failed for %s", sym)
    return payload


def _gxw_fresh(sym: str) -> dict | None:
    hit = cache.get(_ck("gxw", sym))
    return hit if hit is not None else _gxw_negative_hit(sym)


# ── the ONE serve path per indicator ────────────────────────────────────────
#
# Factored out so the legacy per-indicator route and the generic `/columns` lane
# hand back the SAME payload from the SAME ServeStale slot and the SAME TTL
# cache. Two entry points computing the same overlay two ways is how a
# genericization ships a silent behaviour change: identical data is what makes
# moving the client onto the lane a routing change rather than a data change.

def _serve_dpl(s: str) -> dict:
    return _DPL_STALE.serve(s, fresh=lambda: cache.get(_ck("dpl", s)),
                            build=lambda: _dpl_build(s), good=_dpl_good)


def _serve_fcb(s: str) -> dict:
    # The negative cache rides the `fresh` slot for the same reason GEX's does:
    # a waiter that queued behind the single-flight build re-checks fresh()
    # inside the lock, so the herd collapses onto the ONE read that just timed
    # out instead of each paying its own 15s.
    return _FCB_STALE.serve(s, fresh=lambda: _fcb_fresh(s),
                            build=lambda: _fcb_build(s), good=_fcb_good)


def _serve_gxw(s: str) -> dict:
    # The negative cache rides the `fresh` slot deliberately: a waiter that
    # queued behind the single-flight build re-checks fresh() inside the lock,
    # so the herd collapses onto the ONE call that just failed instead of each
    # paying its own ~20s timeout.
    return _GXW_STALE.serve(s, fresh=lambda: _gxw_fresh(s),
                            build=lambda: _gxw_build(s), good=_gxw_good)


# ── the generic server lane: tenants ────────────────────────────────────────
#
# ⭐ EVERY TENANT IS A ROW, AND THE LANE HAS NO BRANCH. `registry_defs.serve`
# resolves the definition, validates the inputs, calls the provider and enforces
# the wire contract without naming one of them. A fourth tenant is a row in
# `registry_defs.SERVER_DEFS` plus one `register_provider` call below.
#
# ⚠️ THE PROVIDERS LIVE HERE, IN THE MODULE THAT OWNS THE PAID GATE, not in
# `registry_defs`. A registry definition must never become a way to reach the
# data without the handler — so the data path is only reachable from a module
# whose every route declares `Depends(require_paid)` individually.

def _fetch_bars_for_tf(sym: str, tf: str, count: int = 400) -> list[dict]:
    """Bars at an arbitrary timeframe, for the lane.

    ⛔ `_fetch_bars` IS NOT TOUCHED AND IS NOT RENAMED. `sweep.py` imports it
    (`from api.routers.signature import _fetch_bars`) and the sweep is the only
    ledger writer that runs unattended: moving or renaming it breaks the nightly
    job SILENTLY. `test_the_sweep_still_imports_the_two_router_symbols_it_needs`
    asserts that import, and this function is deliberately additive.
    """
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(sym.upper(), registry_defs.store_tf(tf), int(count))
    out = []
    for r in rows:
        try:
            out.append({"t": int(r[0]), "o": float(r[1]), "h": float(r[2]),
                        "l": float(r[3]), "c": float(r[4]), "v": int(r[5] or 0)})
        except (TypeError, ValueError, IndexError):
            continue
    return out


def _dpl_provider(sym: str, tf: str, inputs: dict) -> dict:
    payload = _serve_dpl(sym)
    # No per-bar column, declared as such in `registry_defs`. `times: []` says
    # "this envelope is not positional" rather than leaving the client to guess.
    return {"columns": {}, "times": [], **payload}


def _gxw_provider(sym: str, tf: str, inputs: dict) -> dict:
    payload = _serve_gxw(sym)
    return {"columns": {}, "times": [], **payload}


def _fcb_provider(sym: str, tf: str, inputs: dict) -> dict:
    """The breakout as EVENT COLUMNS, joined to bars by DATE — plus the markers.

    The signals list is kept in the envelope verbatim so the shipped overlay is
    unchanged; the columns are the same information in the shape the alert
    grammar addresses (a {0, 1, NaN} column per direction, Task 4).
    """
    payload = _serve_fcb(sym)
    bars = _fetch_bars(sym)
    keys = [_bar_date_iso(b["t"]) for b in bars]
    hits = []
    for s in (payload.get("signals") or []):
        iso = _bar_date_iso(s.get("barTime"))
        direction = s.get("direction")
        if iso and direction in ("bull", "bear"):
            hits.append((iso, direction))
    cols = registry_defs.event_columns(keys, hits, ("bull", "bear"))
    return {"columns": cols, "times": [int(b["t"]) for b in bars], **payload}


def _rs_line_provider(sym: str, tf: str, inputs: dict) -> dict:
    """⭐ THE FOURTH TENANT, AND THE PROOF THE LANE IS GENERIC.

    It is not a Signature indicator, shares no code with one, and needed no line
    inside `registry_defs.serve` to be served. It is here because Task 14's
    decision A3 put it on this lane: spec §4's compute contract carries ONE
    `bars` and an RS line needs two, so the second symbol is fetched where a
    second symbol is reachable.

    ⭐ PHASE 2a (unit 2a-14, `compute.rev` 3). Beside the Phase 1 columns the
    v3 envelope carries the Mansfield line and its zero-cross events, and the
    `payload` grows the Leadership readout's scalars (plan §6.6, §7 items 13,
    21-23): `rating` (the nightly IBD-style rating from `rs_history`), `regime`,
    `sensitivity` (the 20-bar RS slope against SPY, RSP and the sector ETF),
    `checks` (the four UCT checks, each a boolean with its reason), `theme`
    (the sector / industry label) and `mansfield`. Every scalar block is built
    by one pure helper below, each of which answers ``None`` WITH A REASON when
    the bars cannot support it, so the readout prints a muted fallback rather
    than a number that was never computable. The flag-off v1 envelope is
    byte-for-byte what Phase 1 shipped.
    """
    from api.services import relative_strength as rsmod
    from api.services import rs_benchmarks
    from api.services.indicator_compute import _round_series

    params = rsmod.resolve_phase1_inputs(inputs)
    params["mansfieldLength"] = _rs_mansfield_length((inputs or {}).get("mansfieldLength"))
    requested = (inputs or {}).get("benchmark") or registry_defs.RS_LINE_BENCHMARKS[0]
    toggles = {k: bool((inputs or {}).get(k, dflt)) for k, dflt in _RS_TOGGLE_DEFAULTS.items()}
    store = registry_defs.store_tf(tf)
    intraday = store not in ("D", "W", "M")
    count = _rs_bars_count(store, params["lookback"])
    rev = int(registry_defs.definition("rsLine")["compute"]["rev"])

    # ⭐ CACHED PER ET SESSION DAY (plan §8.2). The key carries only COMPUTE inputs
    # (`resolve_inputs` already dropped the rest), the resolved timeframe and the
    # EASTERN calendar day — the day a session closes on, not UTC's, which rolls
    # over at 8 pm ET and would split one session's answer across two keys — so a
    # stale answer cannot outlive the session it describes. The TTL (below) runs
    # to the next session close on D/W/M; the day in the key is the floor. The
    # row's `compute.rev` leads the key, so a rev bump is a cold cache by itself.
    #
    # ⭐ AND, ON V2, THE DATA GENERATION (review #16, 2026-11-07). The day alone let
    # an envelope built between ET midnight and the 04:15 rating job / 04:30
    # evidence pull pin the previous session's rating and artifact until 16:05.
    # The newest stored rating session and the artifact's `asof` now sit in the
    # key, so the first request after either job lands is a cold compute. The
    # flag-off (v1) key is unchanged: v1 carries neither block.
    #
    # ⭐ AND THE PAYLOAD SHAPE (visual round VA1, 2026-11-06). Rev 3 is unreleased,
    # so the summaries and the Mansfield-view blanking did not bump it; the shape
    # number in the v2 key keeps an envelope cached before them from being served
    # after them for the rest of the session. The v1 key is unchanged.
    day = _et_session_day()
    gen = f"{_rs_data_generation()}:" if registry_defs.RS_V2_ENABLED else ""
    shape = f"p{_RS_PAYLOAD_SHAPE}" if registry_defs.RS_V2_ENABLED else ""
    ck = _ck(f"rs{rev}{shape}",
             f"{sym.upper()}:{store}:{requested}:{json.dumps(params, sort_keys=True)}:"
             f"{json.dumps(toggles, sort_keys=True)}:{gen}{day}")
    try:
        hit = cache.get(ck)
    except Exception:                                  # noqa: BLE001 — a cache read is bookkeeping
        hit = None
    if hit:
        return hit

    bars = _fetch_bars_for_tf(sym, tf, count)
    bench = rs_benchmarks.resolve_benchmark(sym, requested, tf, count, fetch_bars=_fetch_bars_for_tf)
    times = [int(b["t"]) for b in bars]
    # The STATE the chart should show (plan §6.10), decided here from the data
    # rather than inferred client-side from an empty pane. `same-symbol` and
    # `no-benchmark-bars` blank every derived column: a flat 1.0 ratio against
    # itself would fire a "new high" on every bar (ties count), and a benchmark
    # with no bars has no ratio at all.
    same_symbol = str(bench.get("resolved", "")).upper() == sym.upper()
    no_bench = not bench.get("bars")
    short_history = bool(times) and len(times) < count
    derived = not (same_symbol or no_bench)
    if derived:
        cols = rsmod.compute_phase1_columns(bars, bench["bars"], params, short_history=short_history)
    else:
        cols = {k: [None] * len(times) for k in rsmod.PHASE1_COLUMNS}
    state = ("same-symbol" if same_symbol else "no-benchmark-bars" if no_bench
             else "no-bars" if not times else "intraday" if intraday
             else "short-history" if short_history else "ok")

    if not registry_defs.RS_V2_ENABLED:
        envelope = {"columns": {"rsLine": _round_series(cols["rsLine"], 6)},
                    "times": times, "asOf": time.time()}
    else:
        # ── Phase 2a columns: the Mansfield line and its zero crosses ──────────
        if derived:
            mans = rsmod.compute_mansfield_columns(bars, bench["bars"], params["mansfieldLength"])
        else:
            mans = {k: [None] * len(times) for k in rsmod.PHASE2A_COLUMNS}
        cols["mansfield"] = mans["mansfield"]
        cols["mansfieldCrossUp"] = mans["mansfieldCrossUp"]
        cols["mansfieldCrossDown"] = mans["mansfieldCrossDown"]
        # ⭐ THE CROSS DOT IS A CROSS UP, CENTRED ON THE ZERO LINE (visual round
        # A2, 2026-11-06): one dot at 0 on each bar where the line crosses UP
        # through zero. Crosses down are not drawn (the line falling through the
        # zero guide shows them; the readout names the last cross either way).
        # A value of 0 is NOT `relative_strength.dot_column` (that refuses a
        # non-positive value, the right rule for a ratio), so the chart draws it
        # as the series' own point marker, which paints at any finite value. The
        # `mansfieldCrossUp` / `mansfieldCrossDown` EVENT columns are untouched.
        cols["dotMansfieldCross"] = _rs_zero_cross_dot(mans["mansfield"], mans["mansfieldCrossUp"])
        # The readout's Mansfield scalars are read BEFORE the toggle blanks the
        # column: the reading is true whether or not the line is drawn.
        mansfield_scalars = _rs_mansfield_scalars(mans, params["mansfieldLength"])

        # The data carries the timeframe rule (plan §6.5): on an intraday chart a
        # 252-bar "new high" is two days and means nothing, so events and dots are
        # blank there whatever the chart's visibility settings say.
        blank = [None] * len(times)
        event_keys = ("rsNH", "rsNHpartial", "pxNH", "rsNHbeforePx", "rsNHred", "rsNL", "gor", "rog",
                      "mansfieldCrossUp", "mansfieldCrossDown")
        dot_keys = ("dotNH", "dotNHbeforePx", "dotNHred", "dotNHpartial", "dotNL", "dotMansfieldCross")
        if intraday:
            for k in event_keys + dot_keys:
                cols[k] = list(blank)
        # The dot toggles are compute inputs on purpose: the engine has no
        # per-plot visibility an input can drive, so "off" means the column is
        # blank and the marker draws nothing (plan §4, audit A3). The event
        # columns beside them stay for the screener and the alert lane.
        for toggle, keys in _RS_TOGGLE_BLANKS.items():
            if not toggles[toggle]:
                for k in keys:
                    cols[k] = list(blank)
        for k in ("rsLine", "rsMa") + dot_keys[:5]:
            cols[k] = _round_series(cols[k], 6)      # a RATIO: six places, not four
        for k in ("mansfield", "dotMansfieldCross"):
            cols[k] = _round_series(cols[k], 4)      # a PERCENT distance from its own average

        # The legend and last-high scalars are read HERE, after rounding and
        # BEFORE the Mansfield view blanks the ratio (A2): the RS line and Last RS
        # high rows still print under Mansfield view, because the reading is true
        # whether or not the line is drawn.
        legend = _rs_legend(rsmod.legend_scalars(cols), times, params)
        last_high = _rs_last_high(rsmod.last_rs_high(cols, times), params["lookback"], len(times),
                                  intraday=intraday,
                                  why=(None if derived else
                                       "benchmark is the symbol" if same_symbol else "no benchmark bars"))
        # ⭐ MANSFIELD VIEW (A2): one reading per pane. The ratio, its average,
        # the above flag and every RS-line dot column go all-null in the WIRE
        # (they stay in `columns`, so the definition's exact-match column contract
        # holds) and the Mansfield line draws alone. Event columns stay.
        if toggles["showMansfield"]:
            for k in _RS_MANSFIELD_VIEW_BLANKS:
                cols[k] = list(blank)

        # ── the Leadership scalars (plan §6.6; §7 items 21-23) ───────────────
        groups = rs_benchmarks._groups_for(sym) or {}
        daily = store == "D"
        if not derived:
            why = "benchmark is the symbol" if same_symbol else "no benchmark bars"
            regime = _rs_regime_unavailable(why)
            sensitivity = _rs_sensitivity_unavailable(why)
            checks = _rs_checks_unavailable(why)
        elif not daily:
            why = "daily charts only"
            regime = _rs_regime_unavailable(why)
            sensitivity = _rs_sensitivity_unavailable(why)
            checks = _rs_checks_unavailable(why)
        else:
            # The regime reads the benchmark at a FIXED depth (review #19,
            # 2026-11-07): read at the chart's `count` (lookback + 600) the
            # volatility distribution held ~493 samples at lookback 20 and 756
            # only near 500, so an unrelated new-high setting could flip the label.
            regime = _rs_regime([b.get("c") for b in _rs_regime_bench_bars(sym, requested, tf, count, bench)])
            sensitivity = _rs_sensitivity(sym, bars, bench, tf, count, groups, _fetch_bars_for_tf)
            checks = _rs_checks(bars, bench["bars"], str(bench.get("resolved") or "benchmark"),
                                params["redDayThreshold"])
        payload = {
            "benchmark": dict({k: bench[k] for k in ("requested", "resolved", "label", "fallback")},
                              bars=len(bench.get("bars") or [])),
            "legend": legend,
            "lastRsHigh": last_high,
            "history": {"bars": len(times), "requested": count, "short": short_history},
            "inputs": params,
            "intraday": intraday,
            "state": state,
            "rating": _rs_rating(sym),
            "mansfield": mansfield_scalars,
            "regime": regime,
            "sensitivity": sensitivity,
            "checks": checks,
            "theme": _rs_theme(groups),
            # THE EVIDENCE'S `asof` IS IN THE KEY (review #16, 2026-11-07; it
            # used to ride the day alone, which pinned the previous night's
            # numbers for an envelope cached between ET midnight and the 04:30
            # pull). `_rs_data_generation` reads it through a short in-process
            # memo, so a request pays no stat of its own. `generated_at` is
            # deliberately NOT in the key: it would cold-cache every symbol on
            # every re-publish of the same measurement.
            #
            # The sentence is measured on DAILY bars and says so in sessions
            # (review #7), so it is true on a weekly chart too.
            "evidence": _rs_evidence(),
        }
        envelope = {"columns": cols, "times": times, "asOf": time.time(), "payload": payload}

    # A degraded answer (no benchmark bars yet, nothing for the symbol) is cached
    # for one minute only: the worker may land the missing rows any time, and a
    # six-hour memory of "nothing" would outlive the fix (review finding).
    try:
        if times:
            ttl = 60 if no_bench else (900 if intraday else _seconds_to_next_et_close())
            cache.set(ck, envelope, ttl=ttl)
    except Exception:                                  # noqa: BLE001 — see the DPL cache-write note
        logger.exception("signature: rs cache write failed for %s", sym)
    return envelope


# ── UCT RS Phase 2a (unit 2a-14): the toggles, the dot builder, the scalars ──
#
# Every helper below is PURE over lists and dicts (the one I/O, `_rs_rating`,
# wraps its read in a try and never raises), so `tests/test_rs_columns_provider.py`
# exercises each on synthetic bars. The thresholds are stated once, here, and
# every `reason` string carries the numbers it was decided on, so the readout
# shows the member the fact and not only the verdict.

#: The dot / line toggles and their defaults (JS: `RS_LINE_RAW.inputs`).
_RS_TOGGLE_DEFAULTS: dict[str, bool] = {
    "showNewHigh": True, "showNewHighBeforePrice": True, "shortHistoryDots": True,
    "showRedDay": False, "showNewLow": False, "showMansfield": False,
}
#: Which columns a toggle blanks when OFF. Event columns are never blanked here.
_RS_TOGGLE_BLANKS: dict[str, tuple[str, ...]] = {
    "showNewHigh": ("dotNH",),
    "showNewHighBeforePrice": ("dotNHbeforePx",),
    "shortHistoryDots": ("dotNHpartial",),
    "showRedDay": ("dotNHred",),
    "showNewLow": ("dotNL",),
    "showMansfield": ("mansfield", "dotMansfieldCross"),
}
_RS_SMA_LONG = 200            # the 200-day average (plan §7 item 21; v3 §7.20)
_RS_SMA_SHORT = 50
_RS_TREND_BARS = 504          # two trading years (item 21)
_RS_VOL_WINDOW = 126          # realised-volatility window, sessions (item 21)
_RS_VOL_DIST_MIN = 252        # a year of vol samples before a tercile is claimed
_RS_VOL_DIST_MAX = 756        # three trading years — the distribution the tercile reads against
#: The regime's own benchmark depth, independent of the RS lookback (review #19):
#: the full 756-sample distribution needs 126 + 756 + 1 closes; any deeper read
#: gives the same answer.
_RS_REGIME_BARS = _RS_VOL_WINDOW + _RS_VOL_DIST_MAX + 1
_RS_ANCHOR_WINDOW = 20        # the anchor is the benchmark's lowest close of the last 20 sessions
_RS_PIVOT_RED_DAYS = 10       # pivot speed counts over the last ten red days
_RS_PIVOT_TOP_SHARE = 2.0 / 3.0
_RS_PIVOT_PASS = 5            # at least half of them closed in the top third
_RS_GREEN_ON_RED_WINDOW = 20
#: UCT's chart threshold for the green-on-red check. No screener starter uses 6:
#: the "Up on down days" starter is a looser 3+ scan (saved_screens.py), so a
#: name it features can still fail this check. Unmeasured, like the other checks
#: (review #21, 2026-11-07).
_RS_GREEN_ON_RED_PASS = 6
_RS_PULLBACK_EMA = 8          # pullback distance from the 8-day EMA (v3 §7.20)
#: The v2 payload's shape, in the cache key (bump when a payload field or a
#: wire blanking rule changes inside one `compute.rev`).
_RS_PAYLOAD_SHAPE = 2
#: What Mansfield view blanks in the wire (A2): the ratio, its average, the
#: above flag and every RS-line dot. Event columns are never blanked here.
_RS_MANSFIELD_VIEW_BLANKS: tuple[str, ...] = (
    "rsLine", "rsMa", "rsAbove", "dotNH", "dotNHbeforePx", "dotNHred", "dotNHpartial", "dotNL",
)
_RS_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


# ── copy helpers (visual round A1, 2026-11-06) ───────────────────────────────
#
# Every summary below is a sentence-free fragment in operator voice with no
# trailing period, and the client prints it verbatim. The number rules match
# `readoutSchema.formatReadoutValue` so a figure reads the same in a summary and
# in the card's numbers block: one decimal, a sign on a non-zero percent, never
# "-0.0%"; `today` / `1 bar ago` / `n bars ago`; never "1 bars".

def _rs_plural(n: int, word: str) -> str:
    """``1 bar`` / ``2 bars`` / ``0 bars``."""
    n = int(n)
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def _rs_ago(n: int) -> str:
    """``today`` / ``1 bar ago`` / ``n bars ago`` (the readout's barsAgo rule)."""
    n = int(n)
    return "today" if n == 0 else f"{_rs_plural(n, 'bar')} ago"


def _rs_bar_ymd(t) -> str | None:
    """A bar time (YYYYMMDD key or unix seconds) as ``YYYYMMDD``; None when unreadable."""
    iso = _bar_date_iso(t) if t is not None else ""
    return iso.replace("-", "") if len(iso) == 10 else None


def _rs_short_date(ymd: str | None) -> str | None:
    """``20261104`` → ``Nov 4``."""
    try:
        return f"{_RS_MONTHS[int(ymd[4:6]) - 1]} {int(ymd[6:8])}"
    except (TypeError, ValueError, IndexError):
        return None


def _rs_zero_cross_dot(values, cross_up) -> list:
    """``0.0`` where the Mansfield line crossed UP through zero and has a value,
    else ``None``: the Trend preset's cross dot, centred on the zero guide (A2)."""
    out = [None] * len(values)
    for i, (v, e) in enumerate(zip(values, cross_up)):
        if e == 1.0 and _rs_num(v):
            out[i] = 0.0
    return out


def _rs_legend(leg: dict, times, params: dict) -> dict:
    """`relative_strength.legend_scalars` plus what the RS line row prints (A1,
    A8): ``asOf`` (YYYYMMDD of the bar the scalars were read at, the last bar
    with a finite RS value), ``stale`` (that bar is not the newest one, a
    benchmark gap) and ``summary`` (``above its 21 EMA by 6.8%`` /
    ``below its 50 SMA by 2.1%`` / ``at its 21 EMA``, with `` · as of Nov 4``
    when stale). The length and type are the instance's own."""
    out = dict(leg)
    idx = out.get("index")
    asof = _rs_bar_ymd(times[idx]) if isinstance(idx, int) and 0 <= idx < len(times) else None
    out["asOf"] = asof
    out["stale"] = bool(isinstance(idx, int) and idx < len(times) - 1)
    pct, above = out.get("pctFromMa"), out.get("above")
    summary = None
    if _rs_num(pct) and above is not None:
        avg = f"its {int(params.get('maLength') or 0)} {str(params.get('maType') or '').upper()}"
        mag = f"{abs(pct):.1f}"
        if float(mag) == 0.0:
            summary = f"at {avg}"
        else:
            summary = f"{'above' if above else 'below'} {avg} by {mag}%"
        if out["stale"] and _rs_short_date(asof):
            summary += f" · as of {_rs_short_date(asof)}"
    out["summary"] = summary
    return out


def _rs_last_high(last: dict | None, lookback: int, bars_held: int, *, intraday: bool, why: str | None) -> dict:
    """`relative_strength.last_rs_high`, always a dict, plus ``summary`` (A1):
    ``today · before price`` / ``1 bar ago · before price · red day`` /
    ``38 bars ago`` / ``none in the last 252 bars``. A short history that cannot
    hold a full-lookback high says so (``needs 252 bars (has 180)``); intraday and
    the no-ratio states carry their reason."""
    out = dict(last) if last else {"index": None, "time": None, "beforePrice": None,
                                     "redDay": None, "barsAgo": None}
    if why:
        summary = why
    elif intraday:
        summary = "not read on intraday charts"
    elif last:
        parts = [_rs_ago(last["barsAgo"])]
        if last.get("beforePrice"):
            parts.append("before price")
        if last.get("redDay"):
            parts.append("red day")
        summary = " · ".join(parts)
    elif bars_held < lookback:
        summary = f"needs {_rs_plural(lookback, 'bar')} (has {bars_held})"
    else:
        summary = f"none in the last {_rs_plural(lookback, 'bar')}"
    out["summary"] = summary
    return out


def _rs_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _rs_mansfield_length(raw) -> int:
    from api.services import relative_strength as rsmod
    lo, hi = rsmod.MANSFIELD_LENGTH_RANGE
    try:
        f = float(raw)
    except (TypeError, ValueError):
        f = float(rsmod.DEFAULT_MANSFIELD_LENGTH)
    if not math.isfinite(f):
        f = float(rsmod.DEFAULT_MANSFIELD_LENGTH)
    return int(round(min(float(hi), max(float(lo), f))))


def _rs_mansfield_scalars(mans: dict, length: int) -> dict:
    """The last bar's Mansfield reading in words and numbers.

    Visual round A1 (2026-11-06) adds ``slope`` (1 / -1 / 0 against the bar
    before), ``crossDirection`` + ``lastCross`` (``up, 57 bars ago``; the last
    zero cross in EITHER direction, from the event columns) and ``summary``
    (``+18.7%, above zero, falling``): sign and slope spelled out, because the
    state word ``neutral`` beside +18.7% read as a contradiction. ``stateLabel``
    stays for any reader of the old field."""
    series = mans.get("mansfield") or [None]
    value = series[-1]
    state = (mans.get("mansfieldState") or [None])[-1]
    age = (mans.get("mansfieldCrossBarsAgo") or [None])[-1]
    labels = {1: "bull", -1: "bear", 0: "neutral"}
    slope = None
    if _rs_num(value) and len(series) >= 2 and _rs_num(series[-2]):
        d = float(value) - float(series[-2])
        slope = 1 if d > 0 else (-1 if d < 0 else 0)
    up = mans.get("mansfieldCrossUp") or []
    down = mans.get("mansfieldCrossDown") or []
    direction = cross_ago = None
    for i in range(max(len(up), len(down)) - 1, -1, -1):
        if i < len(up) and up[i] == 1.0:
            direction = "up"
        elif i < len(down) and down[i] == 1.0:
            direction = "down"
        else:
            continue
        cross_ago = max(len(up), len(down)) - 1 - i
        break
    summary = None
    if _rs_num(value):
        text = _rs_pct(float(value))
        where = "at zero" if text == "0.0%" else ("above zero" if value > 0 else "below zero")
        summary = f"{text}, {where}"
        if slope is not None:
            summary += ", " + {1: "rising", -1: "falling", 0: "flat"}[slope]
    return {
        "value": float(value) if _rs_num(value) else None,
        "aboveZero": (value >= 0) if _rs_num(value) else None,
        "state": int(state) if state is not None else None,
        "stateLabel": labels.get(state) if state is not None else None,
        "crossBarsAgo": int(age) if _rs_num(age) else None,
        "length": int(length),
        "slope": slope,
        "crossDirection": direction,
        "lastCross": f"{direction}, {_rs_ago(cross_ago)}" if direction else None,
        "summary": summary,
    }


#: How long one read of the data generation serves (`_rs_data_generation`).
_RS_GEN_TTL_S = 30.0
_RS_GEN_MEMO: dict = {"at": None, "value": None}
_RS_GEN_LOCK = threading.Lock()


def _rs_newest_rating_session():
    """The newest session in `rs_history.TABLE`, by its own PRIMARY KEY read
    (``MAX(session)`` over ``PRIMARY KEY (session, ticker)`` is one b-tree
    seek). Read-only: never creates the table, so a dark pod stays without one;
    a missing table or any failure is None. rs_history.py does not change."""
    try:
        from contextlib import closing
        from api.services.screener import rs_history, snapshot_db
        with closing(snapshot_db.connect()) as conn:
            row = conn.execute(f"SELECT MAX(session) FROM {rs_history.TABLE}").fetchone()
        return row[0] if row else None
    except Exception:                                  # noqa: BLE001 — no table on a dark pod is the normal case
        return None


def _rs_evidence_asof():
    try:
        from api.services import rs_evidence_pull as ep
        art = ep.load_local()
        return art.get("asof") if isinstance(art, dict) else None
    except Exception:                                  # noqa: BLE001
        return None


def _rs_data_generation(now: float | None = None) -> str:
    """``r<newest rating session>|e<evidence asof>`` for the v2 cache key
    (review #16). Memoised in-process for `_RS_GEN_TTL_S` seconds, so a chart
    request pays one SQLite seek and one ``os.stat`` at most twice a minute,
    and a new rating session or artifact is seen within that window. Never
    raises; an unknown part is ``-``."""
    t = time.monotonic() if now is None else float(now)
    with _RS_GEN_LOCK:
        at = _RS_GEN_MEMO["at"]
        if at is not None and 0 <= t - at < _RS_GEN_TTL_S and _RS_GEN_MEMO["value"] is not None:
            return _RS_GEN_MEMO["value"]
    rating = _rs_newest_rating_session()
    asof = _rs_evidence_asof()
    value = f"r{rating if rating is not None else '-'}|e{asof if asof is not None else '-'}"
    with _RS_GEN_LOCK:
        _RS_GEN_MEMO.update(at=t, value=value)
    return value


def _rs_rating(sym: str) -> dict:
    """``{ibd, fast, asof, d5, d20, source}`` from `rs_history.read_fields`.

    ``source`` is ``row`` when the history table holds the symbol, ``dark`` when
    `RS_HISTORY_ENABLED` is off (the table is never written on a dark pod) and
    ``missing`` when it is on and the symbol has no row yet. Never raises and
    never fabricates a number: every value is ``None`` until a row exists.
    """
    out = {"ibd": None, "fast": None, "asof": None, "d5": None, "d20": None, "source": "missing"}
    dark = os.environ.get("RS_HISTORY_ENABLED", "0") != "1"
    row: dict = {}
    try:
        from api.services.screener import rs_history
        row = (rs_history.read_fields([sym]) or {}).get(str(sym or "").upper()) or {}
    except Exception:                                  # noqa: BLE001 — the rating is a garnish, never a 500
        logger.exception("signature: rs rating read failed for %s", sym)
        row = {}
    if row and (row.get("ibd") is not None or row.get("fast") is not None):
        for k in ("ibd", "fast", "d5", "d20"):
            v = row.get(k)
            out[k] = int(v) if _rs_num(v) else None
        out["asof"] = row.get("asof")
        out["source"] = "row"
    else:
        out["source"] = "dark" if dark else "missing"
    out["summary"] = _rs_rating_summary(out["ibd"], out["fast"])
    return out


def _rs_rating_summary(ibd, fast) -> str | None:
    """The Rating row (A1): ``94 · fast 91`` / ``fast 91 · nightly pending`` /
    ``94`` / None when neither exists (the row prints its muted fallback)."""
    if ibd is not None and fast is not None:
        return f"{ibd} · fast {fast}"
    if fast is not None:
        return f"fast {fast} · nightly pending"
    if ibd is not None:
        return f"{ibd}"
    return None


def _rs_evidence() -> dict:
    """``payload.evidence`` (unit 2b-03): what the worker's evidence job measured
    for each readout card's signal, read from the artifact the 04:30 ET pull
    lands at ``<DATA_DIR>/rs_evidence.json`` (`rs_evidence_pull.load_local`,
    one ``os.stat`` per call, parsed once per file).

    ``{asof, horizon, signals: {rsHigh, beforePrice, redDay, phase, mansfield},
    sentence: {same keys}, baseline, source}``. Each ``signals[key]`` is
    `rs_evidence_pull.evidence_for` for the card's signal (`CARD_SIGNALS`:
    rsHigh -> rs_new_high, beforePrice -> rs_new_high_before_price, redDay ->
    rs_new_high_red_day, phase -> rs_cross_up_21ema, mansfield ->
    mansfield_cross_up) at the 63-bar horizon, or None when the artifact is
    absent or carries no block for it. Each ``sentence[key]`` is the card's
    evidence sentence (`rs_evidence_pull.sentence_for`): the measured one, with
    its baseline, when the EFFECTIVE n (events capped by the distinct sessions
    they fell on) clears the artifact's own display floor; what was measured
    and why it is withheld when it does not; `HONESTY_SENTENCE` when the
    artifact has no block for the signal. ``baseline`` is the all-bars
    hit rate the signal is read against. ``source`` is ``artifact`` or ``none``.
    Never raises and never fabricates: absent means every signal None and every
    sentence the honesty line, so a card can point at
    ``scalar:evidence.sentence.<key>`` and always print something true.
    """
    from api.services import rs_evidence_pull as ep
    keys = tuple(ep.CARD_SIGNALS)

    def _empty() -> dict:
        return {"asof": None, "horizon": ep.DEFAULT_HORIZON,
                "signals": {k: None for k in keys},
                "sentence": {k: ep.HONESTY_SENTENCE for k in keys},
                "baseline": None, "source": "none"}

    try:
        art = ep.load_local()
        if not art:
            return _empty()
        signals = {k: ep.evidence_for(name, ep.DEFAULT_HORIZON, art) for k, name in ep.CARD_SIGNALS.items()}
        return {"asof": art.get("asof"), "horizon": ep.DEFAULT_HORIZON,
                "signals": signals,
                "sentence": {k: ep.sentence_for(ev) for k, ev in signals.items()},
                "baseline": ep.baseline_for(ep.DEFAULT_HORIZON, art), "source": "artifact"}
    except Exception:                                  # noqa: BLE001 -- the evidence is a garnish, never a 500
        logger.exception("signature: rs evidence read failed")
        return _empty()


def _rs_theme(groups: dict) -> dict | None:
    """The symbol's sector / industry label from the same map `rs_benchmarks`
    resolves SECTOR through; ``None`` when the map knows nothing. An ETF is
    filed under industry ``Exchange Traded Fund`` by the map's source, so its
    theme says so rather than printing the sector every ETF shares."""
    from api.services import rs_benchmarks
    sector = (groups or {}).get("sector")
    industry = (groups or {}).get("industry")
    if not sector and not industry:
        return None
    if (industry or "") == rs_benchmarks.ETF_INDUSTRY:
        return {"sector": None, "industry": industry, "etf": None,
                "label": "Exchange-traded fund", "note": "symbol is an ETF"}
    etf = rs_benchmarks.SECTOR_ETF.get(sector or "")
    label = industry or sector
    if etf:
        label = f"{label} ({etf})"
    return {"sector": sector, "industry": industry, "etf": etf, "label": label, "note": None}


def _rs_closes(bars) -> list:
    return [float(b["c"]) for b in bars if _rs_num(b.get("c"))]


def _rs_sma_last(values: list, n: int):
    if len(values) < n or n <= 0:
        return None
    return sum(values[-n:]) / n


def _rs_regime_unavailable(reason: str) -> dict:
    """The regime for a chart that cannot have one (a non-daily store, the
    benchmark is the symbol, no benchmark bars). The reason IS the label
    (review #24, 2026-11-07): left None, the readout printed its declared
    "needs more history" fallback on AAPL weekly with 20 years of bars. The
    ``reason`` is None, as on every labelled regime, so the readout does not
    print the same words twice."""
    return {"label": reason, "above200": None, "trend2y": None, "volTercile": None,
            "pctFrom200": None, "return2y": None, "bars": 0, "reason": None}


def _rs_regime_bench_bars(sym: str, requested: str, tf: str, count: int, bench: dict) -> list:
    """The chart benchmark's bars at `_RS_REGIME_BARS` depth, whatever the RS
    lookback (review #19). The bars already in hand serve when they were read at
    least that deep; otherwise the same benchmark is resolved again at the fixed
    depth. Either way the regime reads the last `_RS_REGIME_BARS` closes, so the
    block is identical at every lookback. A failed or mismatched re-read falls
    back to the bars in hand: a shorter regime with its reason, never a 500."""
    have = bench.get("bars") or []
    if count < _RS_REGIME_BARS:
        try:
            from api.services import rs_benchmarks
            deep = rs_benchmarks.resolve_benchmark(sym, requested, tf, _RS_REGIME_BARS,
                                                   fetch_bars=_fetch_bars_for_tf)
            if (str(deep.get("resolved") or "").upper() == str(bench.get("resolved") or "").upper()
                    and len(deep.get("bars") or []) > len(have)):
                have = deep["bars"]
        except Exception:                              # noqa: BLE001 — the regime is a garnish
            logger.exception("signature: rs regime benchmark read failed for %s", sym)
    return list(have[-_RS_REGIME_BARS:])


def _rs_regime(bench_closes: list) -> dict:
    """Plan §7 item 21 over the BENCHMARK's own closes: above / below its
    200-day average, the sign of the 504-bar return, and the 126-session
    realised-volatility tercile against its own trailing three-year distribution.
    ``persistence`` = above the 200-day with a positive two-year trend;
    ``rebound risk`` = negative two-year trend in the high-vol tercile (the
    Daniel-Moskowitz panic state); ``mixed`` otherwise. The label is printed
    verbatim, so it is spelled as words (A1: was ``rebound-risk``). ``label`` is ``None``
    with a ``reason`` while the bars cannot decide it."""
    closes = [float(c) for c in bench_closes if _rs_num(c)]
    n = len(closes)
    out = {"label": None, "above200": None, "trend2y": None, "volTercile": None,
           "pctFrom200": None, "return2y": None, "bars": n, "reason": None}
    reasons: list[str] = []
    sma = _rs_sma_last(closes, _RS_SMA_LONG)
    if sma:
        out["above200"] = closes[-1] > sma
        out["pctFrom200"] = (closes[-1] / sma - 1.0) * 100.0
    else:
        reasons.append(f"needs {_RS_SMA_LONG} bars for the 200-day average (have {n})")
    if n > _RS_TREND_BARS and closes[-1 - _RS_TREND_BARS] > 0:
        r = closes[-1] / closes[-1 - _RS_TREND_BARS] - 1.0
        out["trend2y"] = 1 if r > 0 else (-1 if r < 0 else 0)
        out["return2y"] = r * 100.0
    else:
        reasons.append(f"needs {_RS_TREND_BARS + 1} bars for the two-year trend (have {n})")
    samples = _rs_realised_vol_series(closes, _RS_VOL_WINDOW)
    if len(samples) >= _RS_VOL_DIST_MIN + 1:
        current = samples[-1]
        dist = samples[-1 - _RS_VOL_DIST_MAX:-1]
        below = sum(1 for v in dist if v < current)
        share = below / len(dist)
        out["volTercile"] = "low" if share < 1.0 / 3.0 else ("high" if share >= 2.0 / 3.0 else "mid")
        out["volPct"] = share * 100.0
        out["volSamples"] = len(dist)
    else:
        reasons.append(f"needs {_RS_VOL_WINDOW + _RS_VOL_DIST_MIN + 1} bars for the volatility tercile (have {n})")
    if out["above200"] is not None and out["trend2y"] is not None:
        if out["above200"] and out["trend2y"] > 0:
            out["label"] = "persistence"
        elif out["trend2y"] < 0 and out["volTercile"] == "high":
            out["label"] = "rebound risk"
        elif out["trend2y"] < 0 and out["volTercile"] is None:
            pass                                       # rebound-risk or mixed: the tercile decides
        else:
            out["label"] = "mixed"
    if out["label"] is None:
        out["reason"] = "; ".join(reasons) if reasons else "the volatility tercile is needed to label a down trend"
    return out


def _rs_realised_vol_series(closes: list, window: int) -> list:
    """Annualised realised volatility of log returns over a trailing ``window``,
    one sample per bar once the window is full (population std, sqrt(252))."""
    rets: list[float] = []
    for a, b in zip(closes, closes[1:]):
        rets.append(math.log(b / a) if a > 0 and b > 0 else 0.0)
    if len(rets) < window:
        return []
    out: list[float] = []
    s = sum(rets[:window])
    s2 = sum(r * r for r in rets[:window])
    for i in range(window, len(rets) + 1):
        mean = s / window
        var = max(s2 / window - mean * mean, 0.0)
        out.append(math.sqrt(var) * math.sqrt(252.0))
        if i < len(rets):
            s += rets[i] - rets[i - window]
            s2 += rets[i] * rets[i] - rets[i - window] * rets[i - window]
    return out


def _rs_sensitivity_unavailable(reason: str) -> dict:
    from api.services import relative_strength as rsmod
    return {"window": rsmod.DEFAULT_SENSITIVITY_WINDOW, "spy": None, "rsp": None, "sector": None,
            "reasons": {"spy": reason, "rsp": reason, "sector": reason},
            "legs": {"spy": reason, "rsp": reason, "sector": reason},
            "agree": None, "summary": None}


def _rs_slope_leg(bars, leg_bars, window: int, name: str):
    """``(leg, reason, note)``: the leg, or None with its ``reason`` (the long
    form `reasons` keeps) and its ``note`` (the short form the Agreement summary
    prints after ``<ticker>: ``)."""
    from api.services import relative_strength as rsmod
    rs = rsmod.rs_line(bars, leg_bars)
    if len(rs) < window:
        return (None, f"needs {window} bars of RS against {name} (have {len(rs)})",
                f"needs {_rs_plural(window, 'bar')} (has {len(rs)})")
    tail = rs[-window:]
    if any(v is None for v in tail):
        return None, f"a gap in the last {window} bars against {name}", f"gap in last {_rs_plural(window, 'bar')}"
    slope = rsmod._slope(tail)
    if slope is None:
        return None, f"no slope against {name}", "no slope"
    sign = 1 if slope > 0 else (-1 if slope < 0 else 0)
    return {"sign": sign, "slope": slope, "word": {1: "rising", -1: "falling", 0: "flat"}[sign]}, None, None


def _rs_sensitivity(sym: str, bars, bench: dict, tf: str, count: int, groups: dict, fetch_bars) -> dict:
    """Plan §7 item 22: the sign of the 20-bar RS slope against SPY, RSP and the
    sector ETF. A leg whose benchmark has no bars (or, for an ETF, no sector of
    its own) is ``None`` with its reason; ``agree`` is `benchmark_agree`'s last
    value when all three legs exist. The bars already fetched for the chart's
    own benchmark are reused rather than read twice."""
    from api.services import relative_strength as rsmod
    from api.services import rs_benchmarks
    window = rsmod.DEFAULT_SENSITIVITY_WINDOW
    resolved = str(bench.get("resolved") or "").upper()
    out = {"window": window, "spy": None, "rsp": None, "sector": None, "reasons": {},
           "agree": None, "summary": None}
    #: the short form of a missing leg, ``(label, note)``: ``RSP: no bars``,
    #: ``sector: none for an ETF``. The long ``reasons`` stay as they were.
    notes: dict[str, tuple[str, str]] = {}

    def leg_bars(ticker: str):
        if ticker == resolved and bench.get("bars"):
            return bench["bars"]
        try:
            return fetch_bars(ticker, tf, count) or []
        except Exception:                              # noqa: BLE001 — one missing leg is a reason, not a 500
            logger.exception("signature: rs sensitivity fetch failed for %s", ticker)
            return []

    legs: dict[str, tuple] = {}
    for key, ticker in (("spy", "SPY"), ("rsp", "RSP")):
        lb = leg_bars(ticker)
        if not lb:
            out["reasons"][key] = f"no {ticker} bars"
            notes[key] = (ticker, "no bars")
            continue
        legs[key] = (ticker, lb)
    industry = (groups or {}).get("industry") or ""
    sector = (groups or {}).get("sector")
    etf = rs_benchmarks.SECTOR_ETF.get(sector or "")
    if industry == rs_benchmarks.ETF_INDUSTRY:
        out["reasons"]["sector"] = "symbol is an ETF"
        notes["sector"] = ("sector", "none for an ETF")
    elif not etf:
        out["reasons"]["sector"] = "no sector" if not sector else f"sector not mapped: {sector}"
        notes["sector"] = ("sector", "none known" if not sector else f"{sector} not mapped")
    else:
        lb = leg_bars(etf)
        if not lb:
            out["reasons"]["sector"] = f"no {etf} bars"
            notes["sector"] = (etf, "no bars")
        else:
            legs["sector"] = (etf, lb)
    series: dict[str, list] = {}
    for key, (ticker, lb) in legs.items():
        leg, why, note = _rs_slope_leg(bars, lb, window, ticker)
        if leg is None:
            out["reasons"][key] = why
            notes[key] = (ticker, note)
            continue
        leg["ticker"] = ticker
        out[key] = leg
        series[key] = rsmod.rs_line(bars, lb)
    if all(k in series for k in ("spy", "rsp", "sector")):
        agree = rsmod.benchmark_agree(series["spy"], series["rsp"], series["sector"], window)[-1]
        out["agree"] = (agree == 1.0) if agree is not None else None
    # The Agreement card's numbers block, one value per leg (A1): SPY
    # ``rising`` / RSP ``no bars`` / Sector ``XLK rising`` or ``none for an ETF``.
    out["legs"] = {k: ((out[k]["word"] if k != "sector" else f"{out[k]['ticker']} {out[k]['word']}")
                       if out[k] else (notes[k][1] if k in notes else out["reasons"].get(k)))
                   for k in ("spy", "rsp", "sector")}
    out["summary"] = _rs_sensitivity_summary(out, notes)
    return out


def _rs_and(names: list) -> str:
    """``SPY`` / ``SPY and XLK`` / ``SPY, RSP and XLK``."""
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _rs_sensitivity_summary(out: dict, notes: dict) -> str | None:
    """The Agreement row (A1): ``SPY, RSP and XLK all rising`` /
    ``split: SPY rising, RSP falling, XLK rising`` / ``SPY and XLK rising; RSP:
    no bars``. Legs that share one word are grouped; a missing leg follows a
    semicolon as ``<ticker>: <short reason>``."""
    keys = ("spy", "rsp", "sector")
    present = [k for k in keys if out[k]]
    missing = [f"{notes[k][0]}: {notes[k][1]}" for k in keys if not out[k] and k in notes]
    if not present:
        return "; ".join(missing) or None
    words = {out[k]["word"] for k in present}
    names = [out[k]["ticker"] for k in present]
    if len(words) == 1:
        word = words.pop()
        head = f"{_rs_and(names)} all {word}" if len(names) == 3 else f"{_rs_and(names)} {word}"
    else:
        head = "split: " + ", ".join(f"{out[k]['ticker']} {out[k]['word']}" for k in present)
    return "; ".join([head] + missing)


def _rs_checks_unavailable(reason: str) -> dict:
    """The checks for a chart that cannot run them. ``summary`` carries the
    reason (review #24), so the readout never shows its "needs more history"
    fallback for a known reason; each check keeps it too."""
    blank = {"pass": None, "reason": reason, "line": reason}
    return {"ma": dict(blank), "anchor": dict(blank), "pivotSpeed": dict(blank), "greenOnRed": dict(blank),
            "pullbackEma8": None, "passed": 0, "of": 0, "summary": reason}


def _rs_pct(v) -> str:
    """One decimal, a sign on a non-zero value, never ``-0.0%`` (the readout's
    ``pct`` rule, so a number reads the same on the server and the client)."""
    s = f"{v:.1f}"
    if float(s) == 0.0:
        return "0.0%"
    return f"+{s}%" if v > 0 else f"{s}%"


def _rs_check_line(check: dict) -> str:
    """A check's card line (A1): ``pass · <reason>`` / ``fail · <reason>``, or the
    reason alone while the check is undecided. Pass and fail are words."""
    p = check.get("pass")
    reason = check.get("reason") or ""
    return reason if p is None else f"{'pass' if p else 'fail'} · {reason}"


def _rs_checks(bars, bench_bars, bench_name: str, red_day_pct: float) -> dict:
    """Plan §7 item 23 (v3 §7.20), the four UCT checks as booleans with reasons:

    * ``ma``         the stock's distance from its 200-day average beats the
                     benchmark's (the 50-day pair is reported beside it);
    * ``anchor``     from the benchmark's lowest close of the last 20 sessions,
                     the stock has returned more than the benchmark;
    * ``pivotSpeed`` at least 5 of the last 10 red days closed in the top
                     third of their range;
    * ``greenOnRed`` at least 6 of the last 20 sessions were up on a red day.

    ``pullbackEma8`` (distance from the 8-day EMA) rides beside them as a number.
    A check the bars cannot answer is ``pass: None`` with the reason.
    """
    from api.services import relative_strength as rsmod
    from api.services.indicator_compute import compute_ema
    out: dict = {}
    c = _rs_closes(bars)
    bc = _rs_closes(bench_bars)
    n = len(c)

    # ma
    s200, b200 = _rs_sma_last(c, _RS_SMA_LONG), _rs_sma_last(bc, _RS_SMA_LONG)
    s50, b50 = _rs_sma_last(c, _RS_SMA_SHORT), _rs_sma_last(bc, _RS_SMA_SHORT)
    if s200 and b200:
        sd, bd = (c[-1] / s200 - 1.0) * 100.0, (bc[-1] / b200 - 1.0) * 100.0
        ma = {"pass": sd > bd, "stock200": sd, "bench200": bd,
              "reason": f"stock {_rs_pct(sd)} vs its 200-day, {bench_name} {_rs_pct(bd)}"}
        if s50 and b50:
            ma["stock50"] = (c[-1] / s50 - 1.0) * 100.0
            ma["bench50"] = (bc[-1] / b50 - 1.0) * 100.0
    else:
        ma = {"pass": None, "reason": f"needs {_RS_SMA_LONG} bars of both (have {n} and {len(bc)})"}
    out["ma"] = ma

    # anchor: the benchmark's lowest close of the last 20 sessions, on the stock's calendar
    aligned = rsmod.benchmark_closes_aligned(bars, bench_bars)
    window = [(i, aligned[i]) for i in range(max(0, len(bars) - _RS_ANCHOR_WINDOW), len(bars))
              if aligned[i] is not None and _rs_num(bars[i].get("c"))]
    if len(window) >= 2 and aligned[-1] is not None and _rs_num(bars[-1].get("c")):
        a, _ = min(window, key=lambda p: p[1])
        sr = (float(bars[-1]["c"]) / float(bars[a]["c"]) - 1.0) * 100.0
        br = (aligned[-1] / aligned[a] - 1.0) * 100.0
        ago = len(bars) - 1 - a
        if ago == 0:
            # The low is TODAY (review #13, 2026-11-07): both returns are +0.0%,
            # and `sr > br` would score a FAIL on exactly the selloff days the
            # check is meant for. Undecided, with the reason, and out of the count.
            out["anchor"] = {"pass": None, "stock": sr, "bench": br, "anchorTime": bars[a].get("t"),
                             "barsAgo": 0,
                             "reason": f"{bench_name}'s {_RS_ANCHOR_WINDOW}-session low is today"}
        else:
            # A1: the value no longer opens with its label's words ("Since the
            # low"), and "1 bars ago" is "1 bar ago".
            out["anchor"] = {"pass": sr > br, "stock": sr, "bench": br, "anchorTime": bars[a].get("t"),
                             "barsAgo": ago,
                             "reason": f"stock {_rs_pct(sr)}, {bench_name} {_rs_pct(br)}; low was {_rs_ago(ago)}"}
    else:
        out["anchor"] = {"pass": None, "reason": f"needs {_RS_ANCHOR_WINDOW} sessions of both"}

    # pivot speed over the last ten red days
    red = rsmod.red_day_column(rsmod.pct_change(aligned), red_day_pct)
    hits = 0
    seen = 0
    for i in range(len(bars) - 1, -1, -1):
        if red[i] != 1.0:
            continue
        b = bars[i]
        h, l, cl = b.get("h"), b.get("l"), b.get("c")
        if not (_rs_num(h) and _rs_num(l) and _rs_num(cl)):
            continue
        seen += 1
        if h > l and (cl - l) / (h - l) >= _RS_PIVOT_TOP_SHARE:
            hits += 1
        if seen == _RS_PIVOT_RED_DAYS:
            break
    if seen == _RS_PIVOT_RED_DAYS:
        out["pivotSpeed"] = {"pass": hits >= _RS_PIVOT_PASS, "count": hits, "of": seen,
                             "reason": f"{hits} of the last {seen} red days closed in the top third"}
    else:
        out["pivotSpeed"] = {"pass": None, "count": hits, "of": seen,
                             "reason": f"only {_rs_plural(seen, 'red day')} in {_rs_plural(len(bars), 'bar')} "
                                       f"(needs {_RS_PIVOT_RED_DAYS})"}

    # green on red over the last twenty sessions
    stock_chg = rsmod.pct_change([float(b["c"]) if _rs_num(b.get("c")) else None for b in bars])
    gor = rsmod.both(red, rsmod.up_day_column(stock_chg))
    cnt = rsmod.rolling_count(gor, _RS_GREEN_ON_RED_WINDOW)[-1] if gor else None
    if cnt is not None:
        k = int(cnt)
        # The denominator is the RED DAYS in the window, counted on the same
        # 20 sessions (review #8, 2026-11-07): "3 of the last 20 red days" read a
        # true 3-of-4 as a weak 3-of-20. `of` stays the window, as the Checks card
        # and `green_on_red_20` describe it.
        reds = rsmod.rolling_count(red, _RS_GREEN_ON_RED_WINDOW)[-1]
        red_days = int(reds) if reds is not None else None
        where = f"in the last {_RS_GREEN_ON_RED_WINDOW} sessions"
        # A1 pluralisation: the noun follows the count it sits beside.
        if red_days == 0:
            reason = f"no red days {where}"
        elif red_days is not None:
            reason = f"up on {k} of {_rs_plural(red_days, 'red day')} {where}"
        else:
            reason = f"up on {_rs_plural(k, 'red day')} {where}"
        out["greenOnRed"] = {"pass": k >= _RS_GREEN_ON_RED_PASS, "count": k, "of": _RS_GREEN_ON_RED_WINDOW,
                             "redDays": red_days, "reason": reason}
    else:
        out["greenOnRed"] = {"pass": None, "reason": f"needs {_RS_GREEN_ON_RED_WINDOW + 1} sessions of both"}

    # pullback distance from the 8-day EMA
    pull = None
    if n >= _RS_PULLBACK_EMA:
        e = compute_ema(c, _RS_PULLBACK_EMA)[-1]
        if _rs_num(e) and e != 0:
            pull = (c[-1] / e - 1.0) * 100.0
    out["pullbackEma8"] = pull

    decided = [out[k]["pass"] for k in ("ma", "anchor", "pivotSpeed", "greenOnRed") if out[k]["pass"] is not None]
    out["passed"] = sum(1 for p in decided if p)
    out["of"] = len(decided)
    out["summary"] = f"{out['passed']} of {out['of']} pass" if decided else None
    for k in ("ma", "anchor", "pivotSpeed", "greenOnRed"):
        out[k]["line"] = _rs_check_line(out[k])
    return out

def _et_now():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York"))


def _et_session_day() -> str:
    """The Eastern calendar day — the day a session closes on."""
    return _et_now().strftime("%Y-%m-%d")


def _seconds_to_next_et_close(close_hour: int = 16, close_minute: int = 5) -> int:
    """Seconds until the next 16:05 ET (five minutes after the cash close, when the
    day's bars have settled). Weekends roll to the next weekday; the result is at
    least 60 and at most three days, so a holiday never pins an answer for a week."""
    from datetime import timedelta
    now = _et_now()
    target = now.replace(hour=close_hour, minute=close_minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    while target.weekday() >= 5:
        target += timedelta(days=1)
    return int(max(60, min((target - now).total_seconds(), 3 * 24 * 3600)))


def _rs_bars_count(store_tf: str, lookback: int) -> int:
    """How many bars the RS lane reads (plan §8.2): the lookback plus two and a
    half years of dot history on a daily chart, the lookback plus 200 on weekly
    and monthly, the lane's usual 400 intraday. Measured on master: the old fixed
    400 left ~7 months of dots behind a 252-bar lookback."""
    if store_tf == "D":
        return int(lookback) + 600
    if store_tf in ("W", "M"):
        return int(lookback) + 200
    return 400


registry_defs.register_provider("uct-darkpool-levels", _dpl_provider)
registry_defs.register_provider("uct-gex-walls", _gxw_provider)
registry_defs.register_provider("uct-flow-breakout", _fcb_provider)
registry_defs.register_provider("rsLine", _rs_line_provider)


# ── routes (all sync `def` — see rule 3) ────────────────────────────────────

@router.get("/darkpool-levels")
def darkpool_levels(sym: str = Query(...), _user: dict = Depends(require_paid)):
    s = _sym_or_422(sym)
    return _serve_dpl(s)


@router.get("/flow-breakout")
def flow_breakout(sym: str = Query(...), _user: dict = Depends(require_paid)):
    s = _sym_or_422(sym)
    return _serve_fcb(s)


@router.get("/gex-walls")
def gex_walls(sym: str = Query(...), _user: dict = Depends(require_paid)):
    s = _sym_or_422(sym)
    return _serve_gxw(s)


@router.get("/definitions")
def server_definitions(_user: dict = Depends(require_paid)):
    """The server-lane definitions, as data.

    Published so the chart addresses an indicator by its DEFINITION ID rather
    than by a path it hardcodes — the whole point of the genericization. It
    carries no market data, but it is gated like everything else here: the
    definitions describe a premium surface, and a route in this module without
    its own `Depends(require_paid)` is the shape `test_a_free_user_is_refused_on_
    every_route` exists to catch.
    """
    return {"schemaVersion": registry_defs.SCHEMA_VERSION,
            "definitions": registry_defs.list_definitions()}


@router.get("/columns")
def server_columns(
    defId: str = Query(..., description="a server-lane definition id"),
    sym: str = Query(...),
    tf: str = Query("D"),
    inputs: str = Query("", description="JSON object of instance inputs"),
    _user: dict = Depends(require_paid),
):
    """THE GENERIC COLUMN LANE — `compute.kind: 'server'`, resolved.

    Wire format: `columns` is a mapping of key to a JSON ARRAY of numbers and
    `null`, positionally aligned to `times`. `null` ⇄ NaN is mapped at the client
    boundary. **Compute never emits point objects** — `registry_defs.wire_columns`
    refuses `[{time, value}]` by name.
    """
    s = _sym_or_422(sym)
    try:
        parsed = json.loads(inputs) if inputs else {}
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="inputs must be a JSON object")
    if parsed is not None and not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail="inputs must be a JSON object")
    try:
        return registry_defs.serve(defId, s, str(tf or "D"), parsed)
    except registry_defs.DefinitionNotOffered as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except registry_defs.InputRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except (registry_defs.DefinitionHasNoProvider,
            registry_defs.ColumnContractViolation):
        # Rule 1: a build must not 500 a user's chart. Both of these are OUR
        # defect, not the user's, so they are logged with a traceback and the
        # response is an envelope the client draws nothing from — never a 500,
        # and never a payload that could be remembered as good.
        logger.exception("signature: server lane failed for %s/%s", defId, s)
        return {"defId": defId, "sym": s, "tf": tf, "columns": {}, "times": [],
                "error": "server lane unavailable", "asOf": time.time()}


# ── Dark-Pool Reclaim Confluence (dpc-v1) ───────────────────────────────────
_DPC_TTL_S = 300

# The fourth stale slot, and the reason the other three have one: without it
# every request that misses the TTL rebuilds, and `/confluence` costs a full
# flow read (up to `_FLOW_READ_BUDGET_S`) on an anyio worker. Same 30 minutes as
# dpl and fcb — dpc is a daily closed-bar rule, so nothing inside that window
# can change its answer.
_DPC_STALE = ServeStale("sig_dpc", max_age_seconds=1800)

# ── what bounds /confluence-scan ────────────────────────────────────────────
#
# 🔴 IT WAS A TEN-MINUTE REQUEST. The scan looped up to 40 symbols through
# `_dpc_cached` → `_fetch_flow_by_date`, with no serve-stale and no pacing, so a
# fully cold list was bounded only by 40 × `_FLOW_READ_BUDGET_S` = **600 s on a
# single anyio worker**. The web pod is ONE uvicorn process with ONE event loop
# and ONE 64-slot threadpool shared by every user; a request that can hold a
# worker for ten minutes is the 2026-07-01 524 class
# (`incident_524_single_process_overload`), and it took only a handful of
# concurrent scans to reproduce it.
#
# Four bounds, each doing a different job:
#
# 1. `_DPC_SCAN_BUDGET_S` — a WALL-CLOCK budget for the cold half of one scan.
#    A cold build is only STARTED while the budget is unspent, and a build is
#    itself bounded by `_FLOW_READ_BUDGET_S`, so worst-case occupancy is
#    `_DPC_SCAN_BUDGET_S + _FLOW_READ_BUDGET_S` — 25 s, not 600.
# 2. `_DPC_COLD_LANE` — at most this many anyio workers may be inside a cold
#    confluence build AT ONCE, across every caller. 2 of 64 is ~3 %: a MINORITY
#    of the shared budget, which is the correction
#    `lesson_bulk_job_starves_a_shared_rate_budget` asks for. Acquisition is
#    NON-BLOCKING on purpose — queueing for the slot would rebuild exactly the
#    pile-up the semaphore exists to prevent.
# 3. `_DPC_COLD_PACE_S` — a lane-wide minimum interval between two cold builds,
#    so the two permitted workers cannot machine-gun the flow surface either.
# 4. The warmer — whatever the budget did not reach is finished by ONE
#    background thread at a slower pace, so the NEXT scan of the same list is
#    served from the cache. That is stale-while-revalidate applied to a batch:
#    the point is that a USER is never the one who rebuilds.
#
# ⛔ AND THE PART THAT IS NOT ABOUT LATENCY: a symbol the budget did not reach
# is reported in `pending`, NEVER as a symbol with no signal. An unpaced sweep
# on this project once raced through a rate-limit cooldown reading empty and
# REPORTED SUCCESS; an empty read you did not make looks exactly like a quiet
# tape. `complete` and `pending` are how this surface refuses to make that
# mistake, and a pending symbol is retried by the next scan rather than
# remembered.
_DPC_SCAN_MAX_SYMS = 40
_DPC_SCAN_BUDGET_S = 10.0
_DPC_COLD_LANE_SLOTS = 2
_DPC_COLD_PACE_S = 0.25
_DPC_WARM_PACE_S = 1.0
_DPC_WARM_MAX_QUEUE = 200

_DPC_COLD_LANE = threading.BoundedSemaphore(_DPC_COLD_LANE_SLOTS)
_DPC_PACE_LOCK = threading.Lock()
_DPC_PACE_NEXT_AT = 0.0
_DPC_WARM_LOCK = threading.Lock()
_DPC_WARM_QUEUE: list[str] = []
_DPC_WARM_RUNNING = False


def _dpc_good(p) -> bool:
    return bool(p and p.get("ok"))


def _dpc_fresh(s: str) -> dict | None:
    return cache.get(_ck("dpc", s))


def _dpc_build(sym: str) -> dict:
    """Dark-pool levels + daily bars + flow → reclaim-confluence signals.
    Never raises (rule 1): a failed build returns an envelope, never poisons a
    cache and never 500s a request.

    ⛔ A FAILED FLOW READ IS NOT AN EMPTY TAPE, AND THIS IS WHERE THAT WAS
    BEING LOST. The read used to be `_fetch_flow_by_date(...) or {}`, and
    `_fetch_flow_by_date` returns **None** for a failure precisely so the caller
    can tell the two apart — its whole docstring is about that. Collapsing None
    to `{}` handed `confluence.evaluate` an empty join, which found nothing,
    which returned `ok: True, signals: []`, which was **cached for 300 s and
    remembered as good**. So a flow outage published "no confluence anywhere"
    as a successful answer for five minutes — `lesson_market_cap_cache_poison`
    exactly, and invisible, because a quiet tape looks the same.
    """
    try:
        from api.services.signature import confluence
        levels = fetch_dp_levels(sym).get("levels", [])
        bars = _fetch_bars(sym, 60)
        cutoff = _bar_date_iso(bars[0]["t"]) if bars else ""
        by_date = _fetch_flow_by_date(sym, cutoff)
        if by_date is None:
            logger.warning("signature: confluence flow read failed for %s — refusing to "
                           "score it as a quiet tape", sym)
            return {"ok": False, "sym": sym, "signals": [],
                    "error": "flow unavailable", "asOf": time.time()}
        signals = confluence.evaluate(levels, bars, by_date)
        payload = {"ok": True, "sym": sym, "signals": signals, "levels": levels,
                   "close": (bars[-1]["c"] if bars else None),
                   "asOf": time.time(), "version": rules.VERSIONS["dpc"]}
    except Exception:                                  # noqa: BLE001
        logger.exception("signature: confluence build failed for %s", sym)
        return {"ok": False, "sym": sym, "signals": [], "error": "build failed"}
    # Bookkeeping gets its own guard, the shape the other three builds use: it
    # runs on the same cold path, so a raise HERE is a 500 just the same
    # (rule 1).
    try:
        cache.set(_ck("dpc", sym), payload, ttl=_DPC_TTL_S)
    except Exception:                                  # noqa: BLE001
        logger.exception("signature: dpc cache write failed for %s", sym)
    return payload


def _dpc_cached(s: str) -> dict:
    """One symbol, serve-stale + single-flight — the shape the other three use.

    A herd of cold callers collapses onto ONE build instead of each paying its
    own flow read, and a caller arriving after the 300 s TTL lapses is served
    the last good payload while the refresh happens behind it. Neither the TTL
    nor the stale window was widened to get this: the treadmill was that there
    was no stale slot at all.
    """
    return _DPC_STALE.serve(s, fresh=lambda: _dpc_fresh(s),
                            build=lambda: _dpc_build(s), good=_dpc_good)


def _dpc_ready(s: str) -> dict | None:
    """The answer we ALREADY hold for this symbol, or None. **Never builds.**

    This is what makes the scan's first pass free: a warm symbol costs a dict
    lookup, so the wall-clock budget is spent only on symbols that genuinely
    have no answer. Reads both tiers in the same order `ServeStale.serve` does —
    the TTL cache, then a stale slot still inside its window — so a symbol the
    scan reports as answered is exactly a symbol `/confluence` would answer
    without building.
    """
    hit = _dpc_fresh(s)
    if hit is not None:
        return hit
    value, age = _DPC_STALE.peek(s)
    if value is not None and age is not None and age <= _DPC_STALE.max_age:
        return value
    return None


def _dpc_pace() -> None:
    """Hold the lane's minimum interval between two cold builds.

    Lane-wide, not per-request: two scans that know nothing about each other
    still take turns. The next slot is RESERVED under the lock and the sleep
    happens outside it, so N waiters serialise into N × pace rather than all
    sleeping the same interval and firing together.
    """
    global _DPC_PACE_NEXT_AT
    now = time.monotonic()
    with _DPC_PACE_LOCK:
        wait = max(_DPC_PACE_NEXT_AT - now, 0.0)
        _DPC_PACE_NEXT_AT = now + wait + _DPC_COLD_PACE_S
    if wait > 0:
        time.sleep(wait)


def _dpc_cold(s: str) -> dict | None:
    """Build ONE symbol inside the lane's slot budget, or **None: not built**.

    None is not a failure and is not an empty result — it is "this symbol was
    not evaluated", which the caller must report as `pending`. Scoring it as a
    quiet tape is the failure mode this whole lane is shaped around.
    """
    if not _DPC_COLD_LANE.acquire(blocking=False):
        return None
    try:
        _dpc_pace()
        return _dpc_cached(s)
    finally:
        _DPC_COLD_LANE.release()


def _dpc_warm_loop() -> None:
    global _DPC_WARM_RUNNING
    try:
        while True:
            with _DPC_WARM_LOCK:
                if not _DPC_WARM_QUEUE:
                    return
                sym = _DPC_WARM_QUEUE.pop(0)
            try:
                if _dpc_cold(sym) is None:
                    # The lane was full. Put it back at the END so a symbol that
                    # cannot get a slot never spins in front of the queue.
                    with _DPC_WARM_LOCK:
                        _DPC_WARM_QUEUE.append(sym)
            except Exception:                          # noqa: BLE001
                logger.exception("signature: dpc warm failed for %s", sym)
            time.sleep(_DPC_WARM_PACE_S)
    finally:
        # Safe to clear unconditionally: the flag is set under the lock BEFORE
        # this thread is started and only ever by the starter, so exactly one
        # thread owns it at a time and that thread is this one
        # (`lesson_cleanup_must_verify_ownership` — ownership here is
        # structural, not assumed).
        with _DPC_WARM_LOCK:
            _DPC_WARM_RUNNING = False


def _dpc_queue_warm(syms) -> None:
    """Hand the symbols the scan could not reach to ONE background warmer.

    One thread for the whole lane, however many scans ask — the alternative is
    a thread per scan, i.e. the fan-out this module just removed, moved off the
    request path where nothing bounds it at all.
    """
    global _DPC_WARM_RUNNING
    start = False
    with _DPC_WARM_LOCK:
        for s in syms:
            if s not in _DPC_WARM_QUEUE and len(_DPC_WARM_QUEUE) < _DPC_WARM_MAX_QUEUE:
                _DPC_WARM_QUEUE.append(s)
        if _DPC_WARM_QUEUE and not _DPC_WARM_RUNNING:
            _DPC_WARM_RUNNING = True
            start = True
    if start:
        threading.Thread(target=_dpc_warm_loop, daemon=True,
                         name="sig-dpc-warm").start()


def _dpc_scan(syms: list[str]) -> dict:
    """The bounded scan. Warm symbols first, then cold ones while the budget
    lasts, then hand the rest to the warmer and SAY SO.

    Two passes rather than one loop, and the order is load-bearing: a warm
    symbol must never lose its answer to a budget that an earlier cold symbol
    spent. Scanning `[cold, warm]` in one pass would drop the warm one.
    """
    deadline = time.monotonic() + _DPC_SCAN_BUDGET_S
    hits: list[dict] = []
    evaluated: list[str] = []
    cold: list[str] = []
    pending: list[str] = []

    def _take(sym: str, payload: dict) -> None:
        evaluated.append(sym)
        for sig in (payload.get("signals") or []):
            hits.append({"sym": sym, **sig})

    for s in syms:
        payload = _dpc_ready(s)
        if payload is None:
            cold.append(s)
        else:
            _take(s, payload)

    for s in cold:
        if time.monotonic() >= deadline:
            pending.append(s)
            continue
        payload = _dpc_cold(s)
        if payload is None or not _dpc_good(payload):
            pending.append(s)
            continue
        _take(s, payload)

    if pending:
        logger.info("signature: confluence scan answered %d/%d symbols in its %.0fs "
                    "budget; %d handed to the warmer", len(evaluated), len(syms),
                    _DPC_SCAN_BUDGET_S, len(pending))
        _dpc_queue_warm(pending)

    hits.sort(key=lambda h: h["score"], reverse=True)
    return {"ok": True, "scanned": len(syms), "evaluated": len(evaluated),
            "pending": pending, "complete": not pending,
            "count": len(hits), "signals": hits, "asOf": time.time()}


@router.get("/confluence")
def confluence_signal(sym: str = Query(...), _user: dict = Depends(require_paid)):
    """Dark-Pool Reclaim Confluence for ONE symbol: does price reclaim (bull) /
    lose (bear) a dark-pool level on a daily CLOSE and HOLD, with confirming
    call/put flow, within the proximity band. 300s TTL-cached. Runs on WEB
    (dark-pool DB local + flow via proxy + bars local)."""
    s = _sym_or_422(sym)
    return _dpc_cached(s)


@router.get("/confluence-scan")
def confluence_scan(
    syms: str = Query(...,
                      description=f"comma-separated tickers to scan "
                                  f"(<={_DPC_SCAN_MAX_SYMS})"),
    _user: dict = Depends(require_paid),
):
    """Batch the reclaim-confluence over a provided ticker list — returns ONLY
    names with a live signal, ranked by score.

    ⏱️ BOUNDED. Symbols already answered are free; the cold ones are built
    inside `_DPC_SCAN_BUDGET_S`, two at a time across the whole pod, paced —
    so this request can occupy a worker for at most
    `_DPC_SCAN_BUDGET_S + _FLOW_READ_BUDGET_S`, not `40 × _FLOW_READ_BUDGET_S`.

    📋 READ `pending` AND `complete`, NOT JUST `signals`. Anything the budget
    did not reach is named in `pending` and handed to a background warmer, so
    a second call moments later is complete and instant. An empty `signals`
    with a non-empty `pending` means "not looked at yet" — it does NOT mean
    "no confluence anywhere", and treating the two as one answer is the exact
    mistake this endpoint used to make on every flow hiccup.

    `scanned` is how many VALID tickers were asked for; `evaluated` is how many
    actually produced an answer. A ticker `_SYM_RE` rejects is dropped here
    exactly as it always was, and now it is dropped before `scanned` counts it
    rather than after — a symbol that could never be scanned was never a scan.

    🔴 PROTOTYPE, AND IT IS A DECISION NOW — SPEC §11 ROW **D-A8** (2026-08-08).
    ⛔ BEFORE YOU OPTIMISE THIS AGAIN: **no member can call it.** The string
    `confluence` occurs nowhere under `app/`, and two commits of performance work
    have already been spent on a request nobody makes. That was audited
    (`audit-not-wired` finding 4), the server lane was MEASURED as a home for it,
    and it does not fit: `confluence.evaluate` scores `bars[-1]` — one
    current-state verdict whose signal carries no `barTime` — so there is nothing
    `registry_defs.event_columns` can key a column on, and this endpoint answers
    about a LIST of tickers, which is a screener contract and not a chart one.
    The reasoning, including why synthesising the history would be cheap and
    dishonest, is in the spec row; `tests/test_confluence_prototype.py` makes the
    measurement executable and will go RED if a `dpc` definition ever joins
    `registry_defs.SERVER_DEFS` while that row still says "not wired".

    Pass your unusual-DP watchlist; the auto-universe (DP-unusual ∩ notable-flow)
    scanner is the follow-up, and it is a SURFACE, not another lane.
    """
    raw, seen = [], set()
    for t in (syms or "").split(","):
        u = t.strip().upper()
        if u and u not in seen:
            seen.add(u)
            raw.append(u)
    raw = raw[:_DPC_SCAN_MAX_SYMS]
    valid = []
    for u in raw:
        try:
            valid.append(_sym_or_422(u))
        except HTTPException:
            continue
    return _dpc_scan(valid)
