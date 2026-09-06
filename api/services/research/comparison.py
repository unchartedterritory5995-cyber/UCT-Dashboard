"""Cross-Security Comparison V1 (owner authorization, Phase B).

Side-by-side deterministic comparison of exactly two member-supplied
securities inside canonical Research. Reuses every existing composer's
`{sym, entity, ...}` contract rather than building a second identity/evidence
path -- this module contains no new data-fetching logic, only composition:

  - api.services.fundamentals.get_fundamentals -- valuation/growth/margins
  - research/estimates.py::get_estimates       -- forward EPS/revenue, period-labeled
  - research/ratings.py::get_ratings           -- UCT Composite Rating
  - research/analyst_ratings.py::get_analyst_ratings -- third-party consensus

Deliberately excluded (Phase A findings, owner authorization):
  - No AI synthesis. ticker_explain.py's evidence-building, history-cleaning
    (_clean_history drops any prior turn whose own `sym` differs), and
    top-level signature are all architecturally single-entity BY DESIGN, to
    prevent cross-security evidence leakage -- extending that safely is its
    own future sub-slice, not smuggled in here.
  - No peer discovery, no baskets, no "best alternative" ranking -- exactly
    two securities, both explicitly chosen by the member.
  - No fabricated period equivalence for fundamentals/valuation: nothing
    upstream of `get_fundamentals` carries a fiscal-period/currency label, so
    this module discloses that honestly (`fundamentals_period_note`) rather
    than implying two numbers are the same reporting period.
"""
from __future__ import annotations

import logging

from api.services.fundamentals import get_fundamentals
from api.services.research.entity_resolution import resolve_entity
from api.services.research.estimates import get_estimates
from api.services.research.ratings import get_ratings
from api.services.research.analyst_ratings import get_analyst_ratings

_logger = logging.getLogger(__name__)

_ALIGNED_PERIODS = ("Current Qtr", "Next Qtr", "Current Yr", "Next Yr")


def _side(sym: str) -> dict:
    """One security's full comparison payload. Never raises -- each leg
    degrades independently (matches every other research/ composer's "a
    failure surfaces as an honest empty/error leg, never a broken page"
    contract). `entity` is always resolved, even when every data leg fails,
    so an unresolved-but-real-looking symbol still reports honest identity."""
    sym = (sym or "").upper().strip()
    entity, _ = resolve_entity(sym)

    fund: dict = {}
    try:
        fund = get_fundamentals(sym) or {}
        if isinstance(fund, dict) and "error" in fund:
            fund = {"error": fund["error"]}
    except Exception as exc:  # noqa: BLE001
        _logger.warning("comparison: fundamentals failed for %s: %s", sym, exc)
        fund = {"error": str(exc)}

    est: dict = {}
    try:
        est = get_estimates(sym) or {}
    except Exception as exc:  # noqa: BLE001
        _logger.warning("comparison: estimates failed for %s: %s", sym, exc)

    rat: dict = {}
    try:
        rat = get_ratings(sym) or {}
    except Exception as exc:  # noqa: BLE001
        _logger.warning("comparison: ratings failed for %s: %s", sym, exc)

    ana: dict = {}
    try:
        ana = get_analyst_ratings(sym) or {}
    except Exception as exc:  # noqa: BLE001
        _logger.warning("comparison: analyst ratings failed for %s: %s", sym, exc)

    return {
        "sym": sym,
        "entity": entity,
        "fundamentals": fund,
        "estimates": est.get("forward") or [],
        "ratings": {
            "composite": rat.get("composite"),
            "components": rat.get("components") or {},
            # UCT's own honest freshness disclosure for this security's
            # rating leg (never a vendor badge) -- see ratings.py's own
            # comment on why this is the one concrete as-of available today.
            "price_as_of": rat.get("price_as_of"),
        },
        "analyst": {
            "consensus": ana.get("consensus"),
            "price_target": ana.get("price_target"),
            # S8 provenance envelopes, already attached upstream by
            # analyst_grades.py -- surfaced as-is so two securities with
            # different freshness/vendor state show that difference rather
            # than reading as equally current.
            "consensus_meta": (ana.get("consensus") or {}).get("_meta"),
            "price_target_meta": (ana.get("price_target") or {}).get("_meta"),
        },
    }


def get_comparison(sym_a: str, sym_b: str) -> dict:
    """Always a dict, never None. `error` at the top level is reserved for a
    structurally invalid REQUEST (blank/identical symbols) -- an unresolved
    or no-data comparator is still a valid response shape (its `entity`
    reads `not_found`, its legs read empty), never an error, so a genuinely
    uncovered ticker renders as "no data for X", not a broken comparison."""
    sym_a = (sym_a or "").upper().strip()
    sym_b = (sym_b or "").upper().strip()
    if not sym_a or not sym_b:
        return {"error": "two symbols are required"}
    if sym_a == sym_b:
        return {"error": "choose two different securities to compare"}

    a = _side(sym_a)
    b = _side(sym_b)

    # Estimate rows aligned by period LABEL only, never by list position --
    # a security missing one horizon (e.g. no analyst coverage for "Next
    # Yr") must not silently shift every later row out of alignment with
    # the other side (Phase A's period-alignment requirement).
    periods_a = {r["period"]: r for r in a["estimates"] if r.get("period")}
    periods_b = {r["period"]: r for r in b["estimates"] if r.get("period")}
    estimates_aligned = [
        {"period": p, "a": periods_a.get(p), "b": periods_b.get(p)}
        for p in _ALIGNED_PERIODS
        if p in periods_a or p in periods_b
    ]

    return {
        "a": a,
        "b": b,
        "estimates_aligned": estimates_aligned,
        "fundamentals_period_note": (
            "Fundamentals shown as currently reported -- the underlying "
            "source does not disclose a fiscal period, so these are not "
            "guaranteed to be the same reporting period for both securities."
        ),
    }
