"""A single, reusable read of every S7 alert type's dark-comparison data.

⛔ WHY THIS EXISTS. Each `*_compare.py` module already has a `report(predicate_id,
*, db_path=None)` with the real per-predicate semantics (agreed / new_only /
legacy_only / not_comparable, NO DATA vs NO FLIP vs QUIET vs OBSERVED,
verdict_ready, blind_spots) -- but the only thing that ever CALLS `report()`
across every predicate at once is `tools/s7_price_level_report.py`, a local CLI
script hardcoded to ONE type (`price_level_comparison_spans`) and runnable only
via `railway ssh` on the pod. There was no way to read the other six types'
dark data except a hand-written one-off SQL query over SSH.

This module is the generalized, permanent version: given a type name, enumerate
every predicate_id that has ever opened a span for it, and return each one's
own `report()`. It reuses each module's own `report()` verbatim -- never a
second aggregation logic that could drift from the one every gate packet's
own dark-read language actually describes.
"""
from __future__ import annotations

from typing import Any

# One entry per S7 alert type: (url-friendly key, comparison-spans table,
# the compare module). The table name does NOT always match the module name
# (scan-membership-change's table is `scan_membership_comparison_spans`,
# singular-scoped, not `scan_membership_change_...`) -- read from each
# module's own `_SCHEMA`, never guessed from its filename.
_TYPES: dict[str, tuple[str, str]] = {
    "price-level": ("price_level_comparison_spans", "price_level_compare"),
    "event-proximity": ("event_proximity_comparison_spans", "event_proximity_compare"),
    "position-risk": ("position_risk_comparison_spans", "position_risk_compare"),
    "scan-membership-change": ("scan_membership_comparison_spans", "scan_membership_change_compare"),
    "catalyst-match": ("catalyst_match_comparison_spans", "catalyst_match_compare"),
    "regime-change": ("regime_change_comparison_spans", "regime_change_compare"),
    "indicator-condition": ("indicator_condition_comparison_spans", "indicator_condition_compare"),
}


def known_types() -> list[str]:
    return sorted(_TYPES)


def _module(name: str):
    import importlib
    return importlib.import_module(f"api.services.alert_taxonomy.{name}")


def dark_report(alert_type: str, *, db_path: str | None = None) -> dict[str, Any]:
    """Every predicate_id's `report()` for one S7 alert type.

    Returns `{"alert_type", "table", "predicates": [report(), ...]}`. An empty
    `predicates` list is NOT the same as an error -- it means the sweep has
    opened no spans for this type yet, which `report()` itself would call
    "NO DATA" per-predicate; here it is simply zero predicates observed.
    """
    if alert_type not in _TYPES:
        raise ValueError(
            f"unknown alert_type {alert_type!r}; known: {', '.join(known_types())}")
    table, module_name = _TYPES[alert_type]
    mod = _module(module_name)

    # `_conn()` runs each module's own idempotent `CREATE TABLE IF NOT EXISTS`
    # before use, so the table is guaranteed to exist by the time we query it
    # -- the same guarantee `report()` itself relies on internally.
    conn = mod._conn(db_path)
    try:
        rows = conn.execute(
            f"SELECT DISTINCT predicate_id FROM {table} ORDER BY predicate_id"
        ).fetchall()
    finally:
        conn.close()

    predicate_ids = [r["predicate_id"] for r in rows]
    return {
        "alert_type": alert_type,
        "table": table,
        "predicate_count": len(predicate_ids),
        "predicates": [mod.report(pid, db_path=db_path) for pid in predicate_ids],
    }


def dark_report_all(*, db_path: str | None = None) -> dict[str, Any]:
    """Every type's `dark_report()`, in one call -- the full picture in one read."""
    return {t: dark_report(t, db_path=db_path) for t in known_types()}
