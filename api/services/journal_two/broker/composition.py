"""The composed broker net-liq — ONE definition, two lanes.

The number a member sees on the Open Positions hero is composed CLIENT-side
(`app/src/lib/journal-2-0/calculations.js :: brokerLiveSummary`), while the
live sentinel recomposes it SERVER-side to enforce the conservation law. On
2026-08-26 the display showed a figure the server could not later reproduce
— a mirrored JS⇄Python architecture with no parity rail between the lanes
(`lesson_rail_the_mirror_not_just_the_lane`). This module is the PYTHON
AUTHORITY for the composition; `tools_emit_parity_fixtures.py` emits golden
cases from it and `parity.test.js` holds the JS mirror to them.

Composition rules (both lanes MUST match):
- cash: `brokerCashLive` (fill-derived) when finite, else `brokerCash`.
- broker-linked account (`balanceSource == 'broker'`): only rows with
  `source == 'broker'` participate — the hero mirrors THE BROKER ACCOUNT;
  a manual row added into it must not move a number labeled as the broker's
  (and cannot, since the broker's cash knows nothing of it).
- equity row: live price when finite, else the sync mark (`brokerPrice`);
  no price at all → the row is skipped. Shorts contribute negatively.
  When `prefer_broker` is set (see `prefer_broker_marks`) that order INVERTS:
  the broker's own mark wins and the live price is the fallback.
- option strategy: live mark (`optionMarks[id].currentValue`) when finite,
  else the sync value (`brokerCurrentValue`), else — for a BROKER strategy
  only — its `netEntry` (cost): a just-filled contract with no mark yet must
  show at cost, not vanish from net-liq (its cash already left).
- netLiq = cash + marketValue; None when cash is unknown.
- vintage: WHICH MOMENT the parts came from (see `_vintage`). Reported, never
  enforced — mixing is often correct; being unable to SEE the mix is not.
"""

from __future__ import annotations

from typing import Any

from .. import timeutil


def _f(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x and x not in (float("inf"), float("-inf")) else None


def effective_cash(account: dict | None) -> float | None:
    live = _f((account or {}).get("brokerCashLive"))
    return live if live is not None else _f((account or {}).get("brokerCash"))


_CLOSE_HOUR_ET = 16  # the session close


def prefer_broker_marks(
    account: dict | None,
    session_closed: bool,
    last_closed_session_et: str | None,
) -> bool:
    """True when equities should be valued at the BROKER's own marks.

    Intraday, our live feed is the better number: the broker's balance sync
    runs once, pre-dawn, so its marks are the PREVIOUS session's close and
    mirroring them would hide the whole day's move. That is why this
    composition prefers live prices at all.

    Once the session is fully closed the trade inverts. The book is static,
    the broker's marks are what the member's broker app is showing, and
    re-valuing every row with a second vendor's closes can only manufacture a
    difference — two market-data vendors never agree to the penny, and the
    disagreement is multiplied by the share count. Measured 2026-08-29
    (Saturday): a 1.5c gap on SNAP's close was $30 of a $19.96 hero
    discrepancy on 2,000 shares, against a sync whose mirror check had drifted
    $0.02.

    BOTH conditions are required. `session_closed` alone is not enough: on a
    weekday evening the stored marks predate that day's close (the sync ran at
    ~03:40 ET), so mirroring them would show a DAY-STALE account — far worse
    than the gap this closes. The watermark is the local balance-write time,
    the same one `live_cash` uses; SnapTrade's own `holdings_synced_at` is a
    lagging metadata field (measured Friday 15:31Z while the marks it
    described were that day's closes) and must NOT be used here.

    `last_closed_session_et` is the ET date ('YYYY-MM-DD') of the most recent
    CLOSED session — supplied by the caller's session clock, so this stays a
    pure function the JS mirror can be held to.
    """
    if not session_closed or not last_closed_session_et:
        return False
    # timeutil is the ET spine authority — never parse a timestamp a second
    # way here (a private second parser is how two ET answers start drifting).
    ts = (account or {}).get("brokerBalanceSyncedAt")
    day = timeutil.compute_trading_day_et(ts)
    if day is None:
        return False
    last = str(last_closed_session_et)
    if day > last:
        return True
    # Same ET date ⇒ the sync must land at or after the close. A date-only
    # stamp carries no hour and so cannot prove that — refuse rather than
    # assume (a wrong "yes" here shows a day-stale account).
    hour = timeutil.compute_hour_et(ts)
    return day == last and hour is not None and hour >= _CLOSE_HOUR_ET


def _blank_vintage() -> dict[str, Any]:
    return {"basis": None, "session": None, "conflicts": [],
            "components": {"live": 0, "broker": 0, "cost": 0}}


def _finish_vintage(v: dict[str, Any], broker_sessions: list) -> dict[str, Any]:
    """Resolve the collected per-component vintages into one verdict.

    `basis` names what the number is made of — live ticks, the broker's own
    marks, or (for a just-filled option) cost. `session` is filled ONLY when
    every broker-marked component agrees; the moment they don't it is None and
    the disagreeing components are NAMED, because a count tells you a problem
    exists and a name tells you where to look
    (`lesson_a_differ_can_truncate_the_names_a_rail_exists_to_report`).
    """
    c = v["components"]
    present = [k for k in ("live", "broker", "cost") if c[k]]
    v["basis"] = present[0] if len(present) == 1 else ("mixed" if present else None)
    if broker_sessions:
        known = [(sym, s) for sym, s in broker_sessions if s is not None]
        distinct = {s for _, s in known}
        if len(known) == len(broker_sessions) and len(distinct) == 1:
            v["session"] = next(iter(distinct))
            return v
        # No single answer. Reference = the NEWEST session anyone reports, with
        # ties broken by date rather than dict order so the verdict is
        # deterministic; a mark with NO session can never be certified as
        # sharing one, so when nothing is dated every component is named.
        ref = None
        if known:
            counts: dict = {}
            for _, sess in known:
                counts[sess] = counts.get(sess, 0) + 1
            ref = max(counts, key=lambda k: (counts[k], k))
        v["session"] = None
        v["conflicts"] = [{"symbol": sym, "session": sess}
                          for sym, sess in broker_sessions
                          if ref is None or sess != ref]
    return v


def compose_net_liq(
    account: dict | None,
    positions: list[dict] | None,
    strategies: list[dict] | None,
    prices: dict[str, dict] | None = None,
    option_marks: dict[str, dict] | None = None,
    prefer_broker: bool = False,
) -> dict[str, Any]:
    """{"marketValue": float, "netLiq": float|None} — the authority for the
    hero's composed number. Field names are the API's camelCase (the same
    dicts the frontend consumes) so fixtures translate 1:1."""
    prices = prices or {}
    option_marks = option_marks or {}
    broker_only = (account or {}).get("balanceSource") == "broker"

    market_value = 0.0
    vintage = _blank_vintage()
    broker_sessions: list = []
    for p in positions or []:
        if broker_only and p.get("source") != "broker":
            continue
        shares = _f(p.get("shares"))
        if shares is None:
            continue
        live = _f((prices.get(p.get("symbol")) or {}).get("price"))
        broker = _f(p.get("brokerPrice"))
        # A PREFERENCE, never a restriction: a provisional row from an
        # intraday fill has no broker mark yet, and dropping it would debit
        # cash for a position missing from market value (the 2026-08-26 class).
        if prefer_broker:
            px = broker if broker is not None else live
        else:
            px = live if live is not None else broker
        if px is None:
            continue
        signed = -shares if p.get("side") == "Short" else shares
        market_value += px * signed
        # Which side actually priced this row — the thing nothing recorded.
        if prefer_broker and broker is not None:
            vintage["components"]["broker"] += 1
            broker_sessions.append((p.get("symbol"), p.get("brokerPriceSession")))
        elif live is not None:
            vintage["components"]["live"] += 1
        else:
            vintage["components"]["broker"] += 1
            broker_sessions.append((p.get("symbol"), p.get("brokerPriceSession")))

    for s in strategies or []:
        if broker_only and s.get("source") != "broker":
            continue
        mark = option_marks.get(s.get("id")) or {}
        cur = _f(mark.get("currentValue"))
        kind = "live"
        if cur is None:
            cur = _f(s.get("brokerCurrentValue"))
            kind = "broker"
        if cur is None and s.get("source") == "broker":
            cur = _f(s.get("netEntry"))
            kind = "cost"   # neither a live nor a broker mark — never let it pose as one
        if cur is None:
            continue
        market_value += cur
        vintage["components"][kind] += 1

    cash = effective_cash(account)
    net_liq = round(cash + market_value, 2) if cash is not None else None
    return {"marketValue": round(market_value, 2), "netLiq": net_liq,
            "vintage": _finish_vintage(vintage, broker_sessions)}
