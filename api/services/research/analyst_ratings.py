"""Analyst Ratings tab: canonical third-party analyst consensus, price
targets, and recent rating actions for the research page.

2026-09-03 dedicated Analyst Ratings slice (owner authorization). A thin
wrapper around `api.services.analyst_grades.get_analyst_grades()` -- the
canonical composer, now S3+S8-integrated -- shaped to match every other
research-page module's `{sym, entity, ...}` response contract
(financials.py/estimates.py/ownership.py/ratings.py all follow the same
pattern: always a dict, never None, entity resolved independently of
whether the substantive data legs found anything).

Distinct from:
  - api/services/research/ratings.py -- the UCT Composite Rating, 100%
    locally derived. A different product concept; not touched by this file.
  - api/services/research/estimates.py -- EPS/revenue forward estimates
    only, narrowed 2026-09-03 to remove the analyst-grade content that now
    lives here.

The legacy `api/services/analyst_intel.py` -> `api/routers/analyst.py` ->
`AnalystPanel.jsx` path is UNTOUCHED and stays live (owner decision:
retirement deferred, not part of this slice).
"""
from __future__ import annotations

from typing import Optional

from api.services.analyst_grades import get_analyst_grades
from api.services.research.entity_resolution import resolve_entity

_EMPTY_ACTIONS = {"items": [], "_meta": None}


class AnalystRatingsUnavailable(RuntimeError):
    """Every analyst leg failed or was refused: an outage, never "no coverage"."""


def get_analyst_ratings(sym: str, *, outage_out: Optional[dict] = None) -> dict:
    """Always a dict, never None -- `entity` is resolved independently of
    whether analyst data exists so a genuinely-uncovered ticker (a real,
    common outcome, not a failure) still shows correct canonical identity.

    `outage_out` (S9, 2026-09-06) passes straight through to
    `get_analyst_grades()` -- see its docstring. This wrapper's own return
    shape is unchanged either way (no new key is added to the returned
    dict); a caller that needs the outage signal must read it back from
    the same `outage_out` dict it supplied.

    tq-panels (2026-10-05): superseded in part -- the record now carries
    `outage` (bool), and a miss during an outage RAISES
    `AnalystRatingsUnavailable` instead of returning the no-coverage shape."""
    sym = (sym or "").upper().strip()
    if not sym:
        if outage_out is not None:
            outage_out["outage"] = False
        return {"sym": sym, "entity": None, "consensus": None,
                "price_target": None, "recent_actions": dict(_EMPTY_ACTIONS)}

    entity, _fmp_symbol = resolve_entity(sym)

    # tq-panels (ANR): the route never passed `outage_out`, so an outage and "no
    # analyst coverage" came back as the same 200 with null sections. Read the
    # signal always; a TOTAL outage raises (the route answers 503 "could not be
    # read"), a PARTIAL one is stamped `outage: True` on the record.
    sig: dict = outage_out if outage_out is not None else {}
    grades = get_analyst_grades(sym, outage_out=sig)
    outage = bool(sig.get("outage"))
    if not grades:
        if outage:
            raise AnalystRatingsUnavailable(f"analyst data provider did not answer for {sym}")
        return {"sym": sym, "entity": entity, "consensus": None,
                "price_target": None, "recent_actions": dict(_EMPTY_ACTIONS), "outage": False}

    return {
        "sym":            sym,
        # `get_analyst_grades` already resolved (and stamps) entity on its
        # own success path via the same `resolve_entity` call -- reuse that
        # rather than a third resolution.
        "entity":         grades.get("entity") or entity,
        "consensus":      grades.get("consensus"),
        "price_target":   grades.get("price_target"),
        "recent_actions": grades.get("recent_actions") or dict(_EMPTY_ACTIONS),
        "outage":         outage,
    }
