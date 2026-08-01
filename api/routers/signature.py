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
import csv
import io
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
from api.services.signature import ledger, rules
from api.services.signature.darkpool_levels import fetch_dp_levels
from api.services.signature.flow_breakout import fcb_signals
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
        if _dpl_good(payload):
            cache.set(_ck("dpl", sym), payload, ttl=_DPL_TTL_S)
        return payload
    except Exception as exc:                       # noqa: BLE001 — see rule 1
        logger.exception("signature: dark-pool levels build failed for %s", sym)
        # `levels: None` (not []) is load-bearing: good() is
        # `levels is not None`, so an empty list here would be remembered as
        # the last GOOD payload and served for the next 30 minutes.
        return {"sym": sym, "version": rules.VERSIONS["dpl"], "levels": None,
                "error": f"dark pool levels unavailable: {exc}", "asOf": time.time()}


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


def _read_flow_rows(sym: str, source: str) -> list[dict] | None:
    """One read of ONE flow source. Rows, or **None when the read FAILED**.

    An unreachable flow service and a genuinely quiet tape both produce zero
    signals, but only one of them is an answer. Handing back `[]` for a failure
    would let the caller remember "no signal" as a good payload for the next 30
    minutes (`lesson_market_cap_cache_poison`: never cache a failed fetch as a
    value).

    **No credential is forwarded.** `/api/flow/ticker/{symbol}` declares no auth
    dependency on either service, so sending the caller's session cookie to an
    env-configurable base URL would buy nothing and hand a live credential to
    whatever `_flow_base_url()` happens to resolve to.

    The surface serves **gzipped CSV**, not JSON (`flow_router.get_flow_ticker`
    → `_build_gzipped_symbol_csv`); httpx transparently decodes the
    Content-Encoding, so `resp.text` is the CSV. `ai_search._ctx_flow_ticker`
    reads the same surface the same way.
    """
    url = f"{_flow_base_url()}/api/flow/ticker/{sym}"
    try:
        resp = httpx.get(url, params={"source": source}, timeout=15.0)
    except Exception as exc:                       # noqa: BLE001
        logger.warning("signature: flow read for %s (%s) failed: %s", sym, source, exc)
        return None
    if resp.status_code != 200:
        logger.warning("signature: flow read for %s (%s) returned HTTP %s",
                       sym, source, resp.status_code)
        return None
    try:
        return list(csv.DictReader(io.StringIO(resp.text)))
    except Exception as exc:                       # noqa: BLE001
        logger.warning("signature: flow rows for %s (%s) did not parse: %s", sym, source, exc)
        return None


def _fetch_flow_rows(sym: str) -> list[dict] | None:
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
    rows = _read_flow_rows(sym, "stocks")
    if rows is None or rows:
        return rows
    return _read_flow_rows(sym, "indexes")


def _flow_join_stats(rows) -> dict:
    """Count what the flow→bar join is actually able to USE.

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


def _log_flow_join(sym: str, rows) -> None:
    stats = _flow_join_stats(rows)
    logger.info("signature: fcb flow join %s rows_in=%d side_matched=%d parsed_to_zero=%d",
                sym, stats["rows_in"], stats["side_matched"], stats["parsed_to_zero"])
    if stats["unknown_sides"]:
        logger.warning("signature: fcb flow join %s saw unrecognized CallPut values %s "
                       "— these rows contribute NO premium to the signal",
                       sym, sorted(stats["unknown_sides"].items()))


def _fcb_good(p) -> bool:
    return bool(p and "signals" in p)


def _fcb_build(sym: str) -> dict:
    try:
        bars = _fetch_bars(sym)
        rows = _fetch_flow_rows(sym)
        if rows is None:
            # No "signals" key at all: good() is `"signals" in p`, so this
            # envelope is refused by the slot and retried next request.
            return {"sym": sym, "version": rules.VERSIONS["fcb"],
                    "error": "flow unavailable", "asOf": time.time()}
        _log_flow_join(sym, rows)
        by_date: dict[str, list[dict]] = {}
        for r in rows:
            d = r.get("CreatedDate") or ""
            try:  # flow dates are M/D/YYYY — normalize to ISO to match _bar_date_iso
                m, day, y = d.split("/")
                iso = f"{int(y):04d}-{int(m):02d}-{int(day):02d}"
            except (ValueError, AttributeError):
                continue
            by_date.setdefault(iso, []).append(r)
        signals = fcb_signals(bars, by_date, include_last=False)  # NEVER the forming session
    except Exception as exc:                       # noqa: BLE001 — see rule 1
        logger.exception("signature: flow-breakout build failed for %s", sym)
        return {"sym": sym, "version": rules.VERSIONS["fcb"],
                "error": f"flow breakout unavailable: {exc}", "asOf": time.time()}

    for s in signals:
        # Per SIGNAL, not per build: record_signal raises (ValueError on any
        # unusable field, sqlite3.IntegrityError on a non-UNIQUE constraint
        # failure), and one refused row must not cost the user the others —
        # nor the response. Re-recording is idempotent by UNIQUE key.
        try:
            ledger.record_signal("fcb", s["version"], sym, "1D", s["direction"],
                                 s["barTime"], s["close"],
                                 meta={"callPrem": s["callPrem"], "putPrem": s["putPrem"]})
        except Exception:                          # noqa: BLE001
            logger.exception("signature: ledger refused fcb %s bar=%r — signal still served",
                             sym, s.get("barTime"))
    payload = {"sym": sym, "version": rules.VERSIONS["fcb"], "signals": signals,
               "asOf": time.time()}
    try:
        cache.set(_ck("fcb", sym), payload, ttl=_FCB_TTL_S)
    except Exception:                              # noqa: BLE001 — see rule 1
        logger.exception("signature: fcb cache write failed for %s", sym)
    return payload


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


# ── routes (all sync `def` — see rule 3) ────────────────────────────────────

@router.get("/darkpool-levels")
def darkpool_levels(sym: str = Query(...), _user: dict = Depends(require_paid)):
    s = _sym_or_422(sym)
    return _DPL_STALE.serve(s, fresh=lambda: cache.get(_ck("dpl", s)),
                            build=lambda: _dpl_build(s), good=_dpl_good)


@router.get("/flow-breakout")
def flow_breakout(sym: str = Query(...), _user: dict = Depends(require_paid)):
    s = _sym_or_422(sym)
    return _FCB_STALE.serve(s, fresh=lambda: cache.get(_ck("fcb", s)),
                            build=lambda: _fcb_build(s), good=_fcb_good)


@router.get("/gex-walls")
def gex_walls(sym: str = Query(...), _user: dict = Depends(require_paid)):
    s = _sym_or_422(sym)
    # The negative cache rides the `fresh` slot deliberately: a waiter that
    # queued behind the single-flight build re-checks fresh() inside the lock,
    # so the herd collapses onto the ONE call that just failed instead of each
    # paying its own ~20s timeout.
    return _GXW_STALE.serve(s, fresh=lambda: _gxw_fresh(s),
                            build=lambda: _gxw_build(s), good=_gxw_good)
