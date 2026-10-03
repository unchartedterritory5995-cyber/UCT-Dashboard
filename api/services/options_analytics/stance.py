"""FT-039 — a decomposed, narrating fit score for ONE contract and a stated directional style.

  fit_score 0-5 = 5 x the mean of the sub-scores that could be computed, each 0-1:
    iv_regime        long premium is cheaper when IV is low in its own history: 1 - IV rank/100.
                     ⛔ Our IV rank needs 20 logged sessions; until then this component is NOT
                     computed and the answer says so (the log began 2026-09-30).
    greeks_fit       |delta| near 0.45 for a directional long; 0 when the contract's side does not
                     match the stated direction (a put for "bullish").
    dte_fit          1 between 30 and 60 days; falls to 0 at 7 and at 180.
    liquidity        0.7 x spread score (2% of mid or tighter = 1, 20% or wider = 0)
                     + 0.3 x min(1, open interest / 1,000).
    earnings_timing  0.3 when the next earnings date falls before expiry (long premium through a
                     print carries the crush), 1 when it does not; not computed with no date.

⛔ COMPUTED, WITH A STANDING DISCLAIMER. Every weight and threshold above is ours, stated in
  `method`, and uncalibrated. The answer names how many of the five components it used.
⛔ Inputs are the vendor's (quote, greeks, OI) plus our log (IV rank) and our earnings file.
⛔ Blocking reads: the route is a plain `def`.
"""
from __future__ import annotations

import datetime as _dt
from typing import Callable, Optional
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
COMPONENTS = ("iv_regime", "greeks_fit", "dte_fit", "liquidity", "earnings_timing")
DISCLAIMER = ("A description of how this contract fits the stated style, computed from public "
              "quotes and our own logs with weights we chose. Not advice and not a recommendation; "
              "nothing here places a trade.")
METHOD = ("fit_score = 5 x the mean of the computed components (each 0-1). iv_regime = 1 - IV rank/100 "
          "(needs 20 logged sessions); greeks_fit = 1 - |(|delta| - 0.45)| / 0.45, 0 if the side "
          "does not match the direction; dte_fit = 1 from 30 to 60 days, linear to 0 at 7 and 180; "
          "liquidity = 0.7 x spread score (<=2% of mid = 1, >=20% = 0) + 0.3 x min(1, OI/1000); "
          "earnings_timing = 0.3 if earnings fall before expiry, else 1. Weights are ours and "
          "uncalibrated.")


class NotInChain(Exception):
    """The contract is not among the strikes the chain read returned (far from the money)."""


def _clip(x: float) -> float:
    return max(0.0, min(1.0, x))


def dte_fit(days: int) -> float:
    if 30 <= days <= 60:
        return 1.0
    if days < 30:
        return _clip((days - 7) / 23)
    return _clip((180 - days) / 120)


def greeks_fit(delta: Optional[float], kind: str, direction: str) -> Optional[float]:
    if delta is None:
        return None
    if (direction == "bullish") != (kind == "call"):
        return 0.0
    return _clip(1 - abs(abs(delta) - 0.45) / 0.45)


def liquidity(bid, ask, oi) -> Optional[float]:
    if bid is None or ask is None or bid <= 0 or ask < bid:
        return None
    m = (bid + ask) / 2
    spread = (ask - bid) / m * 100
    s = 1.0 if spread <= 2 else 0.0 if spread >= 20 else (20 - spread) / 18
    return round(0.7 * s + 0.3 * min(1.0, (oi or 0) / 1000), 4)


def _default_chain(sym: str, expiration: str) -> dict:
    from api.services import polygon_options
    return polygon_options.get_chain(sym, expiration=expiration, strikes_around_spot=20)


def _default_rank(sym: str) -> dict:
    from api.services.options_analytics import vol
    return vol.iv_rank(sym)


def _default_earnings(sym: str) -> Optional[str]:
    from api.services.options_analytics import vol
    return vol._next_earnings(sym)


_chain: Callable[[str, str], dict] = _default_chain
_rank: Callable[[str], dict] = _default_rank
_earnings: Callable[[str], Optional[str]] = _default_earnings


def stance(sym: str, occ: str, direction: str, *, today: Optional[_dt.date] = None) -> dict:
    from api.services.options_analytics.chain_tools import parse_occ
    parsed = parse_occ(occ)
    if parsed is None or parsed["underlying"] != sym:
        raise ValueError(f"{occ!r} is not an option contract on {sym}")
    if direction not in ("bullish", "bearish"):
        raise ValueError("direction must be bullish or bearish")
    c = _chain(sym, parsed["expiration"])
    if not isinstance(c, dict) or c.get("error"):
        raise RuntimeError((c or {}).get("error", "no chain"))
    row = next((r for r in (c.get("calls") or []) + (c.get("puts") or [])
                if (r.get("contract") or "").upper() == occ.upper()), None)
    if row is None:
        raise NotInChain(f"{occ} is not in the chain near the money right now")
    today = today or _dt.datetime.now(_ET).date()
    days = (_dt.date.fromisoformat(parsed["expiration"]) - today).days
    sub: dict = {k: None for k in COMPONENTS}
    why: dict = {}
    r = _rank(sym) or {}
    if r.get("iv_rank") is not None:
        sub["iv_regime"] = round(_clip(1 - r["iv_rank"] / 100), 4)
        why["iv_regime"] = f"IV rank {r['iv_rank']:.0f} ({r.get('rank_word')})"
    else:
        why["iv_regime"] = r.get("sentence") or "IV rank unavailable"
    sub["greeks_fit"] = None if (g := greeks_fit(row.get("delta"), parsed["type"], direction)) is None else round(g, 4)
    why["greeks_fit"] = (f"delta {row['delta']:+.2f} on a {parsed['type']} for a {direction} view"
                         if row.get("delta") is not None else "no vendor delta")
    sub["dte_fit"] = round(dte_fit(days), 4)
    why["dte_fit"] = f"{days} days to expiry"
    sub["liquidity"] = liquidity(row.get("bid"), row.get("ask"), row.get("open_interest"))
    why["liquidity"] = ("no two-sided quote" if sub["liquidity"] is None else
                        f"spread {(row['ask'] - row['bid']) / ((row['ask'] + row['bid']) / 2) * 100:.1f}% "
                        f"of mid, OI {row.get('open_interest') or 0:,}")
    try:
        ne = _earnings(sym)
    except Exception:  # noqa: BLE001 -- the component is then not computed, said in words
        ne = None
    if ne:
        before = ne[:10] <= parsed["expiration"]
        sub["earnings_timing"] = 0.3 if before else 1.0
        why["earnings_timing"] = (f"earnings {ne[:10]} {'before' if before else 'after'} expiry")
    else:
        why["earnings_timing"] = "no earnings date on file"
    used = [v for v in sub.values() if v is not None]
    score = round(5 * sum(used) / len(used), 2) if used else None
    parts = [f"{k.replace('_', ' ')} {v:.2f} ({why[k]})" for k, v in sub.items() if v is not None]
    missing = [f"{k.replace('_', ' ')} ({why[k]})" for k, v in sub.items() if v is None]
    explanation = (f"{occ} for a {direction} view scores {score} of 5 over {len(used)} of 5 components: "
                   + "; ".join(parts) + "."
                   + (f" Not computed: {'; '.join(missing)}." if missing else "")) if used else \
        "No component could be computed for this contract."
    return {"symbol": sym, "contract": occ.upper(), "direction": direction, "label": "computed",
            "fit_score": score, "components_used": len(used), "sub_scores": sub, "reasons": why,
            "explanation": explanation, "method": METHOD, "disclaimer": DISCLAIMER}
