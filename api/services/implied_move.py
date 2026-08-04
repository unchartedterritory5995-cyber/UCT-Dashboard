"""In-house expected move from Massive options chains (ATM straddle).

Replaces the slow, delayed-quote yfinance straddle for the research/earnings
surfaces. Horizon-honest: expiry is the first on/after the report date and the
payload carries it ("through YYYY-MM-DD") so the UI can state the denominator.
"""
from __future__ import annotations

import datetime as _dt
import logging

from api.services import polygon_options

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
        return exps[0]
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


def compute_expected_move(sym: str, report_date: str | None) -> dict | None:
    exps = polygon_options.list_expirations(sym)
    expiry = select_report_expiry(exps.get("expirations") or [], report_date)
    if not expiry:
        return None
    chain = polygon_options.get_chain(sym, expiration=expiry, strikes_around_spot=4)
    if "error" in chain:
        return None
    spot = chain.get("spot")
    if not spot or spot <= 0:
        return None

    def _atm(rows: list[dict]) -> dict | None:
        valid = [r for r in rows if r.get("strike") is not None]
        return min(valid, key=lambda r: abs(float(r["strike"]) - spot)) if valid else None

    call, put = _atm(chain.get("calls") or []), _atm(chain.get("puts") or [])
    if not call or not put or call["strike"] != put["strike"]:
        return None
    call_mid, put_mid = _mid(call), _mid(put)
    if call_mid is None or put_mid is None or (call_mid + put_mid) <= 0:
        return None
    dollar = call_mid + put_mid
    return {
        "pct": dollar / spot * 100,
        "dollar": dollar,
        "expiry": expiry,
        "strike": float(call["strike"]),
        "spot": float(spot),
        "call_mid": call_mid,
        "put_mid": put_mid,
        "iv_atm": call.get("iv"),
        "horizon": f"through {expiry}",
        "asof": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "massive-chain",
    }


# Task 3 replaces this alias with the ServeStale-fronted version; the router
# and store bind to THIS name so their code never changes.
get_expected_move = compute_expected_move
