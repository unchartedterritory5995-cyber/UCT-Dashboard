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
- option strategy: live mark (`optionMarks[id].currentValue`) when finite,
  else the sync value (`brokerCurrentValue`), else — for a BROKER strategy
  only — its `netEntry` (cost): a just-filled contract with no mark yet must
  show at cost, not vanish from net-liq (its cash already left).
- netLiq = cash + marketValue; None when cash is unknown.
"""

from __future__ import annotations

from typing import Any


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


def compose_net_liq(
    account: dict | None,
    positions: list[dict] | None,
    strategies: list[dict] | None,
    prices: dict[str, dict] | None = None,
    option_marks: dict[str, dict] | None = None,
) -> dict[str, Any]:
    """{"marketValue": float, "netLiq": float|None} — the authority for the
    hero's composed number. Field names are the API's camelCase (the same
    dicts the frontend consumes) so fixtures translate 1:1."""
    prices = prices or {}
    option_marks = option_marks or {}
    broker_only = (account or {}).get("balanceSource") == "broker"

    market_value = 0.0
    for p in positions or []:
        if broker_only and p.get("source") != "broker":
            continue
        shares = _f(p.get("shares"))
        if shares is None:
            continue
        live = _f((prices.get(p.get("symbol")) or {}).get("price"))
        px = live if live is not None else _f(p.get("brokerPrice"))
        if px is None:
            continue
        signed = -shares if p.get("side") == "Short" else shares
        market_value += px * signed

    for s in strategies or []:
        if broker_only and s.get("source") != "broker":
            continue
        mark = option_marks.get(s.get("id")) or {}
        cur = _f(mark.get("currentValue"))
        if cur is None:
            cur = _f(s.get("brokerCurrentValue"))
        if cur is None and s.get("source") == "broker":
            cur = _f(s.get("netEntry"))
        if cur is None:
            continue
        market_value += cur

    cash = effective_cash(account)
    net_liq = round(cash + market_value, 2) if cash is not None else None
    return {"marketValue": round(market_value, 2), "netLiq": net_liq}
