"""Live option marks for OPEN broker strategies — Massive options data.

Source order: the REAL-TIME v3 options snapshot (NBBO midpoint = the mark
brokers display; today's session close + its own previous_close — entitlement
verified live 2026-08-21), falling back to daily aggregates when the snapshot
is unavailable. 30s/60s server caches; a handful of contracts per user.

`broker_current_value` refreshes only at sync (daily cadence), so between syncs
the account hero's net-liq and "Today" were blind to option day moves — the
broker's own app counts them (Robinhood's −$881 day included ~−$690 of option
decay the journal showed as 0). This module serves per-strategy
{currentValue, prevCloseValue} priced from Massive option daily aggregates
(OCC `O:` symbols — the SAME source `historical_equity` already prices the
equity curve with; no new vendor, no SnapTrade quote polling, which is
key-disablement territory).

Unit discipline:
- `mark` / `prev_close` are PER-SHARE premiums (agg closes).
- The contract multiplier is DERIVED from the strategy's OWN stored
  `net_entry` (|net_entry| / (qty × entry_price)) — that value was written at
  import by the one authority (`balances._opt_contract_multiplier`), so this
  never re-implements the mini-option rule. Fallback: the standard 100.
- `currentValue`/`prevCloseValue` are SIGNED totals (short strategies
  negative), the same convention as `broker_current_value`.

A contract with no recent trades simply reports its last session close for
both values (day move 0) — honest, never fabricated. A contract Massive has
no bars for is omitted; the frontend falls back to the sync-time
`brokerCurrentValue`.
"""
from __future__ import annotations

import time
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from api.services import massive
from api.services.auth_db import get_connection
from api.services.journal_two.broker.historical_equity import occ_symbol

_ET = ZoneInfo("America/New_York")

# Per-OCC agg cache: {occ: (fetched_at_epoch, bars)}. Small (a user holds a
# handful of contracts) and short — the daily bar for "today" updates intraday.
_AGG_TTL_SECONDS = 60.0
_agg_cache: dict[str, tuple[float, list[dict]]] = {}

_OPEN_BROKER_OPT_SQL = """
    SELECT s.id, s.external_id, s.underlying, s.net_entry, s.entry_date,
           l.strike, l.expiration, l.contract_type,
           l.qty AS leg_qty, l.entry_price AS leg_entry, l.side AS leg_side
    FROM j2_option_strategies s
    JOIN j2_option_legs l ON l.strategy_id = s.id
    WHERE s.user_id = ? AND s.source = 'broker'
      AND s.status = 'open' AND s.closed_at IS NULL
"""


def _derived_multiplier(net_entry: Any, qty: Any, entry_price: Any) -> float:
    """The contract size this strategy was IMPORTED with, recovered from its
    own stored fields (net_entry = sign × qty × entry × multiplier)."""
    try:
        q = abs(float(qty))
        e = abs(float(entry_price))
        n = abs(float(net_entry))
        if q > 1e-9 and e > 1e-9 and n > 1e-9:
            m = n / (q * e)
            if 0.5 <= m <= 10_000:
                return float(round(m))
    except (TypeError, ValueError):
        pass
    return 100.0


def _bars_for(occ: str, *, today_et: date) -> list[dict]:
    now = time.time()
    hit = _agg_cache.get(occ)
    if hit and now - hit[0] < _AGG_TTL_SECONDS:
        return hit[1]
    start = date.fromordinal(today_et.toordinal() - 10).isoformat()
    bars = massive.get_daily_agg(occ, start, today_et.isoformat(),
                                 adjusted=False, map_symbol=False)
    _agg_cache.setdefault  # keep linters quiet about unused attr style
    _agg_cache[occ] = (now, bars or [])
    return _agg_cache[occ][1]


def _bar_date(bar: dict) -> date:
    return datetime.fromtimestamp(bar["t"] / 1000, tz=timezone.utc).date()


def _f(v) -> float | None:
    try:
        x = float(v)
        return x if x == x and x not in (float("inf"), float("-inf")) else None
    except (TypeError, ValueError):
        return None


_SNAP_TTL_SECONDS = 10.0
_snap_cache: dict[str, tuple[float, dict | None]] = {}


def _snapshot_for(underlying: str, occ: str) -> dict | None:
    now = time.time()
    hit = _snap_cache.get(occ)
    if hit and now - hit[0] < _SNAP_TTL_SECONDS:
        return hit[1]
    snap = massive.get_option_snapshot(underlying, occ)
    _snap_cache[occ] = (now, snap)
    return snap


def _mark_from_snapshot(snap: dict) -> tuple[float | None, float | None]:
    """(mark, prev_close) from a v3 option snapshot, or (None, None).

    Mark preference — live NBBO midpoint (what brokers display as the mark;
    ONLY when both sides are quoted — overnight the book is zeroed and
    midpoint reads 0), then today's session close (updates intraday with the
    tape), then the last trade. prev_close is the session object's own
    previous_close. Everything must be a positive finite number or it is
    treated as absent — never fabricated."""
    if not isinstance(snap, dict):
        return None, None
    quote = snap.get("last_quote") or {}
    day = snap.get("day") or {}
    trade = snap.get("last_trade") or {}
    bid, ask = _f(quote.get("bid")), _f(quote.get("ask"))
    mid = _f(quote.get("midpoint"))
    mark = None
    if bid and ask and bid > 0 and ask > 0 and mid and mid > 0:
        mark = mid
    elif (c := _f(day.get("close"))) and c > 0:
        mark = c
    elif (p := _f(trade.get("price"))) and p > 0:
        mark = p
    prev = _f(day.get("previous_close"))
    prev = prev if prev and prev > 0 else None
    return mark, prev


def get_option_marks(user_id: str, account_id: str | None = None,
                     conn=None) -> dict[str, Any]:
    """{strategyId: {mark, prevClose, currentValue, prevCloseValue,
    entryEstimated, asOf}} for the user's open broker strategies."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        sql = _OPEN_BROKER_OPT_SQL
        params: tuple = (user_id,)
        if account_id:
            sql += " AND s.account_id = ?"
            params = (user_id, account_id)
        rows = conn.execute(sql, params).fetchall()
    finally:
        if owned:
            conn.close()

    today_et = datetime.now(_ET).date()
    # Broker-imported strategies are single-leg by construction
    # (option_reconstruct's v1 non-goal). If a multi-leg row ever reaches
    # this query, the per-leg loop below would let the LAST leg silently
    # overwrite the whole strategy's value (a debit spread priced as its
    # long leg with no short offset). Skip such strategies wholesale — the
    # frontend falls back to the correctly-netted brokerCurrentValue.
    leg_counts: dict[str, int] = {}
    for r in rows:
        leg_counts[r["id"]] = leg_counts.get(r["id"], 0) + 1
    out: dict[str, Any] = {}
    for r in rows:
        if leg_counts.get(r["id"], 0) > 1:
            continue
        try:
            occ = occ_symbol(r["underlying"], r["expiration"],
                             r["contract_type"], r["strike"])
        except Exception:
            continue
        # Real-time snapshot first (live NBBO midpoint / today's tape +
        # the session's own previous_close), daily aggregates as fallback.
        source = "snapshot"
        mark, prev = _mark_from_snapshot(_snapshot_for(r["underlying"], occ))
        if mark is None:
            source = "aggs"
            bars = _bars_for(occ, today_et=today_et)
            if not bars:
                continue
            last = bars[-1]
            mark = last.get("c")
            if mark is None:
                continue
            if _bar_date(last) >= today_et and len(bars) >= 2:
                prev = bars[-2].get("c")
            else:
                # No trade today yet → last session close is both mark and
                # baseline (day move 0). Honest, never fabricated.
                prev = mark
        if prev is None:
            prev = mark
        qty = abs(float(r["leg_qty"] or 0.0))
        if qty <= 1e-9:
            continue
        sign = 1.0 if r["leg_side"] == "buy" else -1.0
        mult = _derived_multiplier(r["net_entry"], qty, r["leg_entry"])
        out[r["id"]] = {
            "mark": float(mark),
            "prevClose": float(prev),
            "currentValue": round(sign * qty * float(mark) * mult, 2),
            "prevCloseValue": round(sign * qty * float(prev) * mult, 2),
            # Carried-in strategies have a sync-stamped entry_date — the FE's
            # opened-today rule must not treat that placeholder as a fill.
            "entryEstimated": str(r["external_id"] or "").startswith("bkoptpos:"),
            "asOf": (today_et.isoformat() if source == "snapshot"
                     else _bar_date(last).isoformat()),
            "source": source,
        }
    return out


def _reset_cache_for_tests() -> None:
    _agg_cache.clear()
    _snap_cache.clear()

def compare_prior_marks(user_id: str | None = None, conn=None) -> dict[str, Any]:
    """Our feed's implied option day-move vs THE BROKER'S, side by side.

    The instrument for one undecided number. On 2026-08-29 our feed said the
    owner's SNAP Jan-2028 LEAP fell 675 -> 665 on Friday (−$10) while the
    broker's own marks said it ROSE 655 -> 665 (+$10) — a $20 swing on one
    wide-spread contract, and the bulk of what still separates a closed-session
    Today from Robinhood's figure. Neither side could be called right from a
    single Saturday, so `_roll_option_marks` began STORING the broker's prior
    mark and this reports the two implied moves against each other.

    Read it after a few sessions: if `brokerDay` tracks the broker's own Today
    and `feedDay` does not, the option's Today baseline should move to the
    broker's prior mark — and its CURRENT side must move with it (see
    option_reconstruct._roll_option_marks; splitting the ends is the defect the
    equity fix removed).

    `disagreement` is feedDay − brokerDay: the dollars this decision is worth,
    per strategy. Rows where either side lacks a prior mark are reported with
    nulls rather than dropped — an absent baseline is the thing worth seeing.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        sql = ("SELECT id, user_id, underlying, broker_current_value, "
               "broker_current_value_prev, broker_current_value_prev_session, "
               "broker_mark_synced_at FROM j2_option_strategies "
               "WHERE source = 'broker' AND status = 'open'")
        params: tuple = ()
        if user_id:
            sql += " AND user_id = ?"
            params = (user_id,)
        rows = conn.execute(sql, params).fetchall()
    finally:
        if owned:
            conn.close()

    by_user: dict[str, list] = {}
    for r in rows:
        by_user.setdefault(r["user_id"], []).append(r)

    out: list[dict[str, Any]] = []
    for uid, urows in by_user.items():
        try:
            marks = get_option_marks(uid)
        except Exception:  # noqa: BLE001 — a diagnostic must not raise
            marks = {}
        for r in urows:
            m = marks.get(r["id"]) or {}
            feed_cur, feed_prev = _f(m.get("currentValue")), _f(m.get("prevCloseValue"))
            bro_cur, bro_prev = _f(r["broker_current_value"]), _f(r["broker_current_value_prev"])
            feed_day = None if (feed_cur is None or feed_prev is None) else round(feed_cur - feed_prev, 2)
            bro_day = None if (bro_cur is None or bro_prev is None) else round(bro_cur - bro_prev, 2)
            out.append({
                "strategyId": r["id"], "userId": uid, "underlying": r["underlying"],
                "feedCurrent": feed_cur, "feedPrevClose": feed_prev, "feedDay": feed_day,
                "brokerCurrent": bro_cur, "brokerPrev": bro_prev,
                "brokerPrevSession": r["broker_current_value_prev_session"],
                "brokerMarkSyncedAt": r["broker_mark_synced_at"],
                "brokerDay": bro_day,
                "disagreement": (None if (feed_day is None or bro_day is None)
                                 else round(feed_day - bro_day, 2)),
            })
    comparable = [r for r in out if r["disagreement"] is not None]
    return {
        "strategies": len(out),
        "comparable": len(comparable),
        "awaiting_broker_prior": sum(1 for r in out if r["brokerPrev"] is None),
        "total_disagreement": round(sum(r["disagreement"] for r in comparable), 2),
        "rows": out,
    }
