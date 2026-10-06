"""Chain-side tools: FT-003 probability analysis, FT-016 the contract drill's history, FT-002 the
multi-leg builder's switch.

  * probability  — the price range an expiration's at-the-money IV implies at a chosen
                   probability (default one standard deviation, 68.27%). COMPUTED, lognormal,
                   no drift, centred on today's spot; the IV is the vendor's.
  * contract_history — a contract's own daily bars (Massive aggregates for the OCC symbol). VENDOR.
  * builder_config — the multi-leg builder's settings; its route is the builder's dark switch.
    The payoff arithmetic stays in the browser (`optionPayoff.js`), the one implementation.

⛔ Blocking (vendor chain, aggregates): callers are plain `def` routes.
"""
from __future__ import annotations

import datetime as _dt
import math
import re
from statistics import NormalDist
from typing import Callable, Optional
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
DEFAULT_PROBABILITY = 0.6827
STANDARD_PROBABILITIES = (0.6827, 0.9545)
CONTRACT_HISTORY_DAYS = 120
MAX_LEGS = 8
_OCC = re.compile(r"^O:([A-Z][A-Z0-9.]{0,9})(\d{6})([CP])(\d{8})$")

PROBABILITY_METHOD = ("Range = spot x exp(+/- z x IV x sqrt(sessions/252)), where sessions counts the NYSE "
                      "trading sessions from today to the expiration (the one convention every options "
                      "panel uses), z is the standard-normal "
                      "quantile for the chosen two-sided probability and IV is the mean of the call and "
                      "put implied volatility at the strike closest to spot for that expiration. A "
                      "lognormal, no-drift, no-dividend model centred on today's spot: what the option "
                      "prices imply, not a forecast.")


def _default_chain(sym: str, expiration: str) -> dict:
    from api.services import polygon_options
    return polygon_options.get_chain(sym, expiration=expiration, strikes_around_spot=10)


_chain: Callable[[str, str], dict] = _default_chain


def _atm(chain: dict) -> Optional[tuple]:
    spot = chain.get("spot")
    if not spot:
        return None
    rows = [r for side in ("calls", "puts") for r in (chain.get(side) or [])
            if r.get("strike") is not None and r.get("iv") is not None]
    if not rows:
        return None
    k = min({float(r["strike"]) for r in rows}, key=lambda s: abs(s - float(spot)))
    ivs = [float(r["iv"]) for r in rows if float(r["strike"]) == k]
    return k, sum(ivs) / len(ivs)


def range_at(spot: float, iv: float, sessions: float, p: float) -> dict:
    """`sessions` = NYSE trading sessions to the expiration (move_convention, O11)."""
    from api.services.options_analytics import move_convention as mc
    z = NormalDist().inv_cdf((1 + p) / 2)
    w = z * mc.sigma(iv, sessions)
    return {"probability": p, "z": round(z, 4), "low": round(spot * math.exp(-w), 2),
            "high": round(spot * math.exp(w), 2)}


def probability(sym: str, expiration: str = "", p: float = DEFAULT_PROBABILITY, *,
                today: Optional[_dt.date] = None) -> dict:
    c = _chain(sym, expiration)
    if not isinstance(c, dict) or c.get("error"):
        raise RuntimeError((c or {}).get("error", "no chain"))
    exp = c.get("expiration")
    atm = _atm(c)
    today = today or _dt.datetime.now(_ET).date()
    base = {"symbol": sym, "expiration": exp, "spot": c.get("spot"), "label": "computed",
            "iv_label": "vendor", "method": PROBABILITY_METHOD}
    if atm is None or not exp:
        return {**base, "atm_iv": None, "ranges": [],
                "note": "No at-the-money implied volatility for this expiration; no range can be drawn."}
    days = (_dt.date.fromisoformat(exp) - today).days
    if days < 0:
        return {**base, "atm_iv": atm[1], "ranges": [], "note": "This expiration has passed."}
    probs = [p] + [q for q in STANDARD_PROBABILITIES if abs(q - p) > 1e-9]
    from api.services.options_analytics import move_convention as mc
    sessions = mc.sessions_between(today, _dt.date.fromisoformat(exp))
    return {**base, "atm_strike": atm[0], "atm_iv": round(atm[1], 4), "days": days,
            "sessions": sessions,
            "ranges": [range_at(float(c["spot"]), atm[1], sessions, q) for q in probs],
            "note": "Same-day expiration: the range is today's spot." if days == 0 else None}


# ── FT-016 contract drill ──────────────────────────────────────────────────────

def root_matches(root: str, sym: str) -> bool:
    """O9: does an OCC root name this underlying? OCC writes class shares without the separator
    (BRK.B / BRK-B -> BRKB) and an adjusted contract appends one digit (BRKB1), so both sides are
    compared with '.' and '-' stripped, and one trailing digit on the root is allowed."""
    def norm(x: str) -> str:
        return (x or "").upper().replace(".", "").replace("-", "").strip()
    r, s = norm(root), norm(sym)
    return bool(s) and (r == s or (len(r) == len(s) + 1 and r.startswith(s) and r[-1].isdigit()))


def parse_occ(occ: str) -> Optional[dict]:
    m = _OCC.match((occ or "").strip().upper())
    if not m:
        return None
    root, ymd, cp, strike = m.groups()
    return {"underlying": root, "expiration": f"20{ymd[:2]}-{ymd[2:4]}-{ymd[4:]}",
            "type": "call" if cp == "C" else "put", "strike": int(strike) / 1000}


def _default_bars(occ: str, f: str, t: str) -> list:
    from api.services import massive
    return massive.get_daily_agg(occ, f, t, adjusted=False, map_symbol=False)


_bars: Callable[[str, str, str], list] = _default_bars


def contract_history(sym: str, occ: str, *, today: Optional[_dt.date] = None) -> dict:
    parsed = parse_occ(occ)
    if parsed is None or not root_matches(parsed["underlying"], sym):
        raise ValueError(f"{occ!r} is not an option contract on {sym}")
    today = today or _dt.datetime.now(_ET).date()
    bars = _bars(occ.upper(), (today - _dt.timedelta(days=CONTRACT_HISTORY_DAYS)).isoformat(),
                 today.isoformat()) or []
    pts = []
    for b in bars:
        try:
            d = _dt.datetime.fromtimestamp(int(b["t"]) / 1000, _dt.timezone.utc).astimezone(_ET).date().isoformat()
        except (KeyError, TypeError, ValueError, OSError):
            continue
        pts.append({"date": d, "open": b.get("o"), "high": b.get("h"), "low": b.get("l"),
                    "close": b.get("c"), "volume": b.get("v")})
    return {"symbol": sym, "contract": occ.upper(), **parsed, "label": "vendor",
            "source": "Massive daily aggregates for the contract", "bars": pts,
            "note": None if pts else ("No daily bars came back for this contract: it may be new or "
                                      "untraded, or the read failed. Not the same as no history.")}


def builder_config() -> dict:
    return {"enabled": True, "max_legs": MAX_LEGS, "label": "computed",
            "basis": ("Each leg is priced at the mid of its live bid and ask; payoff at expiration, "
                      "before commissions; net greeks are the vendor's per-contract greeks x "
                      "quantity x 100. A picture of a position, not an order.")}
