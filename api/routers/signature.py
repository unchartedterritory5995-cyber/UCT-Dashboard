"""UCT Signature Indicators — premium, server-computed, serve-stale wrapped.

Prefix is deliberately NOT /api/flow* (flow_proxy's catch-all would swallow it)
and NOT /api/indicator* (that namespace is reserved for Phase B's generic
engine). Flow data is read via the PROXIED /api/flow/ticker/{sym} surface so
the fresh flow.db on flow-worker answers — web's own copy is a FROZEN
pre-cutover snapshot.

THE THREE RULES THIS MODULE EXISTS TO ENFORCE
---------------------------------------------
1. **No build may raise.** `ServeStale.serve` calls `build()` on the cold path
   with no try/except (serve_stale.py:143), so anything a build raises is a
   500 on a user's chart. Every `_*_build` below therefore catches Exception,
   logs it with a traceback, and returns an envelope `good()` rejects — so a
   failure is visible, is never remembered as the last good payload, and is
   retried by the very next request.
2. **A ledger refusal is not a user-facing failure.** `record_signal` raises by
   design on any field it cannot key. The signals are already computed and
   correct; refusing to WRITE one must never refuse to SHOW it, so recording is
   wrapped per signal.
3. **Every route is a plain `def`.** The GEX adapter is async and is driven
   with `asyncio.run`, which raises RuntimeError inside an `async def`. Sync
   handlers also run in the anyio threadpool, which is where these blocking
   provider reads belong.
"""
from __future__ import annotations

import asyncio
import csv
import io
import logging
import os
import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.serve_stale import ServeStale
from api.services.signature import ledger, rules
from api.services.signature.darkpool_levels import fetch_dp_levels
from api.services.signature.flow_breakout import fcb_signals
from api.services.signature.gex_walls import fetch_gex_walls
from api.services.signature.rules import parse_money

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/signature", tags=["signature"])

# No \s in the class: a symbol is stripped BEFORE it is validated (see
# _sym_or_422), never validated with padding still attached.
_SYM_RE = re.compile(r"^[A-Za-z.\-]{1,10}$")
_FLOW_BASE = os.environ.get("SIGNATURE_FLOW_BASE", "http://127.0.0.1:8080")

_DPL_STALE = ServeStale("sig_dpl", max_age_seconds=1800)
_FCB_STALE = ServeStale("sig_fcb", max_age_seconds=1800)
_GXW_STALE = ServeStale("sig_gxw", max_age_seconds=rules.GXW_MAX_AGE_S)

# ── GEX negative cache ──────────────────────────────────────────────────────
# `good()` for GEX is "not error", so an auth-down envelope is NEVER remembered
# by ServeStale. Without this dict, every request during a Schwab auth outage —
# a routine, hours-long production state — takes the cold path and blocks an
# anyio worker for the full ~20s /chains timeout, and the single-flight lock
# just queues the rest of them behind it. 60s of memory turns that storm back
# into one call per symbol per minute while keeping the outage self-healing.
_GXW_NEG_CACHE: dict[str, tuple[dict, float]] = {}
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
    symbol. The upper comes last because it is the ServeStale key AND the
    ledger's stored symbol; the gex adapter stamps its own sym.upper() but that
    is downstream of a request we would already have rejected.
    """
    s = (sym or "").strip()
    if not _SYM_RE.match(s):
        raise HTTPException(status_code=422, detail="invalid symbol")
    return s.upper()


# ── Dark Pool Levels ────────────────────────────────────────────────────────

def _dpl_build(sym: str) -> dict:
    try:
        return fetch_dp_levels(sym)
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


def _fetch_flow_rows(sym: str, cookie: str | None) -> list[dict] | None:
    """Read flow via the proxied surface so flow-worker's fresh DB answers.

    Returns the parsed rows, or **None when the read FAILED** — an unreachable
    flow service and a genuinely quiet tape both produce zero signals, but only
    one of them is an answer. Handing back `[]` for a failure would let the
    caller remember "no signal" as a good payload for the next 30 minutes
    (`lesson_market_cap_cache_poison`: never cache a failed fetch as a value).

    The surface serves **gzipped CSV**, not JSON (`flow_router.get_flow_ticker`
    → `_build_gzipped_symbol_csv`); httpx transparently decodes the
    Content-Encoding, so `resp.text` is the CSV. `ai_search._ctx_flow_ticker`
    reads the same surface the same way.
    """
    url = f"{_FLOW_BASE}/api/flow/ticker/{sym}"
    try:
        headers = {"cookie": cookie} if cookie else {}
        resp = httpx.get(url, headers=headers, timeout=15.0)
    except Exception as exc:                       # noqa: BLE001
        logger.warning("signature: flow read for %s failed: %s", sym, exc)
        return None
    if resp.status_code != 200:
        logger.warning("signature: flow read for %s returned HTTP %s", sym, resp.status_code)
        return None
    try:
        return list(csv.DictReader(io.StringIO(resp.text)))
    except Exception as exc:                       # noqa: BLE001
        logger.warning("signature: flow rows for %s did not parse: %s", sym, exc)
        return None


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


def _fcb_build(sym: str, cookie: str | None) -> dict:
    try:
        bars = _fetch_bars(sym)
        rows = _fetch_flow_rows(sym, cookie)
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
    return {"sym": sym, "version": rules.VERSIONS["fcb"], "signals": signals,
            "asOf": time.time()}


# ── GEX Walls ───────────────────────────────────────────────────────────────

def _gxw_negative_hit(sym: str) -> dict | None:
    hit = _GXW_NEG_CACHE.get(sym)
    if not hit:
        return None
    payload, at = hit
    if time.time() - at > _GXW_NEG_TTL_S:
        _GXW_NEG_CACHE.pop(sym, None)
        return None
    return payload


def _gxw_remember_error(sym: str, payload: dict) -> None:
    _GXW_NEG_CACHE[sym] = (payload, time.time())
    if len(_GXW_NEG_CACHE) > _GXW_NEG_MAX_KEYS:    # bounded: the key is user input
        for key in sorted(_GXW_NEG_CACHE, key=lambda k: _GXW_NEG_CACHE[k][1])[:-_GXW_NEG_MAX_KEYS]:
            _GXW_NEG_CACHE.pop(key, None)


def _gxw_build(sym: str) -> dict:
    try:
        payload = asyncio.run(fetch_gex_walls(sym))
    except Exception as exc:                       # noqa: BLE001 — see rule 1
        logger.exception("signature: gex walls build failed for %s", sym)
        payload = {"sym": sym.upper(), "levels": [], "version": rules.VERSIONS["gxw"],
                   "error": f"gex walls unavailable: {exc}", "asOf": time.time()}
    if payload.get("error"):
        _gxw_remember_error(sym, payload)
    else:
        # Recovery must be immediate — a healthy build clears the memory of the
        # outage rather than waiting out its TTL. NOTE: an empty `levels` list
        # with no error is a NORMAL, healthy state (no wall inside the ±15%
        # band), not a failure, and is remembered as a good payload.
        _GXW_NEG_CACHE.pop(sym, None)
    return payload


# ── routes (all sync `def` — see rule 3) ────────────────────────────────────

@router.get("/darkpool-levels")
def darkpool_levels(sym: str = Query(...), _user: dict = Depends(require_paid)):
    s = _sym_or_422(sym)
    return _DPL_STALE.serve(s, fresh=lambda: None, build=lambda: _dpl_build(s),
                            good=lambda p: bool(p and p.get("levels") is not None))


@router.get("/flow-breakout")
def flow_breakout(request: Request, sym: str = Query(...), _user: dict = Depends(require_paid)):
    s = _sym_or_422(sym)
    cookie = request.headers.get("cookie")
    return _FCB_STALE.serve(s, fresh=lambda: None, build=lambda: _fcb_build(s, cookie),
                            good=lambda p: bool(p and "signals" in p))


@router.get("/gex-walls")
def gex_walls(sym: str = Query(...), _user: dict = Depends(require_paid)):
    s = _sym_or_422(sym)
    # The negative cache rides the `fresh` slot deliberately: a waiter that
    # queued behind the single-flight build re-checks fresh() inside the lock,
    # so the herd collapses onto the ONE call that just failed instead of each
    # paying its own ~20s timeout.
    return _GXW_STALE.serve(s, fresh=lambda: _gxw_negative_hit(s), build=lambda: _gxw_build(s),
                            good=lambda p: bool(p and not p.get("error")))
