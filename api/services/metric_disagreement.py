"""D-12 (Canonical data model PRD UC-5) -- when two of our computations of one metric disagree.

UC-5: *"Two computations of one concept is sometimes correct... The requirement is
that the divergence has a name."* For one ticker, the member can see the same
valuation figure on two UCT surfaces that compute it independently:

  research   the Research Overview / ticker popup snapshot (`research.snapshot`):
             yfinance's quote summary, with FMP backfilling market cap;
  screener   the nightly Screener row (`screener_rows`): market cap from Massive's
             ticker details, the ratios from FMP's TTM bulk files
             (`screener/fundamentals_bulk.py`).

This module puts each pair side by side, with the relative gap, the tolerance it
was judged against (declared HERE, per metric, and returned), and the as-of of each
side. DETECTABLE, NOT FORBIDDEN: a disagreement is named, never resolved -- neither
value is preferred and nothing is overwritten.

⛔ ONLY PAIRS WHOSE UNITS MATCH. `debt_to_equity` is NOT paired: yfinance states it
as a percent (150 = 1.5x) while the screener stores a plain ratio, so a comparison
would report a 100x "disagreement" that is a unit, not a fact. Average volume is not
paired either: yfinance's is a 3-month average, the screener's a 30-day one.

⛔ REQUEST PATH READS LOCAL STORES ONLY. The research side is read from the memory
cache or the disk snapshot store; a miss schedules the snapshot module's own
background rebuild and that side is `not_built` -- the request never calls
yfinance. The screener side is one SQLite row.

⛔ "COULD NOT COMPARE" IS NOT "AGREE". A pair with a side missing is
`cannot_compare` and names the missing side.

DARK behind METRIC_DISAGREEMENT_ENABLED (read per call, unset = OFF).
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Optional

_logger = logging.getLogger(__name__)

ENABLED_ENV = "METRIC_DISAGREEMENT_ENABLED"

RESEARCH_SOURCE = "Research snapshot: yfinance quote summary (market cap backfilled from FMP)"
SCREENER_SOURCE = "Screener nightly row: market cap from Massive ticker details, ratios from FMP TTM bulk"

#: (key, label, research metric, screener column, relative tolerance, note)
PAIRS: tuple[tuple[str, str, str, str, float, str], ...] = (
    ("market_cap", "Market cap", "market_cap", "market_cap", 0.05,
     "The research figure is stored rounded to 3 significant figures and priced at a different time."),
    ("pe_trailing", "P/E (trailing)", "pe_trailing", "pe_ttm", 0.10, ""),
    ("ps", "Price / sales", "ps", "ps", 0.10, ""),
    ("pb", "Price / book", "pb", "pb", 0.10, ""),
    ("beta", "Beta", "beta", "beta", 0.15,
     "Vendors measure beta over different windows; a gap here is common."),
    ("current_ratio", "Current ratio", "current_ratio", "current_ratio", 0.10, ""),
)

AGREE = "agree"
DISAGREE = "disagree"
CANNOT = "cannot_compare"

_MONEY_RE = re.compile(r"^\$?\s*(-?[0-9][0-9,]*(?:\.[0-9]+)?)\s*([TBMK]?)$", re.I)
_MULT = {"": 1.0, "K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "0").strip().lower() in ("1", "true", "yes", "on")


def parse_number(v: Any) -> Optional[float]:
    """A number, or a money string the research snapshot formats ("$1.23T"), as a float.
    Anything else is None -- never 0."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        return f if f == f and abs(f) != float("inf") else None
    m = _MONEY_RE.match(str(v).strip())
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", "")) * _MULT[m.group(2).upper()]
    except (ValueError, KeyError):
        return None


def relative_gap(a: float, b: float) -> float:
    """|a-b| over the larger magnitude, so the gap is symmetric in the two sides."""
    den = max(abs(a), abs(b))
    return 0.0 if den == 0 else abs(a - b) / den


def judge(research: Optional[float], screener: Optional[float], tol: float) -> dict:
    if research is None or screener is None:
        missing = [n for n, v in (("research", research), ("screener", screener)) if v is None]
        return {"verdict": CANNOT, "missing": missing, "gap_pct": None}
    gap = relative_gap(research, screener)
    return {"verdict": AGREE if gap <= tol else DISAGREE, "missing": [], "gap_pct": round(gap * 100, 1)}


def _research_side(sym: str) -> dict:
    """{'state': 'ok'|'not_built', 'metrics': {...}, 'age_seconds': n|None}. Never a vendor call."""
    try:
        from api.services.cache import cache
        cached = cache.get(f"research_snapshot::{sym}")
        if cached is not None:
            return {"state": "ok", "metrics": dict(cached.get("metrics") or {}), "age_seconds": None}
        from api.services import fundamentals_snapshot_store as snap_store
        got = snap_store.get("research_snapshot", sym)
        if got is not None:
            payload, age, _ttl = got
            return {"state": "ok", "metrics": dict((payload or {}).get("metrics") or {}),
                    "age_seconds": int(age)}
    except Exception as exc:  # noqa: BLE001
        _logger.warning("metric_disagreement: research side read failed for %s: %s", sym, exc)
        return {"state": "error", "metrics": {}, "age_seconds": None,
                "reason": f"{type(exc).__name__}: {exc}"[:200]}
    try:
        from api.services.research import snapshot
        snapshot._schedule_refresh(sym)  # background thread; this request does not wait
    except Exception as exc:  # noqa: BLE001
        _logger.debug("metric_disagreement: could not schedule snapshot for %s: %s", sym, exc)
    return {"state": "not_built", "metrics": {}, "age_seconds": None}


def _screener_side(sym: str) -> dict:
    try:
        from api.services.screener import snapshot_db
        row = snapshot_db.get_row(sym)
    except Exception as exc:  # noqa: BLE001
        _logger.warning("metric_disagreement: screener row read failed for %s: %s", sym, exc)
        return {"state": "error", "row": {}, "reason": f"{type(exc).__name__}: {exc}"[:200]}
    if not row:
        return {"state": "not_in_snapshot", "row": {}}
    return {"state": "ok", "row": row, "bars_asof": row.get("bars_asof"), "built_at": row.get("built_at")}


def disagreements_for(sym: str) -> dict:
    """`{sym, sides, pairs, counts}`. Never raises."""
    s = (sym or "").strip().upper()
    r = _research_side(s)
    sc = _screener_side(s)
    pairs = []
    for key, label, r_key, s_col, tol, note in PAIRS:
        rv = parse_number(r["metrics"].get(r_key))
        sv = parse_number(sc["row"].get(s_col))
        pairs.append({"key": key, "label": label, "research": rv, "screener": sv,
                      "tolerance_pct": round(tol * 100, 1), "note": note or None,
                      **judge(rv, sv, tol)})
    counts = {v: sum(1 for p in pairs if p["verdict"] == v) for v in (AGREE, DISAGREE, CANNOT)}
    sides = {
        "research": {"state": r["state"], "source": RESEARCH_SOURCE, "age_seconds": r.get("age_seconds"),
                     **({"reason": r["reason"]} if r.get("reason") else {})},
        "screener": {"state": sc["state"], "source": SCREENER_SOURCE, "bars_asof": sc.get("bars_asof"),
                     "built_at": sc.get("built_at"), **({"reason": sc["reason"]} if sc.get("reason") else {})},
    }
    return {"sym": s, "sides": sides, "pairs": pairs, "counts": counts}
