"""In-house expected move from Massive options chains (ATM straddle).

Replaces the slow, delayed-quote yfinance straddle for the research/earnings
surfaces. Horizon-honest: expiry is the first on/after the report date and the
payload carries it ("through YYYY-MM-DD") so the UI can state the denominator.
"""
from __future__ import annotations

import datetime as _dt
import logging

from api.services import polygon_options
from api.services.cache import TTLCache
from api.services.serve_stale import ServeStale

_log = logging.getLogger(__name__)


def select_report_expiry(expirations: list[str], report_date: str | None) -> str | None:
    """First expiry ≥ report_date; front expiry when no date; None when the
    report lies beyond every listed expiry (better no number than a wrong one)."""
    exps = sorted(e for e in (expirations or []) if e)
    if not exps:
        return None
    if not report_date:
        return exps[0]
    try:
        target = _dt.date.fromisoformat(report_date)
    except (TypeError, ValueError):
        _log.warning("select_report_expiry: unparseable report_date=%s, returning None", report_date)
        return None
    for e in exps:
        try:
            if _dt.date.fromisoformat(e) >= target:
                return e
        except ValueError:
            continue
    return None


def _mid(row: dict) -> float | None:
    bid, ask = row.get("bid"), row.get("ask")
    try:
        bid, ask = float(bid), float(ask)
    except (TypeError, ValueError):
        return None
    if ask <= 0 or bid < 0 or ask < bid:
        return None
    return (bid + ask) / 2


def straddle_from_rows(calls: list[dict], puts: list[dict], spot: float) -> dict | None:
    """The ATM-straddle math itself, over already-fetched option rows.

    Extracted so the HISTORICAL backfill (implied_backfill.py) computes an
    expected move by CALLING this, never by reimplementing it. A backfilled
    quarter and a live capture that disagreed on method would be worse than no
    backfill at all: the RICH/CHEAP verdict compares them to each other, so a
    method fork shows up as a fake edge, not as an obvious bug.

    Rows need only `strike`, `bid`, `ask` (and optionally `iv`) — the same
    shape `polygon_options.get_chain` returns and the same shape the backfill
    assembles from historical NBBO quotes. Returns None when no usable ATM
    pair exists; callers add expiry/horizon/source around it.
    """
    if not (spot and spot > 0):
        return None

    def _atm(rows: list[dict]) -> dict | None:
        valid = []
        for r in rows or []:
            try:
                valid.append((abs(float(r["strike"]) - spot), r))
            except (TypeError, ValueError, KeyError):
                continue
        if not valid:
            return None
        # min() is deterministic on ties: first (= lowest strike, ascending sort) wins
        return min(valid, key=lambda t: t[0])[1]

    call, put = _atm(calls), _atm(puts)
    if not call or not put:
        return None
    try:
        if float(call["strike"]) != float(put["strike"]):
            return None
    except (TypeError, ValueError, KeyError):
        return None
    call_mid, put_mid = _mid(call), _mid(put)
    if call_mid is None or put_mid is None:
        return None
    dollar = call_mid + put_mid
    if dollar <= 0:
        return None
    return {
        "pct": dollar / spot * 100,
        "dollar": dollar,
        "strike": float(call["strike"]),
        "spot": spot,
        "call_mid": call_mid,
        "put_mid": put_mid,
        "iv_atm": call.get("iv"),
    }


def compute_expected_move(sym: str, report_date: str | None) -> dict | None:
    exps = polygon_options.list_expirations(sym)
    expiry = select_report_expiry(exps.get("expirations") or [], report_date)
    if not expiry:
        _log.debug("expected_move %s: no valid expiry", sym)
        return None
    chain = polygon_options.get_chain(sym, expiration=expiry, strikes_around_spot=4)
    if "error" in chain:
        _log.debug("expected_move %s: chain error", sym)
        return None

    try:
        spot = float(chain.get("spot") or 0)
    except (TypeError, ValueError):
        _log.debug("expected_move %s: non-numeric spot", sym)
        return None
    if spot <= 0:
        _log.debug("expected_move %s: spot not positive", sym)
        return None

    straddle = straddle_from_rows(chain.get("calls") or [], chain.get("puts") or [], spot)
    if straddle is None:
        _log.debug("expected_move %s: no usable ATM straddle", sym)
        return None
    return {
        **straddle,
        "expiry": expiry,
        "horizon": f"through {expiry}",
        "asof": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "massive-chain",
    }


# ── Task 3: TTL cache + serve-stale front for `compute_expected_move` ──────────
#
# Mirrors the composition `_WEEKLY_STALE` uses in `api/routers/calendar.py`:
# a 15-min TTL cache for the instant-fresh path, backed by a ServeStale slot
# that serves the last good straddle (bounded 2h) while a rebuild runs behind
# the caller, with single-flight collapsing concurrent cold callers onto one
# `compute_expected_move` call via ServeStale's per-key build lock. A failed
# build is never written to either cache — `_move_is_good` is the gate.
_MOVE_CACHE = TTLCache()
_MOVE_TTL = 900  # 15 min — IV moves through the session, but not tick-by-tick
_MOVE_STALE = ServeStale("expected_move", max_age_seconds=7200)


def _move_is_good(payload: dict | None) -> bool:
    """A None/failed build must never become the value the next caller sees."""
    return payload is not None


def get_expected_move(sym: str, report_date: str | None = None) -> dict | None:
    """Cached front for `compute_expected_move`: fresh TTL cache wins; else the
    last good straddle serves the gap while a background refresh runs; else
    this caller builds synchronously (single-flight).

    Copy discipline: the TTL cache, the ServeStale slot, and the value handed
    back to THIS caller are three independent dict objects. `TTLCache.get()`
    returns the exact object it was given (no internal copy), so without this
    a caller mutating its returned payload (e.g. `out["pct"] = ...`) would
    corrupt what every future caller — and the stale-serve fallback — sees.
    """
    key = f"expmove::{(sym or '').upper()}::{report_date or ''}"

    def _build():
        value = compute_expected_move(sym, report_date)
        if value is not None:
            _MOVE_CACHE.set(key, dict(value), _MOVE_TTL)
        return value

    result = _MOVE_STALE.serve(
        key,
        fresh=lambda: _MOVE_CACHE.get(key),
        build=_build,
        good=_move_is_good,
    )
    return dict(result) if result is not None else None
