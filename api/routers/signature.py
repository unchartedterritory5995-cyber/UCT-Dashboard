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
from api.services.signature.flow_breakout import _bar_date_iso, fcb_signals, flow_by_date
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


def _read_flow_source(sym: str, source: str, cutoff_iso: str) -> dict[str, list[dict]] | None:
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

    **No credential is forwarded.** `/api/flow/ticker/{symbol}` declares no auth
    dependency on either service, so sending the caller's session cookie to an
    env-configurable base URL would buy nothing and hand a live credential to
    whatever `_flow_base_url()` happens to resolve to.
    """
    url = f"{_flow_base_url()}/api/flow/ticker/{sym}"
    try:
        with httpx.stream("GET", url, params={"source": source}, timeout=15.0) as resp:
            if resp.status_code != 200:
                logger.warning("signature: flow read for %s (%s) returned HTTP %s",
                               sym, source, resp.status_code)
                return None
            return flow_by_date(resp.iter_lines(), cutoff_iso=cutoff_iso)
    except Exception as exc:                       # noqa: BLE001
        logger.warning("signature: flow read for %s (%s) failed: %s", sym, source, exc)
        return None


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
    """
    by_date = _read_flow_source(sym, "stocks", cutoff_iso)
    if by_date is None or by_date:
        return by_date
    return _read_flow_source(sym, "indexes", cutoff_iso)


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
            if recorded:
                logger.warning("signature: fcb flow read failed for %s — serving %d "
                               "signal(s) from the nightly ledger instead", sym, len(recorded))
                payload = {"sym": sym, "version": rules.VERSIONS["fcb"],
                           "signals": recorded, "source": "ledger", "asOf": time.time()}
            else:
                # Nothing recorded for this symbol — an UNSWEPT symbol and a
                # genuinely signal-free one are indistinguishable from here, so
                # this stays a failure. No "signals" key at all: good() is
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
    """
    from api.services.indicator_compute import compute_rs_line
    bars = _fetch_bars_for_tf(sym, tf)
    benchmark = inputs.get("benchmark") or registry_defs.RS_LINE_BENCHMARKS[0]
    bench_bars = _fetch_bars_for_tf(benchmark, tf)
    return {
        "columns": {"rsLine": compute_rs_line(bars, bench_bars)},
        "times": [int(b["t"]) for b in bars],
        "asOf": time.time(),
    }


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


def _dpc_build(sym: str) -> dict:
    """Dark-pool levels + daily bars + flow → reclaim-confluence signals.
    Never raises (rule 1): a failed build returns an envelope, never poisons a
    cache and never 500s a request."""
    try:
        from api.services.signature import confluence
        levels = fetch_dp_levels(sym).get("levels", [])
        bars = _fetch_bars(sym, 60)
        cutoff = _bar_date_iso(bars[0]["t"]) if bars else ""
        by_date = _fetch_flow_by_date(sym, cutoff) or {}
        signals = confluence.evaluate(levels, bars, by_date)
        return {"ok": True, "sym": sym, "signals": signals, "levels": levels,
                "close": (bars[-1]["c"] if bars else None),
                "asOf": time.time(), "version": rules.VERSIONS["dpc"]}
    except Exception:                                  # noqa: BLE001
        logger.exception("signature: confluence build failed for %s", sym)
        return {"ok": False, "sym": sym, "signals": [], "error": "build failed"}


def _dpc_cached(s: str) -> dict:
    ck = f"sig:dpc:{s}"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    payload = _dpc_build(s)
    if payload.get("ok"):
        cache.set(ck, payload, ttl=_DPC_TTL_S)
    return payload


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
    syms: str = Query(..., description="comma-separated tickers to scan (<=40)"),
    _user: dict = Depends(require_paid),
):
    """Batch the reclaim-confluence over a provided ticker list — returns ONLY
    names with a live signal, ranked by score. First scan of uncached names is
    slow (one flow read each). PROTOTYPE: pass your unusual-DP watchlist; the
    auto-universe (DP-unusual ∩ notable-flow) scanner is the follow-up."""
    raw, seen = [], set()
    for t in (syms or "").split(","):
        u = t.strip().upper()
        if u and u not in seen:
            seen.add(u)
            raw.append(u)
    raw = raw[:40]
    hits = []
    for u in raw:
        try:
            s = _sym_or_422(u)
        except HTTPException:
            continue
        for sig in (_dpc_cached(s).get("signals") or []):
            hits.append({"sym": s, **sig})
    hits.sort(key=lambda h: h["score"], reverse=True)
    return {"ok": True, "scanned": len(raw), "count": len(hits),
            "signals": hits, "asOf": time.time()}
