"""
Journal 2.0 — market-context snapshot.

Captured at the moment a Position is created (spec §4 MarketContextSnapshot,
§8.3 capture rule). Pulls what it can from the morning-wire state via
engine.get_breadth(); fabricates nothing.

Derivation rules user has explicitly deferred (2026-04-17):
  - powerTrend: rule not yet defined → returns None (TODO: wire later)

Manual-entry fields (user decision A3, 2026-04-17):
  - igRank, rsRating: always None at the service layer; Phase 4 Add
    Position modal collects them from the user.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from api.services.journal_two.positions import count_open_positions_for_user


def build_snapshot(
    user_id: str,
    settings: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Build a MarketContextSnapshot for a new position about to be created.

    `navCount` captures the count of open positions BEFORE this new one
    is added — §4 "positions open at the instant of Position creation,
    not including the one being created."

    `rallyDay` and `breadthValue` come from the morning-wire state via
    engine.get_breadth(). `breadthMetricName` / `indexName` snapshot
    from current settings so later renames don't rewrite history.
    """
    nav_count = count_open_positions_for_user(user_id, conn=conn)

    # Morning-wire pull. Wrapped in try/except so a misconfigured
    # engine module never blocks a position creation — the snapshot
    # just ships with nulls.
    rally_day: str | None = None
    breadth_value: float | None = None
    try:
        from api.services.engine import get_breadth

        breadth = get_breadth()
        rally_day_count = breadth.get("rally_day_count")
        if isinstance(rally_day_count, int) and rally_day_count > 0:
            rally_day = f"D{rally_day_count}"
        bs = breadth.get("breadth_score")
        if isinstance(bs, (int, float)):
            breadth_value = float(bs)
    except Exception:
        pass

    # TODO: rule not yet defined — returning None per 2026-04-17 user
    # direction. Wire in a batched derivation-rules pass later.
    power_trend: str | None = None

    journal_cols = settings.get("journalColumns", {})
    breadth_metric_name = journal_cols.get("breadthMetric", "")
    index_name = journal_cols.get("marketNavIndex", "")

    return {
        "navCount": nav_count,
        "rallyDay": rally_day,
        "powerTrend": power_trend,
        "breadthValue": breadth_value,
        "breadthMetricName": breadth_metric_name,
        "indexName": index_name,
        "igRank": None,
        "rsRating": None,
    }
