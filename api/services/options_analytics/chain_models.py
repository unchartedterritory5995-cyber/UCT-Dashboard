"""Chain-side models of lane/o-options-remainders: FT-001 (payoff today-at-IV + PoP), FT-014 (the
strategy finder), FT-015 (rho / lambda / epsilon) and FT-012 (theoretical-value edge).

FT-001, FT-014 and FT-015 COMPUTE IN THE BROWSER over the chain the Research > Options tab already
holds (`app/src/pages/optionsAnalytics/chainModels.js`): their routes here are the per-surface
switch plus the model's assumptions in words, so a member reads the same sentence the page used.
FT-012 computes here, because it needs the stock's realized volatility (daily bars).

⛔ Every number is `computed` and says how. Inputs that are the vendor's (quote, IV, greeks) are
   named as the vendor's.
⛔ Read-only: nothing here places, stages or sends an order. "Candidates" are arithmetic.
"""
from __future__ import annotations

import datetime as _dt
from typing import Callable, Optional
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

ASSUMPTIONS = ("Black-Scholes, European exercise, a zero interest rate and no dividends; listed "
               "American options and dividend payers can price differently.")

PAYOFF_MODEL = {
    "label": "computed",
    "risk_free_rate": 0.0,
    "assumptions": ASSUMPTIONS,
    "today_method": ("The 'today' curve values every leg by Black-Scholes at the vendor's own "
                     "implied volatility for that contract, with today's days to expiry, and "
                     "subtracts the mid each leg was priced at."),
    "pop_method": ("Probability of profit = the chance the underlying finishes, at expiration, in "
                   "a range where the position makes money, under a lognormal with the vendor's "
                   "at-the-money IV and no drift. A model, not a forecast."),
    "slice_method": ("Each price slice shows the P/L today and at expiration at that underlying "
                     "price, and the modelled chance of finishing below it."),
}

FINDER_MODEL = {
    "label": "computed",
    "assumptions": ASSUMPTIONS,
    "views": {
        "bullish": "Long call, bull call spreads (debit) and bull put spreads (credit).",
        "bearish": "Long put, bear put spreads (debit) and bear call spreads (credit).",
        "neutral": "Iron condors and iron butterflies (credit), and the short straddle (undefined risk).",
        "volatile": "Long straddle and long strangles.",
    },
    "method": ("Candidates are built off the chain shown above it, one contract per leg, every leg "
               "at the mid of its bid and ask; a structure with any leg lacking a two-sided quote "
               "is left out and counted. Probability of profit is modelled at expiration under a "
               "lognormal at the at-the-money vendor IV. Sorted by that probability or by reward "
               "to risk, your choice. Candidates, not advice: nothing here places an order."),
}

GREEKS_MODEL = {
    "label": "computed",
    "assumptions": ASSUMPTIONS,
    "rho": "Rho = the price change for a 1-point rise in the interest rate, per contract share.",
    "lambda": "Lambda (leverage) = delta x underlying price / option mid: % option move per 1% stock move.",
    "epsilon": "Epsilon = the price change for a 1-point rise in the dividend yield.",
    "inputs": "From the vendor's IV for each contract; the vendor's own Delta/Gamma/Theta/Vega are unchanged.",
    "streaming": ("Not streamed: a live option-quote stream would need a new vendor socket; the "
                  "chain refreshes every 60 s."),
}


# ── FT-012 theoretical-value edge ───────────────────────────────────────────────────────────

EDGE_METHOD = ("Theoretical value = Black-Scholes at the stock's 20-session realized volatility "
               "(close-to-close, computed from daily bars), zero rate, no dividends, calendar days "
               "to expiry. Edge = theoretical value - the vendor quote mid, per share; edge % = edge "
               "/ mid. Positive edge: the option is cheap against realized movement (a buyer's edge); "
               "negative: rich (a seller's edge). Realized volatility is one forecast among many, so "
               "this ranks disagreement with the market, not profit.")
WIN_RATE_MIN_SESSIONS = 60
MAX_RANKED = 10


def _default_chain(sym: str, expiration: str) -> dict:
    from api.services import polygon_options
    return polygon_options.get_chain(sym, expiration=expiration, strikes_around_spot=10)


def _default_realized(sym: str) -> dict:
    from api.services.options_analytics import vol
    return vol.realized(sym)


def _default_history(sym: str) -> dict:
    from api.services.options_analytics import vol
    return vol.iv_rank(sym)


_chain: Callable[[str, str], dict] = _default_chain
_realized: Callable[[str], dict] = _default_realized
_history: Callable[[str], dict] = _default_history


def _mid(c: dict) -> Optional[float]:
    b, a = c.get("bid"), c.get("ask")
    if not isinstance(b, (int, float)) or not isinstance(a, (int, float)) or b <= 0 or a <= 0 or a < b:
        return None
    return (a + b) / 2


def edge(sym: str, expiration: str = "", *, today: Optional[_dt.date] = None) -> dict:
    """Raises RuntimeError with the provider's words when the chain cannot be read."""
    from api.services.options_backtest import bs_price
    ch = _chain(sym, expiration)
    if not isinstance(ch, dict) or ch.get("error"):
        raise RuntimeError((ch or {}).get("error", "no chain"))
    today = today or _dt.datetime.now(_ET).date()
    spot = ch.get("spot")
    exp = ch.get("expiration")
    rv = _realized(sym) or {}
    hv20 = (rv.get("hv") or {}).get("hv20")
    hist = _history(sym) or {}
    n = int(hist.get("n") or 0)
    history = {"sessions_logged": n, "logging_began": hist.get("logging_began"),
               "win_rate": None, "win_rate_min_sessions": WIN_RATE_MIN_SESSIONS,
               "win_rate_note": (f"A win-rate ranking needs each contract's outcome over many past "
                                 f"sessions; our options log holds {n} session{'s' if n != 1 else ''}"
                                 f"{' since ' + hist['logging_began'] if hist.get('logging_began') else ''}, "
                                 f"and this ranks by edge only until it holds {WIN_RATE_MIN_SESSIONS}.")}
    base = {"symbol": sym, "expiration": exp, "spot": spot, "label": "computed", "method": EDGE_METHOD,
            "inputs": "vendor (bid, ask, IV) and computed (realized volatility)",
            "realized_vol": {"hv20": hv20, "through": rv.get("through"), "method": rv.get("method")},
            "history": history, "buyer_edge": [], "seller_edge": [], "skipped": 0, "evaluated": 0,
            "note": None}
    try:
        days = (_dt.date.fromisoformat(exp) - today).days
    except (TypeError, ValueError):
        days = None
    if not rv.get("available") or not hv20:
        return {**base, "note": rv.get("note") or "Realized volatility is unavailable, so no theoretical value."}
    if days is None or days <= 0 or not spot:
        return {**base, "note": "This expiration has no time left to value (or no underlying price)."}
    t = days / 365.0
    rows, skipped = [], 0
    for kind, side in (("call", ch.get("calls") or []), ("put", ch.get("puts") or [])):
        for c in side:
            m = _mid(c)
            k = c.get("strike")
            if m is None or not isinstance(k, (int, float)) or k <= 0:
                skipped += 1
                continue
            tv = bs_price(kind, float(spot), float(k), t, float(hv20), r=0.0)
            e = tv - m
            rows.append({"contract": c.get("contract"), "type": kind, "strike": k, "mid": round(m, 4),
                         "theoretical": round(tv, 4), "edge": round(e, 4), "edge_pct": round(e / m * 100, 1),
                         "vendor_iv": c.get("iv"), "delta": c.get("delta"),
                         "open_interest": c.get("open_interest")})
    buy = sorted((r for r in rows if r["edge"] > 0), key=lambda r: (-r["edge_pct"], r["strike"]))
    sell = sorted((r for r in rows if r["edge"] < 0), key=lambda r: (r["edge_pct"], r["strike"]))
    return {**base, "days_to_expiry": days, "buyer_edge": buy[:MAX_RANKED], "seller_edge": sell[:MAX_RANKED],
            "skipped": skipped, "evaluated": len(rows),
            "note": (f"{skipped} contract{'s' if skipped != 1 else ''} had no two-sided quote and "
                     "were not valued." if skipped else None)}
